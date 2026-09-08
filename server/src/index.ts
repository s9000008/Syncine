import express from 'express';
import http from 'http';
import { Server, Socket } from 'socket.io';
import dotenv from 'dotenv';
import cors from 'cors';
import { RoomManager } from './roomManager';
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
  SignalIceCandidateMsg
} from './types';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());

// 健康檢查 Endpoint
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'Syncine Socket Server', version: '2.1.0' });
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
roomManager.setHostTimeoutCallback((updatedRoom) => {
  io.to(updatedRoom.roomId).emit('HOST_CHANGED', {
    newHostUserId: updatedRoom.hostUserId,
    message: '原房主離線逾時，系統已轉移房主權限給新成員'
  });
  io.to(updatedRoom.roomId).emit('MEMBER_COUNT_UPDATED', { count: updatedRoom.members.size });
});

io.on('connection', (socket: Socket) => {
  console.log(`[Socket.IO] 新用戶連線: ${sanitizeLog(socket.id)}`);

  // 1. 建立房間
  socket.on('CREATE_ROOM', (payload: CreateRoomReq) => {
    const { userId, currentUrl, isSelfHosted, mode } = payload.data;
    const room = roomManager.createRoom(socket.id, userId, currentUrl, isSelfHosted ?? false, mode ?? 'DEFAULT');

    socket.join(room.roomId);

    const response: CreateRoomRes = {
      event: 'CREATE_ROOM_SUCCESS',
      roomId: room.roomId,
      data: {
        allowGuestControl: room.allowGuestControl,
        mode: room.mode
      }
    };

    socket.emit('CREATE_ROOM_SUCCESS', response);
  });

  // 2. 加入房間
  socket.on('JOIN_ROOM', (payload: JoinRoomReq) => {
    const { roomId, data } = payload;
    const isReconnecting = (data as any)?.isReconnecting;
    if (isReconnecting) {
      console.log(`[Socket.IO] 偵測到斷線回魂加入請求: ${sanitizeLog(data.userId)} (Room: ${sanitizeLog(roomId)})`);
    }

    const result = roomManager.joinRoom(roomId, socket.id, data.userId);

    if (!result.success || !result.room) {
      socket.emit('ERROR', { message: result.error || '加入房間失敗' });
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
        isHost: socket.id === room.hostSocketId,
        mode: room.mode,
        hostSocketId: room.hostSocketId
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
  });

  // 人數校準查詢
  socket.on('GET_ROOM_MEMBER_COUNT', ({ roomId }: { roomId: string }) => {
    const room = roomManager.getRoom(roomId);
    if (room) {
      socket.emit('MEMBER_COUNT_UPDATED', { count: room.members.size });
    }
  });

  // 3. 狀態同步廣播 (PLAY / PAUSE / SEEK / HEARTBEAT)
  socket.on('SYNC_STATE', (payload: SyncStateMsg) => {
    const { roomId, data } = payload;
    const room = roomManager.getRoom(roomId);

    if (!room) {
      socket.emit('ERROR', { message: '房間不存在' });
      return;
    }

    // 後端二重安全檢查：未授權之 Guest 廣播直接 Drop
    if (!roomManager.canExecuteAction(socket.id)) {
      console.warn(`[Security Check Drop] Socket ${sanitizeLog(socket.id)} 嘗試觸發 SYNC_STATE 但無權限！`);
      socket.emit('ERROR', { message: '權限不足：目前房主已停用觀眾操作權限' });
      return;
    }

    // 若包含目標 Guest Socket ID，代表是單向回傳狀態給新進觀眾
    if ((payload as any).targetGuestSocketId) {
      const targetId = (payload as any).targetGuestSocketId;
      console.log(`[Socket.IO] 將拉取的初始化狀態獨立回傳給新觀眾: ${sanitizeLog(targetId)}`);
      io.to(targetId).emit('SYNC_STATE', payload);
    } else {
      // 廣播給房間內其他所有成員
      socket.to(room.roomId).emit('SYNC_STATE', payload);
    }
  });

  // 4. 強制網頁跳轉廣播 (REDIRECT_ROOM)
  socket.on('REDIRECT_ROOM', (payload: RedirectRoomMsg) => {
    const { roomId, data } = payload;
    const room = roomManager.getRoom(roomId);

    if (!room) return;

    // 僅 Host 可發起網頁跳轉
    if (room.hostSocketId !== socket.id) {
      console.warn(`[Security Check Drop] 非 Host (${sanitizeLog(socket.id)}) 嘗試觸發 REDIRECT_ROOM`);
      socket.emit('ERROR', { message: '僅房主可進行網頁同步跳轉' });
      return;
    }

    room.currentUrl = data.targetUrl;
    console.log(`[Socket.IO] 廣播網頁跳轉事件: ${sanitizeLog(data.targetUrl)} (Room: ${sanitizeLog(roomId)})`);
    socket.to(room.roomId).emit('REDIRECT_ROOM', payload);
  });

  // 5. 房主權限變更廣播 (TOGGLE_PERMISSION)
  socket.on('TOGGLE_PERMISSION', (payload: TogglePermissionMsg) => {
    const { allowGuestControl } = payload.data;
    const result = roomManager.togglePermission(socket.id, allowGuestControl);

    if (!result.success || !result.room) {
      socket.emit('ERROR', { message: result.error });
      return;
    }

    io.to(result.room.roomId).emit('TOGGLE_PERMISSION', {
      event: 'TOGGLE_PERMISSION',
      roomId: result.room.roomId,
      data: { allowGuestControl }
    });
  });

  // 6. WebRTC 信令轉發 (P2P DataChannel 握手)
  socket.on('SIGNAL_OFFER', (payload: SignalOfferMsg) => {
    const { roomId, data } = payload;
    data.senderSocketId = socket.id;
    if (data.targetSocketId) {
      console.log(`[WebRTC Signaling] 轉發 SIGNAL_OFFER 至 targetSocketId: ${sanitizeLog(data.targetSocketId)}`);
      io.to(data.targetSocketId).emit('SIGNAL_OFFER', payload);
    } else {
      socket.to(roomId).emit('SIGNAL_OFFER', payload);
    }
  });

  socket.on('SIGNAL_ANSWER', (payload: SignalAnswerMsg) => {
    const { roomId, data } = payload;
    data.senderSocketId = socket.id;
    if (data.targetSocketId) {
      console.log(`[WebRTC Signaling] 轉發 SIGNAL_ANSWER 至 targetSocketId: ${sanitizeLog(data.targetSocketId)}`);
      io.to(data.targetSocketId).emit('SIGNAL_ANSWER', payload);
    } else {
      socket.to(roomId).emit('SIGNAL_ANSWER', payload);
    }
  });

  socket.on('SIGNAL_ICE_CANDIDATE', (payload: SignalIceCandidateMsg) => {
    const { roomId, data } = payload;
    data.senderSocketId = socket.id;
    if (data.targetSocketId) {
      io.to(data.targetSocketId).emit('SIGNAL_ICE_CANDIDATE', payload);
    } else {
      socket.to(roomId).emit('SIGNAL_ICE_CANDIDATE', payload);
    }
  });

  // 7. WebRTC 連線受阻時的降級回退廣播
  socket.on('P2P_FALLBACK', (payload: { roomId: string; reason?: string }) => {
    console.log(`[WebRTC Signaling] 房間 ${sanitizeLog(payload.roomId)} 收到 P2P_FALLBACK 請求，通知全體成員切換為中繼模式`);
    const room = roomManager.getRoom(payload.roomId);
    if (room) {
      room.mode = 'DEFAULT';
      io.to(room.roomId).emit('P2P_FALLBACK', {
        roomId: room.roomId,
        message: payload.reason || 'WebRTC 直連受阻，系統已自動降級回退至伺服器中繼模式'
      });
    }
  });

  // 8. 主動退出房間 (用戶手動點擊退房)
  socket.on('LEAVE_ROOM', () => {
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
  });

  // 9. 離線處理 (非主動，支援 60 秒寬限期)
  socket.on('disconnect', () => {
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
