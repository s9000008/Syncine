import express from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { Server, Socket } from 'socket.io';
import dotenv from 'dotenv';
import cors from 'cors';
import { RoomManager } from './roomManager';
import { RateLimiter } from './rateLimiter';
import { sanitizeLog, checkNodeSecurityVersion, extractClientIp } from './utils';
import {
  CreateRoomReq,
  JoinRoomReq,
  SyncStateMsg,
  RedirectRoomMsg,
  TogglePermissionMsg,
  CreateRoomRes,
  validateSyncData,
  isServerUrlAllowed,
  getCanonicalVideoUrl
} from './types';

dotenv.config();

const serverPkg = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf-8')
);
const SERVER_VERSION: string = serverPkg.version;

const app = express();
const PORT = process.env.PORT || 8080;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const ALLOWED_ORIGINS = CORS_ORIGIN === '*'
  ? null
  : CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean);

function validateCorsOrigin(
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void
) {
  if (!origin || !ALLOWED_ORIGINS) {
    callback(null, true);
    return;
  }
  if (
    origin.startsWith('chrome-extension://') ||
    origin.startsWith('moz-extension://') ||
    ALLOWED_ORIGINS.includes(origin)
  ) {
    callback(null, true);
    return;
  }
  callback(new Error('ERR_CORS_FORBIDDEN'));
}

app.use(cors({ origin: validateCorsOrigin }));

// 資安防禦中介軟體 (防範 CVE-2026-111497 Brotli 邊界外損毀與壓縮炸彈攻擊)
app.use((req, res, next) => {
  const encoding = req.headers['content-encoding'];
  if (encoding) {
    console.warn(`[Security Alert] 拒絕帶有 Content-Encoding 的非預期 HTTP 請求 (${sanitizeLog(encoding)}) 來自: ${sanitizeLog(req.ip || req.socket.remoteAddress || '')}`);
    return res.status(415).json({
      error: 'Unsupported Media Type',
      code: 'ERR_COMPRESSED_PAYLOAD_FORBIDDEN',
      message: 'Incoming compressed payloads (br, gzip, deflate) are strictly forbidden to mitigate decompression vulnerabilities (CVE-2026-111497).'
    });
  }
  next();
});

// 限制 JSON 請求大小至 64KB，阻斷超大記憶體配置 DoS
app.use(express.json({ limit: '64kb' }));

// 健康檢查 Endpoint
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'Syncine Socket Server', version: SERVER_VERSION });
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: validateCorsOrigin,
    methods: ['GET', 'POST'],
    credentials: true
  },
  transports: ['websocket', 'polling'],
  // 資安防護：關閉 HTTP 與 WebSocket 壓縮，防範 Brotli / zlib 解碼器邊界外損毀 (CVE-2026-111497) 與記憶體溢位
  httpCompression: false,
  perMessageDeflate: false,
  maxHttpBufferSize: 64 * 1024 // 限制單一訊息上限為 64KB
});

const roomManager = new RoomManager();
const rateLimiter = new RateLimiter();

roomManager.setHostTimeoutCallback((updatedRoom) => {
  io.to(updatedRoom.roomId).emit('HOST_CHANGED', {
    newHostUserId: updatedRoom.hostUserId,
    code: 'HOST_CHANGED'
  });
  io.to(updatedRoom.roomId).emit('MEMBER_COUNT_UPDATED', { count: updatedRoom.members.size });

  // P1: 私下通知新房主被提升為房主，並發送新生成的 resumeToken (單播發送，絕不公開廣播)
  if (updatedRoom.hostResumeToken && updatedRoom.hostSocketId) {
    io.to(updatedRoom.hostSocketId).emit('HOST_PRIVILEGE_GRANTED', {
      resumeToken: updatedRoom.hostResumeToken
    });
  }
});

