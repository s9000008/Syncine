import http from 'http';
import express from 'express';
import { Server, Socket } from 'socket.io';
import { RoomManager } from './src/roomManager';
import { sanitizeLog } from './src/utils';
import { io as ClientSocket, Socket as ClientSocketType } from '../extension/node_modules/socket.io-client';

async function runAllTests() {
  console.log('====================================================');
  console.log('🧪 Syncine 核心功能與協定自動化測試套件開始執行');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${testName} ${detail ? `- ${detail}` : ''}`);
      failed++;
    }
  }

  // ----------------------------------------------------
  // 1. 單元測試：Log 注入防護 (sanitizeLog)
  // ----------------------------------------------------
  console.log('--- 模組 1: Log 資訊注入攻擊防護 (sanitizeLog) ---');
  {
    const crlfInput = 'admin_user\r\n[CRITICAL] System Compromised\nFake Line';
    const sanitized = sanitizeLog(crlfInput);
    assert(!sanitized.includes('\r') && !sanitized.includes('\n'), '過濾 CRLF 換行符號防禦日誌偽造');
    assert(sanitized.includes('admin_user') && sanitized.includes('Fake Line'), '保留有效內容為單行字串');

    const xssInput = '<script>alert(1)</script>';
    const sanitizedXss = sanitizeLog(xssInput);
    assert(!sanitizedXss.includes('<script>') && sanitizedXss.includes('&lt;script&gt;'), '過濾 HTML 特殊字元防禦 XSS');

    const controlCharInput = 'user\x00\x07\x1B[31m_hack';
    const sanitizedControl = sanitizeLog(controlCharInput);
    assert(!sanitizedControl.includes('\x00') && !sanitizedControl.includes('\x07'), '過濾終端機控制字元');

    const longInput = 'A'.repeat(500);
    const sanitizedLong = sanitizeLog(longInput, 50);
    assert(sanitizedLong.length === 50, '正確截斷超長輸入防止日誌爆破');

    assert(sanitizeLog(null) === '', '處理 null 輸入');
    assert(sanitizeLog(undefined) === '', '處理 undefined 輸入');
  }

  // ----------------------------------------------------
  // 2. 單元測試：房間管理器 (RoomManager) 核心邏輯
  // ----------------------------------------------------
  console.log('\n--- 模組 2: RoomManager 核心邏輯與狀態邊界測試 ---');
  {
    const manager = new RoomManager();

    // 2.1 建立房間
    const room = manager.createRoom('socket_host_1', 'user_host', 'https://www.youtube.com/watch?v=test1234', false, 'DEFAULT');
    assert(typeof room.roomId === 'string' && room.roomId.length === 6, '建立房間產生標準 6 碼大寫代碼', room.roomId);
    assert(room.hostUserId === 'user_host', '正確標定房主身分');
    assert(room.members.size === 1, '房主建立後成員數為 1');
    assert(manager.canExecuteAction('socket_host_1') === true, '房主預設具備播放操作權限');

    // 2.2 觀眾加入房間
    const joinRes = manager.joinRoom(room.roomId, 'socket_guest_1', 'user_guest');
    assert(joinRes.success === true && joinRes.room?.members.size === 2, '觀眾順利加入房間，成員數增為 2');
    assert(manager.canExecuteAction('socket_guest_1') === false, '預設狀態下觀眾無操作權限 (雙重防禦)');

    // 2.3 權限切換
    const toggleRes = manager.togglePermission('socket_host_1', true);
    assert(toggleRes.success === true && toggleRes.room?.allowGuestControl === true, '房主可成功切換開放觀眾權限');
    assert(manager.canExecuteAction('socket_guest_1') === true, '開放後觀眾獲得播放操作權限');

    // 非 Host 嘗試修改權限應被拒絕
    const unauthorizedToggle = manager.togglePermission('socket_guest_1', false);
    assert(unauthorizedToggle.success === false, '非房主嘗試修改權限直接拒絕');

    // 2.4 主動退房 (Explicit Leave) 應立即銷毀房間（當全空時）
    const tempRoom = manager.createRoom('socket_temp_1', 'user_temp', 'https://www.youtube.com/watch?v=temp', false, 'DEFAULT');
    const tempRoomId = tempRoom.roomId;
    const leaveRes = manager.handleDisconnect('socket_temp_1', undefined, true);
    assert(leaveRes.roomClosed === true, '單人房間主動退出時立即銷毀房間');
    assert(manager.getRoom(tempRoomId) === undefined, '確認主動退房後房間已從記憶體中移除');

    // 2.5 突發斷線 (Grace Period 寬限期) 測試
    const graceRoom = manager.createRoom('socket_grace_1', 'user_grace', 'https://www.youtube.com/watch?v=grace', false, 'DEFAULT');
    const graceRoomId = graceRoom.roomId;
    const unexpectedDiscRes = manager.handleDisconnect('socket_grace_1', undefined, false);
    assert(unexpectedDiscRes.roomClosed === false, '突發意外斷線且成員為0時，不立即關閉房間，啟動 60 秒保留寬限期');
    assert(manager.getRoom(graceRoomId) !== undefined, '寬限期內房間仍維持在記憶體中保留');

    // 斷線回魂加入測試 (成員在寬限期內連回)
    const rejoinRes = manager.joinRoom(graceRoomId, 'socket_grace_reconnect', 'user_grace');
    assert(rejoinRes.success === true, '成員在寬限期內成功回魂加入房間');
    assert(graceRoom.emptyRoomTimer === undefined, '成員回魂後自動取消 60 秒銷毀倒數計時器');
    assert(graceRoom.members.size === 1, '回魂後成員數恢復正常');
  }

  // ----------------------------------------------------
  // 3. 整合測試：WebSocket 伺服器端點與 Socket.IO 協定
  // ----------------------------------------------------
  console.log('\n--- 模組 3: 伺服器端點與即時協定整合測試 ---');

  const app = express();
  app.use(express.json());
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'Syncine Socket Server', version: '2.0.0' });
  });

  const httpServer = http.createServer(app);
  const ioServer = new Server(httpServer, {
    cors: { origin: '*' },
    transports: ['websocket', 'polling']
  });

  const roomManager = new RoomManager();
  roomManager.setHostTimeoutCallback((updatedRoom) => {
    ioServer.to(updatedRoom.roomId).emit('HOST_CHANGED', {
      newHostUserId: updatedRoom.hostUserId,
      message: '原房主離線逾時，系統已轉移房主權限給新成員'
    });
    ioServer.to(updatedRoom.roomId).emit('MEMBER_COUNT_UPDATED', { count: updatedRoom.members.size });
  });

  ioServer.on('connection', (socket: Socket) => {
    socket.on('CREATE_ROOM', (payload: any) => {
      const { userId, currentUrl, isSelfHosted, mode } = payload.data;
      const room = roomManager.createRoom(socket.id, userId, currentUrl, isSelfHosted ?? false, mode ?? 'DEFAULT');
      socket.join(room.roomId);
      socket.emit('CREATE_ROOM_SUCCESS', {
        event: 'CREATE_ROOM_SUCCESS',
        roomId: room.roomId,
        data: {
          allowGuestControl: room.allowGuestControl,
          mode: room.mode
        }
      });
    });

    socket.on('JOIN_ROOM', (payload: any) => {
      const { roomId, data } = payload;
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
      socket.to(room.roomId).emit('MEMBER_JOINED', {
        userId: data.userId,
        socketId: socket.id,
        memberCount: room.members.size
      });
      ioServer.to(room.roomId).emit('MEMBER_COUNT_UPDATED', { count: room.members.size });
    });

    socket.on('SYNC_STATE', (payload: any) => {
      const { roomId } = payload;
      const room = roomManager.getRoom(roomId);
      if (!room) return;
      if (!roomManager.canExecuteAction(socket.id)) {
        socket.emit('ERROR', { message: '權限不足：目前房主已停用觀眾操作權限' });
        return;
      }
      socket.to(room.roomId).emit('SYNC_STATE', payload);
    });

    socket.on('REDIRECT_ROOM', (payload: any) => {
      const { roomId, data } = payload;
      const room = roomManager.getRoom(roomId);
      if (!room || room.hostSocketId !== socket.id) {
        socket.emit('ERROR', { message: '僅房主可進行網頁同步跳轉' });
        return;
      }
      room.currentUrl = data.targetUrl;
      socket.to(room.roomId).emit('REDIRECT_ROOM', payload);
    });

    socket.on('LEAVE_ROOM', () => {
      const result = roomManager.handleDisconnect(socket.id, undefined, true);
      if (result.roomId) {
        socket.leave(result.roomId);
        if (!result.roomClosed) {
          socket.to(result.roomId).emit('MEMBER_LEFT', { socketId: socket.id, isHost: result.isHost });
        }
      }
    });

    socket.on('disconnect', () => {
      const result = roomManager.handleDisconnect(socket.id, undefined, false);
      if (result.roomId && !result.roomClosed) {
        ioServer.to(result.roomId).emit('MEMBER_LEFT', { socketId: socket.id, isHost: result.isHost });
      }
    });
  });

  const TEST_PORT = 3999;
  await new Promise<void>((res) => httpServer.listen(TEST_PORT, res));

  try {
    // 3.1 測試 /health 端點
    const healthRes = await fetch(`http://localhost:${TEST_PORT}/health`).then((r) => r.json());
    assert(healthRes.status === 'ok' && healthRes.service === 'Syncine Socket Server', 'HTTP GET /health 健康檢查端點正常回應');

    // 3.2 測試 Socket 客戶端連線與建房
    const hostClient: ClientSocketType = ClientSocket(`http://localhost:${TEST_PORT}`, { transports: ['websocket'] });
    const guestClient: ClientSocketType = ClientSocket(`http://localhost:${TEST_PORT}`, { transports: ['websocket'] });

    await new Promise<void>((resolve) => {
      let count = 0;
      const checkDone = () => {
        count++;
        if (count === 2) resolve();
      };
      hostClient.on('connect', checkDone);
      guestClient.on('connect', checkDone);
    });
    assert(hostClient.connected && guestClient.connected, 'Host 與 Guest Socket 客戶端連線成功');

    // 3.3 建房請求測試
    let createdRoomId = '';
    await new Promise<void>((resolve) => {
      hostClient.emit('CREATE_ROOM', {
        event: 'CREATE_ROOM',
        data: {
          userId: 'host_tester',
          currentUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          mode: 'DEFAULT'
        }
      });
      hostClient.on('CREATE_ROOM_SUCCESS', (res: any) => {
        createdRoomId = res.roomId;
        assert(typeof res.roomId === 'string' && res.roomId.length === 6, '收到 CREATE_ROOM_SUCCESS 攜帶 6 碼 RoomID');
        resolve();
      });
    });

    // 3.4 觀眾加入房間測試
    await new Promise<void>((resolve) => {
      let joinSuccess = false;
      let memberJoinedReceived = false;

      const checkBoth = () => {
        if (joinSuccess && memberJoinedReceived) resolve();
      };

      hostClient.on('MEMBER_JOINED', (res: any) => {
        assert(res.userId === 'guest_tester', 'Host 端收到 MEMBER_JOINED 通知');
        memberJoinedReceived = true;
        checkBoth();
      });

      guestClient.emit('JOIN_ROOM', {
        event: 'JOIN_ROOM',
        roomId: createdRoomId,
        data: {
          userId: 'guest_tester',
          mode: 'DEFAULT'
        }
      });

      guestClient.on('JOIN_ROOM_SUCCESS', (res: any) => {
        assert(res.roomId === createdRoomId && res.data.isHost === false, 'Guest 端收到 JOIN_ROOM_SUCCESS 且確認身分為 Guest');
        joinSuccess = true;
        checkBoth();
      });
    });

    // 3.5 狀態同步廣播與安全攔截測試
    // 3.5.1 未授權時 Guest 嘗試發起播放應被攔截
    await new Promise<void>((resolve) => {
      guestClient.emit('SYNC_STATE', {
        event: 'SYNC_STATE',
        roomId: createdRoomId,
        data: {
          action: 'PLAY',
          currentTime: 12.345,
          timestamp: Date.now()
        }
      });

      guestClient.once('ERROR', (err: any) => {
        assert(err.message.includes('權限不足'), 'Guest 無權限時發送 SYNC_STATE 正確被伺服器攔截 (ERROR)');
        resolve();
      });
    });

    // 3.5.2 Host 發起同步，Guest 應正常接收
    await new Promise<void>((resolve) => {
      guestClient.once('SYNC_STATE', (msg: any) => {
        assert(msg.data.action === 'PLAY' && msg.data.currentTime === 45.678, 'Host 發起 PLAY 事件，Guest 順利接收廣播');
        resolve();
      });

      hostClient.emit('SYNC_STATE', {
        event: 'SYNC_STATE',
        roomId: createdRoomId,
        data: {
          action: 'PLAY',
          currentTime: 45.678,
          timestamp: Date.now()
        }
      });
    });

    // 3.6 網頁同步跳轉測試 (REDIRECT_ROOM)
    await new Promise<void>((resolve) => {
      const targetUrl = 'https://www.youtube.com/watch?v=abcdefghijk';
      guestClient.once('REDIRECT_ROOM', (msg: any) => {
        assert(msg.data.targetUrl === targetUrl, 'Host 發起網頁同步跳轉，Guest 順利接收 REDIRECT_ROOM');
        resolve();
      });

      hostClient.emit('REDIRECT_ROOM', {
        event: 'REDIRECT_ROOM',
        roomId: createdRoomId,
        data: { targetUrl }
      });
    });

    // 3.7 主動退房通知測試 (LEAVE_ROOM)
    await new Promise<void>((resolve) => {
      hostClient.once('MEMBER_LEFT', (msg: any) => {
        assert(msg.socketId === guestClient.id, 'Guest 主動退房，Host 順利收到 MEMBER_LEFT 通知');
        resolve();
      });

      guestClient.emit('LEAVE_ROOM');
    });

    hostClient.disconnect();
    guestClient.disconnect();

  } finally {
    await new Promise<void>((res) => httpServer.close(() => res()));
    ioServer.close();
  }

  // ----------------------------------------------------
  // 測試結果總結
  // ----------------------------------------------------
  console.log('\n====================================================');
  console.log(`📊 測試執行完畢: 共 ${passed + failed} 項測試 | 通過: ${passed} | 失敗: ${failed}`);
  console.log('====================================================');

  if (failed > 0) {
    process.exit(1);
  } else {
    console.log('🎉 所有單元與整合測試皆 100% 通過！\n');
  }
}

runAllTests().catch((err) => {
  console.error('執行測試套件發生未預期錯誤:', err);
  process.exit(1);
});
