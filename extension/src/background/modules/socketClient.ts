import { io, Socket } from 'socket.io-client';
import { getCanonicalVideoUrl, validateSyncData } from '../../types/protocol';
import { sanitizeLog } from '../../utils/sanitize';
import { getRoomState, getUserId, persistRoomSession, setRoomState } from './session';
import { broadcastRoomState, broadcastToVideoTabs, isUrlAllowed, verifyAndRedirect } from './redirector';

let socket: Socket | null = null;
let memberCountSyncTimer: ReturnType<typeof setInterval> | null = null;

export function getSocket(): Socket | null {
  return socket;
}

export function clearMemberCountSyncTimer(): void {
  if (memberCountSyncTimer) {
    clearInterval(memberCountSyncTimer);
    memberCountSyncTimer = null;
  }
}

export function disconnectSocket(notifyLeave: boolean = false): void {
  clearMemberCountSyncTimer();
  if (socket) {
    if (notifyLeave) {
      socket.emit('LEAVE_ROOM');
    }
    socket.disconnect();
    socket = null;
  }
}

/**
 * 建立與維護 Socket.IO 中繼連線 (含斷線自動重連與房間回魂)
 */
export function initSocketConnection(serverUrl: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    if (socket && socket.connected && (socket as any)._serverUrl === serverUrl) {
      console.log(`[Background] 重用現有 Socket.IO 連線: ${sanitizeLog(serverUrl)}`);
      return resolve(socket);
    }

    disconnectSocket(false);
    console.log(`[Background] 初始化 Socket.IO 連線: ${sanitizeLog(serverUrl)}`);

    const newSocket = io(serverUrl, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 8000
    });
    (newSocket as any)._serverUrl = serverUrl;
    socket = newSocket;

    let isSettled = false;
    let connectCount = 0;

    const cleanupOnInitialFailure = () => {
      newSocket.disconnect();
      if (socket === newSocket) {
        socket = null;
      }
      clearMemberCountSyncTimer();
    };

    const connectTimer = setTimeout(() => {
      if (!isSettled) {
        isSettled = true;
        cleanupOnInitialFailure();
        reject(new Error('ERR_SERVER_TIMEOUT'));
      }
    }, 8000);

    newSocket.on('connect', () => {
      connectCount++;
      if (!isSettled) {
        isSettled = true;
        clearTimeout(connectTimer);
        console.log(`[Background] Socket.IO 已成功連線至: ${sanitizeLog(serverUrl)} (ID: ${newSocket.id})`);
        resolve(newSocket);
      }

      const currentRoomState = getRoomState();
      if (currentRoomState) {
        currentRoomState.connectionStatus = 'CONNECTED';
        persistRoomSession(currentRoomState);

        // 若為斷線後的重新連線，自動發送 JOIN_ROOM 進行房間狀態回魂
        if (connectCount > 1 && currentRoomState.roomId && currentRoomState.mode !== 'P2P') {
          console.log(
            `[Background Reconnect] 網路連線已恢復 (ID: ${newSocket.id})，自動發送 JOIN_ROOM 回魂加入房間: ${sanitizeLog(currentRoomState.roomId)}`
          );
          newSocket.emit('JOIN_ROOM', {
            event: 'JOIN_ROOM',
            roomId: currentRoomState.roomId,
            data: {
              userId: getUserId(),
              mode: currentRoomState.mode,
              isReconnecting: true,
              resumeToken: currentRoomState.resumeToken
            }
          });
        }

        broadcastRoomState(currentRoomState);
      }
    });

    newSocket.once('connect_error', (err) => {
      if (!isSettled) {
        isSettled = true;
        clearTimeout(connectTimer);
        cleanupOnInitialFailure();
        console.warn(`[Background] Socket.IO 首連失敗 (${sanitizeLog(serverUrl)}):`, sanitizeLog(err.message));
        reject(new Error('ERR_SERVER_UNREACHABLE'));
      }
    });

    newSocket.io.on('reconnect_attempt', (attempt) => {
      console.log(`[Background Reconnect] 正在嘗試重新連線至伺服器 (第 ${attempt} 次)...`);
      const currentRoomState = getRoomState();
      if (currentRoomState && currentRoomState.connectionStatus !== 'RECONNECTING') {
        currentRoomState.connectionStatus = 'RECONNECTING';
        broadcastRoomState(currentRoomState);
      }
    });

    // 接收 SYNC_STATE 訊息轉發至 Content Script
    newSocket.on('SYNC_STATE', (data) => {
      const currentRoomState = getRoomState();
      if (currentRoomState?.mode === 'P2P' && currentRoomState?.p2pStatus === 'CONNECTED') {
        return;
      }
      const syncPacket = data?.data || data;
      const checked = validateSyncData(syncPacket, true);
      if (!checked) {
        console.warn('[Background Security Drop] 捨棄格式無效的中繼 SYNC_STATE 封包');
        return;
      }
      broadcastToVideoTabs({
        type: 'CS_SYNC_RECEIVED',
        payload: data?.data ? { ...data, data: checked } : checked
      });
    });

    // 接收 REQUEST_CURRENT_STATE (Host 被要求回傳當前狀態給新觀眾)
    newSocket.on('REQUEST_CURRENT_STATE', (data) => {
      console.log('[Background] 收到 REQUEST_CURRENT_STATE，請 Host Content Script 報備進度');
      broadcastToVideoTabs({
        type: 'CS_REQUEST_CURRENT_STATE',
        payload: data
      });
    });

    // 接收 REDIRECT_ROOM 網頁跳轉（先通過白名單檢查，再寫入房間狀態，避免髒 URL 污染 session）
    newSocket.on('REDIRECT_ROOM', (data) => {
      console.log('[Background] 收到 REDIRECT_ROOM 網頁跳轉:', sanitizeLog(data?.data?.targetUrl));
      if (data?.data?.targetUrl) {
        const cleanTarget = getCanonicalVideoUrl(data.data.targetUrl);
        if (!isUrlAllowed(cleanTarget)) {
          verifyAndRedirect(cleanTarget);
          return;
        }
        const currentRoomState = getRoomState();
        if (currentRoomState) {
          currentRoomState.currentUrl = cleanTarget;
          persistRoomSession(currentRoomState);
        }
        verifyAndRedirect(cleanTarget);
        broadcastToVideoTabs({
          type: 'CS_ROOM_STATE_CHANGED',
          payload: currentRoomState
        });
      }
    });

    // 接收 TOGGLE_PERMISSION 權限變更
    newSocket.on('TOGGLE_PERMISSION', (data) => {
      const currentRoomState = getRoomState();
      if (currentRoomState && data?.data) {
        currentRoomState.allowGuestControl = Boolean(data.data.allowGuestControl);
        persistRoomSession(currentRoomState);
      }
      broadcastToVideoTabs({
        type: 'CS_PERMISSION_UPDATED',
        payload: data?.data
      });
    });

    // 接收伺服器定時或即時人數校準通知
    newSocket.on('MEMBER_COUNT_UPDATED', (data: { count: number }) => {
      console.log('[Background] 收到伺服器人數校準更新:', data?.count);
      const currentRoomState = getRoomState();
      if (currentRoomState && typeof data?.count === 'number') {
        currentRoomState.connectedPeerCount = data.count;
        persistRoomSession(currentRoomState);
        broadcastRoomState(currentRoomState);
      }
    });

    // 啟動 30 秒中繼模式定期校準 (清除舊計時器，防止重連累積洩漏)
    clearMemberCountSyncTimer();
    memberCountSyncTimer = setInterval(() => {
      const currentRoomState = getRoomState();
      if (newSocket && newSocket.connected && currentRoomState && currentRoomState.mode !== 'P2P') {
        newSocket.emit('GET_ROOM_MEMBER_COUNT', { roomId: currentRoomState.roomId });
      }
    }, 30000);

    // 接收回魂/重連成功事件 (適用於自動重連後的回應與角色校準)
    newSocket.on('JOIN_ROOM_SUCCESS', (res: any) => {
      console.log('[Background] 收到 JOIN_ROOM_SUCCESS (回魂/校準成功):', sanitizeLog(res?.roomId));
      const currentRoomState = getRoomState();
      if (currentRoomState && currentRoomState.roomId === res.roomId) {
        currentRoomState.isHost = Boolean(res.data?.isHost);
        currentRoomState.allowGuestControl = Boolean(res.data?.allowGuestControl);
        if (res.data?.currentUrl) {
          currentRoomState.currentUrl = getCanonicalVideoUrl(res.data.currentUrl);
        }
        if (res.data?.resumeToken) {
          currentRoomState.resumeToken = res.data.resumeToken;
        } else if (!res.data?.isHost) {
          currentRoomState.resumeToken = undefined;
        }
        currentRoomState.connectionStatus = 'CONNECTED';
        persistRoomSession(currentRoomState);
        broadcastRoomState(currentRoomState);
      }
    });

    // 接收 HOST_PRIVILEGE_GRANTED (原房主離線逾時換人，新房主獲頒權限與 Token)
    newSocket.on('HOST_PRIVILEGE_GRANTED', (res: { resumeToken?: string }) => {
      console.log('[Background] 收到 HOST_PRIVILEGE_GRANTED，被正式提升為房主');
      const currentRoomState = getRoomState();
      if (currentRoomState) {
        currentRoomState.isHost = true;
        if (res?.resumeToken) {
          currentRoomState.resumeToken = res.resumeToken;
        }
        persistRoomSession(currentRoomState);
        broadcastRoomState(currentRoomState);
      }
    });

    // 接收 HOST_CHANGED (原房主離線逾時轉移廣播，同步校準房間內成員之房主狀態)
    newSocket.on('HOST_CHANGED', (res: { newHostUserId?: string }) => {
      console.log('[Background] 收到 HOST_CHANGED 房主轉移通知:', sanitizeLog(res?.newHostUserId));
      const currentRoomState = getRoomState();
      if (currentRoomState && res?.newHostUserId) {
        currentRoomState.isHost = res.newHostUserId === getUserId();
        persistRoomSession(currentRoomState);
        broadcastRoomState(currentRoomState);
      }
    });

    // 監聽伺服器錯誤（若重連回魂時房間已被銷毀或過期）
    newSocket.on('ERROR', (err: any) => {
      console.warn('[Background] 收到伺服器錯誤通知:', sanitizeLog(err?.code || err?.message));
      const code = err?.code;
      const msg = err?.message || '';
      const currentRoomState = getRoomState();
      if (
        (code === 'ERR_ROOM_NOT_FOUND' ||
          code === 'ERR_ROOM_CLOSED' ||
          msg.includes('房間不存在') ||
          msg.includes('房間已關閉')) &&
        currentRoomState
      ) {
        console.warn(`[Background] 房間 ${sanitizeLog(currentRoomState.roomId)} 已過期銷毀，自動重置房間狀態`);
        setRoomState(null);
        persistRoomSession(null);
        broadcastRoomState(null);
      }
    });

    newSocket.on('disconnect', (reason) => {
      console.warn(`[Background] WebSocket 連線中斷: ${sanitizeLog(reason)}`);
      const currentRoomState = getRoomState();
      if (currentRoomState) {
        currentRoomState.connectionStatus = 'DISCONNECTED';
        broadcastRoomState(currentRoomState);
      }
    });
  });
}