// ----------------------------------------------------
// 安全事件註冊輔助函式 (P0: 防畸形崩潰 + P1: 頻率限制防洪)
// ----------------------------------------------------
type RateLimitType = 'GENERAL' | 'SYNC' | 'SENSITIVE';

function registerSafeHandler<T>(
  socket: Socket,
  eventName: string,
  handler: (payload: T) => void | Promise<void>,
  requirePayloadObject: boolean = true,
  rateLimitType: RateLimitType = 'GENERAL'
) {
  socket.on(eventName, async (payload: any) => {
    try {
      // 1. 頻率限制 (Rate Limiting) 與 DoS 防洪保護
      const check = rateLimitType === 'SYNC'
        ? rateLimiter.checkSync(socket.id)
        : rateLimitType === 'SENSITIVE'
        ? rateLimiter.checkSensitive(socket.id)
        : rateLimiter.checkGeneral(socket.id);

      if (check.isMalicious) {
        console.warn(`[RateLimit DoS Blocked] 偵測到惡意洪水攻擊 (${eventName}) 來自: ${sanitizeLog(socket.id)}，強制斷線`);
        socket.emit('ERROR', { code: 'ERR_RATE_LIMITED', message: 'ERR_RATE_LIMITED' });
        socket.disconnect(true);
        return;
      }

      if (!check.allowed) {
        if (rateLimitType === 'SYNC') {
          // 高頻同步信號超限採取靜默丟棄 (Silent Drop)，杜絕廣播風暴
          return;
        }
        console.warn(`[RateLimit Blocked] 事件頻率超限 (${eventName}) 來自: ${sanitizeLog(socket.id)}`);
        socket.emit('ERROR', { code: 'ERR_RATE_LIMITED', message: 'ERR_RATE_LIMITED' });
        return;
      }

      // 2. 畸形 Payload 校驗
      if (requirePayloadObject && (!payload || typeof payload !== 'object')) {
        console.warn(`[SafeHandler Blocked] 收到非法畸形 Payload (${eventName}) 來自: ${sanitizeLog(socket.id)}`);
        socket.emit('ERROR', { code: 'ERR_INVALID_CODE', message: 'ERR_INVALID_CODE' });
        return;
      }
      await handler(payload);
    } catch (err: any) {
      console.error(`[SafeHandler Catched] 執行事件 ${eventName} 拋出未預期例外:`, err);
      socket.emit('ERROR', { code: 'ERR_UNKNOWN', message: 'ERR_UNKNOWN' });
    }
  });
}

