import express from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { Server, Socket } from 'socket.io';
import dotenv from 'dotenv';
import cors from 'cors';
import { RoomManager } from './roomManager';
import { RateLimiter } from './rateLimiter';
import { sanitizeLog } from './utils';
import {
  CreateRoomReq,
  JoinRoomReq,
  SyncStateMsg,
  RedirectRoomMsg,
  TogglePermissionMsg,
  CreateRoomRes,
  SignalOfferMsg,
  SignalAnswerMsg,
  SignalIceCandidateMsg,
  SERVER_HOST_WHITELIST, isServerUrlAllowed, getCanonicalVideoUrl
} from './types';

dotenv.config();

const serverPkg = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf-8')
);
const SERVER_VERSION: string = serverPkg.version;

const app = express();
const PORT = process.env.PORT || 3000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());

// 健康檢查 Endpoint
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'Syncine Socket Server', version: SERVER_VERSION });
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: (_origin, callback) => {
      // 允許所有來源連線，包含 chrome-extension:// 與 localhost
      callback(null, true);
    },
    methods: ['GET', 'POST'],
    credentials: true
  },
  transports: ['websocket', 'polling']
});

const roomManager = new RoomManager();
const rateLimiter = new RateLimiter();

roomManager.setHostTimeoutCallback((updatedRoom) => {
  io.to(updatedRoom.roomId).emit('HOST_CHANGED', {
    newHostUserId: updatedRoom.hostUserId,
    message: '原房主離線逾時，系統已轉移房主權限給新成員'
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
        socket.emit('ERROR', { code: 'ERR_RATE_LIMITED', message: '請求過於頻繁，連線已中斷' });
        socket.disconnect(true);
        return;
      }

      if (!check.allowed) {
        if (rateLimitType === 'SYNC') {
          // 高頻同步信號超限採取靜默丟棄 (Silent Drop)，杜絕廣播風暴
          return;
        }
        console.warn(`[RateLimit Blocked] 事件頻率超限 (${eventName}) 來自: ${sanitizeLog(socket.id)}`);
        socket.emit('ERROR', { code: 'ERR_RATE_LIMITED', message: '操作過於頻繁，請稍候再試' });
        return;
      }

      // 2. 畸形 Payload 校驗
      if (requirePayloadObject && (!payload || typeof payload !== 'object')) {
        console.warn(`[SafeHandler Blocked] 收到非法畸形 Payload (${eventName}) 來自: ${sanitizeLog(socket.id)}`);
        socket.emit('ERROR', { code: 'ERR_INVALID_CODE', message: '請求格式錯誤' });
        return;
      }
      await handler(payload);
    } catch (err: any) {
      console.error(`[SafeHandler Catched] 執行事件 ${eventName} 拋出未預期例外:`, err);
      socket.emit('ERROR', { code: 'ERR_UNKNOWN', message: '伺服器內部錯誤' });
    }
  });
}