io.on('connection', (socket: Socket) => {
  const clientIp = extractClientIp(
    socket.handshake.headers['x-forwarded-for'],
    socket.handshake.address
  );
  rateLimiter.registerSocketIp(socket.id, clientIp);
  console.log(`[Socket.IO] 新用戶連線: ${sanitizeLog(socket.id)}`);

  const cleanupPreviousSocketRoom = (targetRoomId?: string) => {
    const prev = roomManager.leavePreviousRoomIfNeeded(socket.id, targetRoomId);
    if (prev.previousRoomId) {
      socket.leave(prev.previousRoomId);
      if (!prev.roomClosed) {
        const oldRoom = roomManager.getRoom(prev.previousRoomId);
        io.to(prev.previousRoomId).emit('MEMBER_LEFT', {
          socketId: socket.id,
          isHost: prev.isHost
        });
        if (oldRoom) {
          io.to(prev.previousRoomId).emit('MEMBER_COUNT_UPDATED', { count: oldRoom.members.size });
        }
      }
    }
  };

  // 1. 建立房間
  registerSafeHandler<CreateRoomReq>(socket, 'CREATE_ROOM', (payload) => {
    const { userId, currentUrl, isSelfHosted, mode, language } = payload?.data || {};
    const candidateUrl = typeof currentUrl === 'string' && currentUrl.trim() ? getCanonicalVideoUrl(currentUrl) : '';
    const cleanUrl = candidateUrl && isServerUrlAllowed(candidateUrl, Boolean((payload?.data as any)?.allowUniversal)) ? candidateUrl : '';
    cleanupPreviousSocketRoom();

    // 資安防護：驗證語系格式 (BCP 47 標籤格式，限制 10 字元內，避免惡意注入)
    let sanitizedLang: string | undefined = undefined;
    if (typeof language === 'string') {
      const trimmed = language.trim();
      if (/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,4})?$/.test(trimmed) && trimmed.length <= 10) {
        sanitizedLang = trimmed;
      }
    }

    if (roomManager.isAtRoomCapacity()) {
      socket.emit('ERROR', { code: 'ERR_ROOM_FULL', message: 'ERR_ROOM_FULL' });
      return;
    }

    const room = roomManager.createRoom(
      socket.id,
      userId,
      cleanUrl,
      isSelfHosted ?? false,
      mode ?? 'DEFAULT',
      sanitizedLang
    );

    socket.join(room.roomId);

    const response: CreateRoomRes = {
      event: 'CREATE_ROOM_SUCCESS',
      roomId: room.roomId,
      data: {
        allowGuestControl: room.allowGuestControl,
        mode: room.mode,
        resumeToken: room.hostResumeToken
      }
    };

    socket.emit('CREATE_ROOM_SUCCESS', response);
  }, true, 'SENSITIVE');

  // 2. 加入房間
  registerSafeHandler<JoinRoomReq>(socket, 'JOIN_ROOM', (payload) => {
    const { roomId, data } = payload;
    if (!roomId || typeof roomId !== 'string' || !data || typeof data.userId !== 'string') {
      socket.emit('ERROR', {
        message: 'ERR_INVALID_CODE',
        code: 'ERR_INVALID_CODE'
      });
      return;
    }

    const isReconnecting = (data as any)?.isReconnecting;
    if (isReconnecting) {
      console.log(`[Socket.IO] 偵測到斷線回魂加入請求: ${sanitizeLog(data.userId)} (Room: ${sanitizeLog(roomId)})`);
    }

    cleanupPreviousSocketRoom(roomId);
    const result = roomManager.joinRoom(roomId, socket.id, data.userId, data.resumeToken);

    if (!result.success || !result.room) {
      const errCode = result.code || 'ERR_ROOM_NOT_FOUND';
      socket.emit('ERROR', {
        message: errCode,
        code: errCode
      });
      return;
    }

    const room = result.room;
    socket.join(room.roomId);

    socket.emit('JOIN_ROOM_SUCCESS', {
      event: 'JOIN_ROOM_SUCCESS',
      roomId: room.roomId,
      data: {
        allowGuestControl: room.allowGuestControl,
        currentUrl: room.currentUrl,
        isHost: result.isHost,
        mode: room.mode,
        hostSocketId: room.hostSocketId,
        resumeToken: result.isHost ? room.hostResumeToken : undefined
      }
    });

    // 通知房間其他成員有新進人員 (攜帶 socketId 以利 WebRTC P2P 建立連線)
    socket.to(room.roomId).emit('MEMBER_JOINED', {
      userId: data.userId,
      socketId: socket.id,
      memberCount: room.members.size,
      mode: room.mode
    });

    // 廣播最新人數給全房
    io.to(room.roomId).emit('MEMBER_COUNT_UPDATED', { count: room.members.size });

    // 規格 4.1：僅當新進人員為 Guest 時，向 Host 發送 REQUEST_CURRENT_STATE 拉取最新狀態
    if (socket.id !== room.hostSocketId) {
      console.log(`[Socket.IO] 向 Host (${sanitizeLog(room.hostSocketId)}) 發送 REQUEST_CURRENT_STATE 拉取狀態給新人員 (${sanitizeLog(socket.id)})`);
      io.to(room.hostSocketId).emit('REQUEST_CURRENT_STATE', {
        event: 'REQUEST_CURRENT_STATE',
        roomId: room.roomId,
        targetGuestSocketId: socket.id
      });
    }
  }, true, 'SENSITIVE');

  // 人數校準查詢
  registerSafeHandler<{ roomId: string }>(socket, 'GET_ROOM_MEMBER_COUNT', ({ roomId }) => {
    if (!roomId || typeof roomId !== 'string') return;
    const room = roomManager.getRoom(roomId);
    if (room) {
      socket.emit('MEMBER_COUNT_UPDATED', { count: room.members.size });
    }
  });

  // 觀眾頁面載入完成後主動拉取房主最新狀態 (解決跳轉導航期間錯過首次 REQUEST_CURRENT_STATE 之時序落差)
  registerSafeHandler<{ roomId?: string }>(socket, 'REQUEST_INIT_SYNC', (payload) => {
    const actualRoom = roomManager.getRoomBySocketId(socket.id);
    if (!actualRoom) return;
    if (payload?.roomId && payload.roomId.toUpperCase() !== actualRoom.roomId) return;
    if (socket.id === actualRoom.hostSocketId) return;

    io.to(actualRoom.hostSocketId).emit('REQUEST_CURRENT_STATE', {
      event: 'REQUEST_CURRENT_STATE',
      roomId: actualRoom.roomId,
      targetGuestSocketId: socket.id
    });
  }, true, 'GENERAL');

  // 3. 狀態同步廣播 (PLAY / PAUSE / SEEK / HEARTBEAT)
  // P0 防禦：嚴格以伺服器端 socketToRoom 為準，杜絕跨房注入攻擊
  registerSafeHandler<SyncStateMsg>(socket, 'SYNC_STATE', (payload) => {
    const actualRoom = roomManager.getRoomBySocketId(socket.id);
    if (!actualRoom) {
      socket.emit('ERROR', { code: 'ERR_ROOM_NOT_FOUND', message: 'ERR_ROOM_NOT_FOUND' });
      return;
    }

    if (payload.roomId && payload.roomId.toUpperCase() !== actualRoom.roomId) {
      console.warn(`[Security Alert] 偵測到跨房注入攻擊！Socket: ${sanitizeLog(socket.id)}, 試圖操控: ${sanitizeLog(payload.roomId)}`);
      socket.emit('ERROR', { code: 'ERR_PERMISSION_DENIED', message: 'ERR_PERMISSION_DENIED' });
      return;
    }

    // 後端二重安全檢查：未授權之 Guest 廣播直接 Drop
    if (!roomManager.canExecuteAction(socket.id)) {
      console.warn(`[Security Check Drop] Socket ${sanitizeLog(socket.id)} 嘗試觸發 SYNC_STATE 但無權限！`);
      socket.emit('ERROR', { code: 'ERR_PERMISSION_DENIED', message: 'ERR_PERMISSION_DENIED' });
      return;
    }

    // 嚴格執行期 Schema 與角色校驗 + 僅重組白名單欄位轉發，防範畸形數值與 Guest 偽造 HEARTBEAT
    const isHost = actualRoom.hostSocketId === socket.id;
    const validatedData = validateSyncData(payload.data, isHost);
    if (!validatedData) {
      console.warn(`[Security Check Drop] 收到非法 SYNC_STATE Payload 或 Guest 偽造 HEARTBEAT (Socket: ${sanitizeLog(socket.id)})`);
      return;
    }

    const cleanOutboundPayload: SyncStateMsg = {
      event: 'SYNC_STATE',
      roomId: actualRoom.roomId,
      data: validatedData
    };

    // 若包含目標 Guest Socket ID，代表是單向回傳狀態給新進觀眾
    if ((payload as any).targetGuestSocketId) {
      const targetId = (payload as any).targetGuestSocketId;
      const targetRoom = roomManager.getRoomBySocketId(targetId);
      if (!targetRoom || targetRoom.roomId !== actualRoom.roomId) {
        console.warn(`[Security Alert] 目標 Socket ${sanitizeLog(targetId)} 不在同一房間內，拒絕單向發送`);
        return;
      }
      cleanOutboundPayload.targetGuestSocketId = targetId;
      console.log(`[Socket.IO] 將拉取的初始化狀態獨立回傳給新觀眾: ${sanitizeLog(targetId)}`);
      io.to(targetId).emit('SYNC_STATE', cleanOutboundPayload);
    } else {
      // 廣播給房間內其他所有成員
      socket.to(actualRoom.roomId).emit('SYNC_STATE', cleanOutboundPayload);
    }
  }, true, 'SYNC');

  // 4. 強制網頁跳轉廣播 (REDIRECT_ROOM)
  registerSafeHandler<RedirectRoomMsg>(socket, 'REDIRECT_ROOM', (payload) => {
    const actualRoom = roomManager.getRoomBySocketId(socket.id);
    if (!actualRoom) return;

    if (payload.roomId && payload.roomId.toUpperCase() !== actualRoom.roomId) {
      console.warn(`[Security Alert] 阻絕跨房 REDIRECT_ROOM 操作`);
      return;
    }

    // 僅 Host 可發起網頁跳轉
    if (actualRoom.hostSocketId !== socket.id) {
      console.warn(`[Security Check Drop] 非 Host (${sanitizeLog(socket.id)}) 嘗試觸發 REDIRECT_ROOM`);
      socket.emit('ERROR', { code: 'ERR_HOST_ONLY', message: 'ERR_HOST_ONLY' });
      return;
    }

    if (!payload.data?.targetUrl || typeof payload.data.targetUrl !== 'string') {
      return;
    }

    const targetUrl = getCanonicalVideoUrl(payload.data.targetUrl);
    payload.data.targetUrl = targetUrl;
    const isSafe = isServerUrlAllowed(targetUrl, Boolean((payload?.data as any)?.allowUniversal));
    if (!isSafe) {
      console.warn(`[Security Alert] 攔截非白名單/惡意跳轉網址: ${sanitizeLog(targetUrl)} (Socket: ${sanitizeLog(socket.id)})`);
      socket.emit('ERROR', { code: 'ERR_UNAUTHORIZED_URL', message: 'ERR_UNAUTHORIZED_URL' });
      return;
    }

    actualRoom.currentUrl = targetUrl;
    console.log(`[Socket.IO] 廣播網頁跳轉事件: ${sanitizeLog(targetUrl)} (Room: ${sanitizeLog(actualRoom.roomId)})`);
    socket.to(actualRoom.roomId).emit('REDIRECT_ROOM', payload);
  });

  // 5. 房主權限變更廣播 (TOGGLE_PERMISSION)
  registerSafeHandler<TogglePermissionMsg>(socket, 'TOGGLE_PERMISSION', (payload) => {
    const actualRoom = roomManager.getRoomBySocketId(socket.id);
    if (!actualRoom || actualRoom.hostSocketId !== socket.id) {
      socket.emit('ERROR', { code: 'ERR_HOST_ONLY', message: 'ERR_HOST_ONLY' });
      return;
    }

    const allowGuestControl = Boolean(payload?.data?.allowGuestControl);
    const result = roomManager.togglePermission(socket.id, allowGuestControl);

    if (!result.success || !result.room) {
      socket.emit('ERROR', { code: 'ERR_UNKNOWN', message: result.error });
      return;
    }

    io.to(result.room.roomId).emit('TOGGLE_PERMISSION', {
      event: 'TOGGLE_PERMISSION',
      roomId: result.room.roomId,
      data: { allowGuestControl }
    });
  });

  // 6. 主動退出房間 (用戶手動點擊退房)
  registerSafeHandler<void>(socket, 'LEAVE_ROOM', () => {
    console.log(`[Socket.IO] 用戶主動退出房間: ${sanitizeLog(socket.id)}`);
    const result = roomManager.handleDisconnect(socket.id, undefined, true);
    if (result.roomId) {
      socket.leave(result.roomId);
      if (!result.roomClosed) {
        const room = roomManager.getRoom(result.roomId);
        io.to(result.roomId).emit('MEMBER_LEFT', {
          socketId: socket.id,
          isHost: result.isHost
        });
        if (room) {
          io.to(result.roomId).emit('MEMBER_COUNT_UPDATED', { count: room.members.size });
        }
      }
    }
  }, false);

  // 9. 離線處理 (非主動，支援 60 秒寬限期)
  socket.on('disconnect', () => {
    try {
      rateLimiter.removeSocket(socket.id);
      console.log(`[Socket.IO] 用戶斷開連線: ${sanitizeLog(socket.id)}`);
      const result = roomManager.handleDisconnect(socket.id, undefined, false);

      if (result.roomId && !result.roomClosed) {
        const room = roomManager.getRoom(result.roomId);
        io.to(result.roomId).emit('MEMBER_LEFT', {
          socketId: socket.id,
          isHost: result.isHost
        });
        if (room) {
          io.to(result.roomId).emit('MEMBER_COUNT_UPDATED', { count: room.members.size });
        }
      }
    } catch (err) {
      console.error('[Socket.IO] 處理 disconnect 異常:', err);
    }
  });
});

server.on('error', (err: any) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`❌ [Port 衝突] 通訊埠 ${PORT} 已被其他執行中程序佔用！`);
  } else {
    console.error(`❌ [伺服器錯誤]`, err);
  }
});

server.listen(PORT, () => {
  console.log(`================================================`);
  console.log(`🚀 Syncine WebSocket Server 啟動於 http://localhost:${PORT}`);
  const audit = checkNodeSecurityVersion();
  if (audit.isVulnerable) {
    console.warn(`[Security Warning] ⚠️ 當前 Node.js 執行版本 (v${audit.currentVersion}) 存在 Brotli 記憶體損壞高風險漏洞 (CVE-2026-111497)！${audit.recommendation}`);
  } else {
    console.log(`[Security Audit] ✅ Node.js 執行版本安全檢查通過 (v${audit.currentVersion})`);
  }
  console.log(`================================================`);
});

// ----------------------------------------------------
// 優雅停機 (Graceful Shutdown) 信號監聽 (適配 Docker / Fly.io 容器生命週期)
// ----------------------------------------------------
function handleGracefulShutdown(signal: string) {
  console.log(`\n🛑 收到 ${signal} 訊號，開始執行優雅停機流程 (Graceful Shutdown)...`);

  // 1. 廣播停機通知給全體在線 Socket 客戶端
  io.emit('SERVER_SHUTDOWN', { code: 'ERR_NETWORK_DISCONNECTED', message: 'ERR_NETWORK_DISCONNECTED' });

  // 2. 停止接受新的 HTTP / WebSocket 連線
  server.close(() => {
    console.log('✅ HTTP 伺服器已停止接收新連線');

    // 3. 安全關閉所有 Socket.IO 連線
    io.close(() => {
      console.log('✅ 所有 WebSocket 長連線已完全關閉');
      process.exit(0);
    });
  });

  // 4. 設定 8 秒超時強制退出，避免程序阻塞無響應
  setTimeout(() => {
    console.error('⚠️ 優雅停機超時 (8s)，強制終止程序');
    process.exit(1);
  }, 8000).unref();
}

process.on('SIGTERM', () => handleGracefulShutdown('SIGTERM'));
process.on('SIGINT', () => handleGracefulShutdown('SIGINT'));

// ----------------------------------------------------
// 全域例外防護 (P0: 防止任何未預期例外擊垮 Node.js 程序)
// ----------------------------------------------------
process.on('uncaughtException', (err) => {
  console.error('💥 [CRITICAL] 捕獲未處理異常 (避免程序崩潰):', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('💥 [CRITICAL] 捕獲未處理 Promise Rejection:', reason);
});