io.on('connection', (socket: Socket) => {
  console.log(`[Socket.IO] 新用戶連線: ${sanitizeLog(socket.id)}`);

  // 1. 建立房間
  registerSafeHandler<CreateRoomReq>(socket, 'CREATE_ROOM', (payload) => {
    const { userId, currentUrl, isSelfHosted, mode, language } = payload?.data || {};
    const cleanUrl = getCanonicalVideoUrl(currentUrl);

    // 資安防護：驗證語系格式 (BCP 47 標籤格式，限制 10 字元內，避免惡意注入)
    let sanitizedLang: string | undefined = undefined;
    if (typeof language === 'string') {
      const trimmed = language.trim();
      if (/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,4})?$/.test(trimmed) && trimmed.length <= 10) {
        sanitizedLang = trimmed;
      }
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
        message: '加入房間參數不合法',
        code: 'ERR_INVALID_CODE'
      });
      return;
    }

    const isReconnecting = (data as any)?.isReconnecting;
    if (isReconnecting) {
      console.log(`[Socket.IO] 偵測到斷線回魂加入請求: ${sanitizeLog(data.userId)} (Room: ${sanitizeLog(roomId)})`);
    }

    const result = roomManager.joinRoom(roomId, socket.id, data.userId, data.resumeToken);

    if (!result.success || !result.room) {
      socket.emit('ERROR', { 
        message: result.error || '加入房間失敗',
        code: result.code || 'ERR_ROOM_NOT_FOUND'
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

  // 3. 狀態同步廣播 (PLAY / PAUSE / SEEK / HEARTBEAT)
  // P0 防禦：嚴格以伺服器端 socketToRoom 為準，杜絕跨房注入攻擊
  registerSafeHandler<SyncStateMsg>(socket, 'SYNC_STATE', (payload) => {
    const actualRoom = roomManager.getRoomBySocketId(socket.id);
    if (!actualRoom) {
      socket.emit('ERROR', { code: 'ERR_ROOM_NOT_FOUND', message: '您尚未加入任何房間' });
      return;
    }

    if (payload.roomId && payload.roomId.toUpperCase() !== actualRoom.roomId) {
      console.warn(`[Security Alert] 偵測到跨房注入攻擊！Socket: ${sanitizeLog(socket.id)}, 試圖操控: ${sanitizeLog(payload.roomId)}`);
      socket.emit('ERROR', { code: 'ERR_PERMISSION_DENIED', message: '無權限操作非所屬房間' });
      return;
    }

    // 後端二重安全檢查：未授權之 Guest 廣播直接 Drop
    if (!roomManager.canExecuteAction(socket.id)) {
      console.warn(`[Security Check Drop] Socket ${sanitizeLog(socket.id)} 嘗試觸發 SYNC_STATE 但無權限！`);
      socket.emit('ERROR', { code: 'ERR_PERMISSION_DENIED', message: '權限不足：目前房主已停用觀眾操作權限' });
      return;
    }

    // 若包含目標 Guest Socket ID，代表是單向回傳狀態給新進觀眾
    if ((payload as any).targetGuestSocketId) {
      const targetId = (payload as any).targetGuestSocketId;
      const targetRoom = roomManager.getRoomBySocketId(targetId);
      if (!targetRoom || targetRoom.roomId !== actualRoom.roomId) {
        console.warn(`[Security Alert] 目標 Socket ${sanitizeLog(targetId)} 不在同一房間內，拒絕單向發送`);
        return;
      }
      console.log(`[Socket.IO] 將拉取的初始化狀態獨立回傳給新觀眾: ${sanitizeLog(targetId)}`);
      io.to(targetId).emit('SYNC_STATE', payload);
    } else {
      // 廣播給房間內其他所有成員
      socket.to(actualRoom.roomId).emit('SYNC_STATE', payload);
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
      socket.emit('ERROR', { code: 'ERR_HOST_ONLY', message: '僅房主可進行網頁同步跳轉' });
      return;
    }

    if (!payload.data?.targetUrl || typeof payload.data.targetUrl !== 'string') {
      return;
    }

    const targetUrl = getCanonicalVideoUrl(payload.data.targetUrl);
    payload.data.targetUrl = targetUrl;
    const isSafe = isServerUrlAllowed(targetUrl);
    if (!isSafe) {
      console.warn(`[Security Alert] 攔截非白名單/惡意跳轉網址: ${sanitizeLog(targetUrl)} (Socket: ${sanitizeLog(socket.id)})`);
      socket.emit('ERROR', { code: 'ERR_UNAUTHORIZED_URL', message: '目標網址未在授權白名單中' });
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
      socket.emit('ERROR', { code: 'ERR_HOST_ONLY', message: '僅房主可修改權限' });
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

  // 6. WebRTC 信令轉發 (P2P DataChannel 握手) - 需確保同房成員
  registerSafeHandler<SignalOfferMsg>(socket, 'SIGNAL_OFFER', (payload) => {
    const actualRoom = roomManager.getRoomBySocketId(socket.id);
    if (!actualRoom || !payload.data || typeof payload.data !== 'object') return;

    payload.roomId = actualRoom.roomId;
    payload.data.senderSocketId = socket.id;
    if (payload.data.targetSocketId) {
      const targetRoom = roomManager.getRoomBySocketId(payload.data.targetSocketId);
      if (targetRoom && targetRoom.roomId === actualRoom.roomId) {
        console.log(`[WebRTC Signaling] 轉發 SIGNAL_OFFER 至 targetSocketId: ${sanitizeLog(payload.data.targetSocketId)}`);
        io.to(payload.data.targetSocketId).emit('SIGNAL_OFFER', payload);
      }
    } else {
      socket.to(actualRoom.roomId).emit('SIGNAL_OFFER', payload);
    }
  });

  registerSafeHandler<SignalAnswerMsg>(socket, 'SIGNAL_ANSWER', (payload) => {
    const actualRoom = roomManager.getRoomBySocketId(socket.id);
    if (!actualRoom || !payload.data || typeof payload.data !== 'object') return;

    payload.roomId = actualRoom.roomId;
    payload.data.senderSocketId = socket.id;
    if (payload.data.targetSocketId) {
      const targetRoom = roomManager.getRoomBySocketId(payload.data.targetSocketId);
      if (targetRoom && targetRoom.roomId === actualRoom.roomId) {
        console.log(`[WebRTC Signaling] 轉發 SIGNAL_ANSWER 至 targetSocketId: ${sanitizeLog(payload.data.targetSocketId)}`);
        io.to(payload.data.targetSocketId).emit('SIGNAL_ANSWER', payload);
      }
    } else {
      socket.to(actualRoom.roomId).emit('SIGNAL_ANSWER', payload);
    }
  });

  registerSafeHandler<SignalIceCandidateMsg>(socket, 'SIGNAL_ICE_CANDIDATE', (payload) => {
    const actualRoom = roomManager.getRoomBySocketId(socket.id);
    if (!actualRoom || !payload.data || typeof payload.data !== 'object') return;

    payload.roomId = actualRoom.roomId;
    payload.data.senderSocketId = socket.id;
    if (payload.data.targetSocketId) {
      const targetRoom = roomManager.getRoomBySocketId(payload.data.targetSocketId);
      if (targetRoom && targetRoom.roomId === actualRoom.roomId) {
        io.to(payload.data.targetSocketId).emit('SIGNAL_ICE_CANDIDATE', payload);
      }
    } else {
      socket.to(actualRoom.roomId).emit('SIGNAL_ICE_CANDIDATE', payload);
    }
  });

  // 7. WebRTC 連線受阻時的降級回退廣播
  registerSafeHandler<{ roomId: string; reason?: string }>(socket, 'P2P_FALLBACK', (payload) => {
    const actualRoom = roomManager.getRoomBySocketId(socket.id);
    if (!actualRoom) return;

    console.log(`[WebRTC Signaling] 房間 ${sanitizeLog(actualRoom.roomId)} 收到 P2P_FALLBACK 請求，通知全體成員切換為中繼模式`);
    actualRoom.mode = 'DEFAULT';
    io.to(actualRoom.roomId).emit('P2P_FALLBACK', {
      roomId: actualRoom.roomId,
      message: payload?.reason || 'WebRTC 直連受阻，系統已自動降級回退至伺服器中繼模式'
    });
  });

  // 8. 主動退出房間 (用戶手動點擊退房)
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
  console.log(`================================================`);
});

// ----------------------------------------------------
// 優雅停機 (Graceful Shutdown) 信號監聽 (適配 Docker / Fly.io 容器生命週期)
// ----------------------------------------------------
function handleGracefulShutdown(signal: string) {
  console.log(`\n🛑 收到 ${signal} 訊號，開始執行優雅停機流程 (Graceful Shutdown)...`);

  // 1. 廣播停機通知給全體在線 Socket 客戶端
  io.emit('SERVER_SHUTDOWN', { message: '伺服器正在進行更新維護，連線將短暫中斷' });

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

