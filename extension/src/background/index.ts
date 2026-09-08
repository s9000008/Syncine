import { io, Socket } from 'socket.io-client';
import { RoomStateInfo, ConnectionMode, ExtensionMessage, getVideoIdentifier } from '../types/protocol';
import { DEFAULT_SERVER_URL } from '../config';
import { sanitizeLog } from '../utils/sanitize';

// 規格 5.1 安全白名單 (支援 YouTube 各種參數排列、Bilibili 一般影片與番劇)
const HOST_WHITELIST = [
  /^https:\/\/www\.youtube\.com\/watch\?.*v=[a-zA-Z0-9_-]+/,
  /^https:\/\/www\.youtube\.com\/watch\?v=[a-zA-Z0-9_-]+/,
  /^https:\/\/www\.bilibili\.com\/video\/[a-zA-Z0-9]+/,
  /^https:\/\/www\.bilibili\.com\/bangumi\/play\/(ep|ss)[0-9]+/
];

let socket: Socket | null = null;
let currentRoomState: RoomStateInfo | null = null;
let userId: string = 'user_' + Math.random().toString(36).substring(2, 9);

const SESSION_STORAGE_KEY = 'syncine_active_session';

function persistRoomSession(state: RoomStateInfo | null) {
  if (state) {
    chrome.storage?.local?.set({ [SESSION_STORAGE_KEY]: state });
  } else {
    chrome.storage?.local?.remove([SESSION_STORAGE_KEY]);
  }
}

// 在 Chrome MV3 Service Worker 中讀取 User ID 與前次未結束之工作階段
chrome.storage?.local?.get(['syncine_user_id', 'coview_user_id', SESSION_STORAGE_KEY], (result) => {
  if (result?.syncine_user_id) {
    userId = result.syncine_user_id;
  } else if (result?.coview_user_id) {
    userId = result.coview_user_id;
    chrome.storage?.local?.set({ syncine_user_id: userId });
  } else {
    chrome.storage?.local?.set({ syncine_user_id: userId });
  }

  // 嘗試還原前次房間工作階段
  if (result?.[SESSION_STORAGE_KEY]) {
    const saved = result[SESSION_STORAGE_KEY] as RoomStateInfo;
    console.log('[Background] 還原前次本機暫存工作階段:', sanitizeLog(saved.roomId));
    currentRoomState = saved;
    currentRoomState.connectionStatus = 'RECONNECTING';
    if (saved.mode !== 'P2P' && saved.serverUrl) {
      initSocketConnection(saved.serverUrl).catch((err) => {
        console.warn('[Background] 自動恢復工作階段連線失敗:', err);
      });
    }
  }
});

// ----------------------------------------------------
// 1. MV3 保活機制 (Keep-Alive)
// ----------------------------------------------------
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'syncine-keepalive' || port.name === 'coview-keepalive') {
    console.log('[Background] 收到 Content Script 長連接保活 Port');
    port.onDisconnect.addListener(() => {
      console.log('[Background] Content Script Port 斷開');
    });
  }
});

chrome.alarms.create('syncine-ping-alarm', { periodInMinutes: 0.33 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'syncine-ping-alarm' || alarm.name === 'coview-ping-alarm') {
    if (socket && socket.connected) {
      socket.emit('PING_ALIVE', { timestamp: Date.now() });
      console.log('[Background Keep-Alive] 發送 Alarm 輕量 Ping');
    }
  }
});

// ----------------------------------------------------
// 2. Offscreen Document 生命週期管理 (WebRTC 核心載體)
// ----------------------------------------------------
let creatingOffscreen: Promise<void> | null = null;

async function ensureOffscreenDocument() {
  const offscreenUrl = 'src/offscreen/index.html';
  if ((chrome as any).offscreen?.hasDocument) {
    const hasDoc = await (chrome as any).offscreen.hasDocument();
    if (hasDoc) return;
  }

  if (creatingOffscreen) {
    await creatingOffscreen;
  } else {
    try {
      creatingOffscreen = (chrome as any).offscreen.createDocument({
        url: offscreenUrl,
        reasons: [(chrome as any).offscreen.Reason.WEB_RTC],
        justification: 'WebRTC P2P DataChannel connection for Syncine sync'
      });
      await creatingOffscreen;
      creatingOffscreen = null;
      console.log('[Background] 成功建立 Offscreen Document');
    } catch (err: any) {
      creatingOffscreen = null;
      if (!err.message?.includes('Only a single offscreen document may be created')) {
        console.error('[Background] 建立 Offscreen Document 失敗:', err);
      }
    }
  }
}

async function closeOffscreenDocument() {
  try {
    if ((chrome as any).offscreen?.hasDocument) {
      const hasDoc = await (chrome as any).offscreen.hasDocument();
      if (!hasDoc) return;
    }
    await (chrome as any).offscreen.closeDocument();
    console.log('[Background] Offscreen Document 已關閉');
  } catch (err) {
    // 忽略關閉錯誤
  }
}

// ----------------------------------------------------
// 3. 資安防禦：網域白名單過濾跳轉
// ----------------------------------------------------
function verifyAndRedirect(targetUrl: string) {
  const isSafe = HOST_WHITELIST.some((regex) => regex.test(targetUrl));
  if (isSafe) {
    console.log(`[Background] 通過安全白名單，跳轉至: ${targetUrl}`);
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.update(tabs[0].id, { url: targetUrl });
      }
    });
  } else {
    console.error(`[Syncine 資安警告] 攔截非白名單跳轉網址: ${targetUrl}`);
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: 'SHOW_SECURITY_ALERT',
          payload: { url: targetUrl }
        });
      }
    });
  }
}

// ----------------------------------------------------
// 4. WebSocket 初始化與 Socket.IO 連線 (兼作信令通道)
// ----------------------------------------------------
function initSocketConnection(serverUrl: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    if (socket && socket.connected && (socket as any)._serverUrl === serverUrl) {
      console.log(`[Background] 重用現有 Socket.IO 連線: ${serverUrl}`);
      return resolve(socket);
    }

    if (socket) {
      socket.disconnect();
      socket = null;
    }

    console.log(`[Background] 初始化 Socket.IO 連線: ${serverUrl}`);

    socket = io(serverUrl, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 8000
    });
    (socket as any)._serverUrl = serverUrl;

    let isSettled = false;
    let connectCount = 0;

    const connectTimer = setTimeout(() => {
      if (!isSettled) {
        isSettled = true;
        reject(new Error(`連線逾時：無法連線至伺服器 (${serverUrl})，請確認伺服器已啟動且 Port 正確`));
      }
    }, 8000);

    socket.on('connect', () => {
      connectCount++;
      if (!isSettled) {
        isSettled = true;
        clearTimeout(connectTimer);
        console.log(`[Background] Socket.IO 已成功連線至: ${serverUrl} (ID: ${socket?.id})`);
        resolve(socket!);
      }

      if (currentRoomState) {
        currentRoomState.connectionStatus = 'CONNECTED';
        persistRoomSession(currentRoomState);

        // 若為斷線後的重新連線，自動發送 JOIN_ROOM 進行房間狀態回魂
        if (connectCount > 1 && currentRoomState.roomId && currentRoomState.mode !== 'P2P') {
          console.log(`[Background Reconnect] 網路連線已恢復 (ID: ${socket?.id})，自動發送 JOIN_ROOM 回魂加入房間: ${currentRoomState.roomId}`);
          socket?.emit('JOIN_ROOM', {
            event: 'JOIN_ROOM',
            roomId: currentRoomState.roomId,
            data: {
              userId,
              mode: currentRoomState.mode,
              isReconnecting: true
            }
          });
        }

        broadcastToVideoTabs({
          type: 'CS_ROOM_STATE_CHANGED',
          payload: currentRoomState
        });
        chrome.runtime.sendMessage({
          type: 'CS_ROOM_STATE_CHANGED',
          payload: currentRoomState
        }).catch(() => {});
      }
    });

    socket.once('connect_error', (err) => {
      if (!isSettled) {
        isSettled = true;
        clearTimeout(connectTimer);
        console.error(`[Background] Socket.IO 首連失敗 (${serverUrl}):`, err.message);
        reject(new Error(`連線失敗：無法連線至 ${serverUrl} (${err.message || '請確認伺服器已啟動'})`));
      }
    });

    socket.io.on('reconnect_attempt', (attempt) => {
      console.log(`[Background Reconnect] 正在嘗試重新連線至伺服器 (第 ${attempt} 次)...`);
      if (currentRoomState && currentRoomState.connectionStatus !== 'RECONNECTING') {
        currentRoomState.connectionStatus = 'RECONNECTING';
        broadcastToVideoTabs({
          type: 'CS_ROOM_STATE_CHANGED',
          payload: currentRoomState
        });
        chrome.runtime.sendMessage({
          type: 'CS_ROOM_STATE_CHANGED',
          payload: currentRoomState
        }).catch(() => {});
      }
    });

    // 接收 SYNC_STATE 訊息轉發至 Content Script (常規與回退中繼)
    socket.on('SYNC_STATE', (data) => {
      // 若處於 P2P 直連中，忽略伺服器重複中繼的 SYNC_STATE
      if (currentRoomState?.mode === 'P2P' && currentRoomState?.p2pStatus === 'CONNECTED') {
        return;
      }
      console.log('[Background] 收到 Socket SYNC_STATE，廣播給頁面 Content Script:', data);
      broadcastToVideoTabs({
        type: 'CS_SYNC_RECEIVED',
        payload: data
      });
    });

    // 接收 REQUEST_CURRENT_STATE (Host 被要求回傳當前狀態給新觀眾)
    socket.on('REQUEST_CURRENT_STATE', (data) => {
      console.log('[Background] 收到 REQUEST_CURRENT_STATE，請 Host Content Script 報備進度:', data);
      broadcastToVideoTabs({
        type: 'CS_REQUEST_CURRENT_STATE',
        payload: data
      });
    });

    // 接收 REDIRECT_ROOM 網頁跳轉
    socket.on('REDIRECT_ROOM', (data) => {
      console.log('[Background] 收到 REDIRECT_ROOM 網頁跳轉:', data);
      if (data.data?.targetUrl) {
        if (currentRoomState) {
          currentRoomState.currentUrl = data.data.targetUrl;
          persistRoomSession(currentRoomState);
        }
        verifyAndRedirect(data.data.targetUrl);
        broadcastToVideoTabs({
          type: 'CS_ROOM_STATE_CHANGED',
          payload: currentRoomState
        });
      }
    });

    // 接收 TOGGLE_PERMISSION 權限變更
    socket.on('TOGGLE_PERMISSION', (data) => {
      if (currentRoomState) {
        currentRoomState.allowGuestControl = data.data.allowGuestControl;
        persistRoomSession(currentRoomState);
      }
      broadcastToVideoTabs({
        type: 'CS_PERMISSION_UPDATED',
        payload: data.data
      });
    });

    // 接收伺服器定時或即時人數校準通知
    socket.on('MEMBER_COUNT_UPDATED', (data: { count: number }) => {
      console.log('[Background] 收到伺服器人數校準更新:', data.count);
      if (currentRoomState) {
        currentRoomState.connectedPeerCount = data.count;
        persistRoomSession(currentRoomState);
        broadcastToVideoTabs({
          type: 'CS_ROOM_STATE_CHANGED',
          payload: currentRoomState
        });
        chrome.runtime.sendMessage({
          type: 'CS_ROOM_STATE_CHANGED',
          payload: currentRoomState
        }).catch(() => {});
      }
    });

    // 啟動 30 秒中繼模式定期校準
    setInterval(() => {
      if (socket && socket.connected && currentRoomState && currentRoomState.mode !== 'P2P') {
        socket.emit('GET_ROOM_MEMBER_COUNT', { roomId: currentRoomState.roomId });
      }
    }, 30000);

    // WebRTC P2P 信令事件監聽
    socket.on('MEMBER_JOINED', (data: any) => {
      console.log('[Background] 收到新成員加入房間通知:', data);
      if (currentRoomState?.mode === 'P2P' && currentRoomState?.isHost && data.socketId) {
        console.log(`[Background Host] P2P 模式：觸發與新成員 (${data.socketId}) 之 DataChannel 握手`);
        chrome.runtime.sendMessage({
          type: 'OFFSCREEN_NEW_PEER',
          payload: { socketId: data.socketId, userId: data.userId }
        } as ExtensionMessage).catch(() => {});
      }
    });

    socket.on('SIGNAL_OFFER', (data: any) => {
      console.log('[Background Guest] 收到 SIGNAL_OFFER 信令，轉發給 Offscreen:', data);
      chrome.runtime.sendMessage({
        type: 'OFFSCREEN_SIGNAL_OFFER',
        payload: data.data
      } as ExtensionMessage).catch(() => {});
    });

    socket.on('SIGNAL_ANSWER', (data: any) => {
      console.log('[Background Host] 收到 SIGNAL_ANSWER 信令，轉發給 Offscreen:', data);
      chrome.runtime.sendMessage({
        type: 'OFFSCREEN_SIGNAL_ANSWER',
        payload: data.data
      } as ExtensionMessage).catch(() => {});
    });

    socket.on('SIGNAL_ICE_CANDIDATE', (data: any) => {
      chrome.runtime.sendMessage({
        type: 'OFFSCREEN_SIGNAL_ICE_CANDIDATE',
        payload: data.data
      } as ExtensionMessage).catch(() => {});
    });

    socket.on('P2P_FALLBACK', (data: any) => {
      console.warn('[Background] 收到伺服器 P2P_FALLBACK 通知，系統降級回退至伺服器中繼:', data);
      if (currentRoomState) {
        currentRoomState.p2pStatus = 'FALLBACK';
        currentRoomState.mode = 'DEFAULT';
        persistRoomSession(currentRoomState);
      }
      broadcastToVideoTabs({
        type: 'CS_ROOM_STATE_CHANGED',
        payload: currentRoomState
      });
    });

    // 接收回魂/重連成功事件 (適用於自動重連後的回應與角色校準)
    socket.on('JOIN_ROOM_SUCCESS', (res: any) => {
      console.log('[Background] 收到 JOIN_ROOM_SUCCESS (回魂/校準成功):', res);
      if (currentRoomState && currentRoomState.roomId === res.roomId) {
        currentRoomState.isHost = res.data.isHost;
        currentRoomState.allowGuestControl = res.data.allowGuestControl;
        if (res.data.currentUrl) {
          currentRoomState.currentUrl = res.data.currentUrl;
        }
        currentRoomState.connectionStatus = 'CONNECTED';
        persistRoomSession(currentRoomState);
        broadcastToVideoTabs({
          type: 'CS_ROOM_STATE_CHANGED',
          payload: currentRoomState
        });
        chrome.runtime.sendMessage({
          type: 'CS_ROOM_STATE_CHANGED',
          payload: currentRoomState
        }).catch(() => {});
      }
    });

    // 監聽伺服器錯誤（若重連回魂時房間已被銷毀或過期）
    socket.on('ERROR', (err: any) => {
      console.warn('[Background] 收到伺服器錯誤通知:', err);
      if (
        (err?.message?.includes('房間不存在') || err?.message?.includes('房間已關閉')) &&
        currentRoomState
      ) {
        console.warn(`[Background] 房間 ${currentRoomState.roomId} 已過期銷毀，自動重置房間狀態`);
        currentRoomState = null;
        persistRoomSession(null);
        broadcastToVideoTabs({
          type: 'CS_ROOM_STATE_CHANGED',
          payload: null
        });
        chrome.runtime.sendMessage({
          type: 'CS_ROOM_STATE_CHANGED',
          payload: null
        }).catch(() => {});
      }
    });

    socket.on('disconnect', (reason) => {
      console.warn(`[Background] WebSocket 連線中斷: ${reason}`);
      if (currentRoomState) {
        currentRoomState.connectionStatus = 'DISCONNECTED';
        broadcastToVideoTabs({
          type: 'CS_ROOM_STATE_CHANGED',
          payload: currentRoomState
        });
        chrome.runtime.sendMessage({
          type: 'CS_ROOM_STATE_CHANGED',
          payload: currentRoomState
        }).catch(() => {});
      }
    });
  });
}

function broadcastToVideoTabs(msg: any) {
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach((tab) => {
      if (tab.id && tab.url && (tab.url.includes('youtube.com') || tab.url.includes('bilibili.com'))) {
        chrome.tabs.sendMessage(tab.id, msg).catch(() => {});
      }
    });
  });
}

// ----------------------------------------------------
// 5. 解析複合分享碼 (RoomID|Base64(ServerURL))
// ----------------------------------------------------
function parseShareCode(inputCode: string): { roomId: string; serverUrl: string; mode: ConnectionMode } {
  let trimmed = inputCode.trim();
  let mode: ConnectionMode = 'DEFAULT';

  if (trimmed.startsWith('P2P:')) {
    mode = 'P2P';
    trimmed = trimmed.substring(4);
  } else if (trimmed.startsWith('IP:')) {
    mode = 'CUSTOM_IP';
    trimmed = trimmed.substring(3);
  } else if (trimmed.startsWith('DEF:')) {
    mode = 'DEFAULT';
    trimmed = trimmed.substring(4);
  }

  if (trimmed.includes('|')) {
    const [roomId, base64Url] = trimmed.split('|');
    try {
      const decodedUrl = atob(base64Url);
      return { roomId: roomId.toUpperCase(), serverUrl: decodedUrl, mode };
    } catch (e) {
      console.error('Base64 解碼失敗，使用預設伺服器');
    }
  }
  return { roomId: trimmed.toUpperCase(), serverUrl: DEFAULT_SERVER_URL, mode };
}

// ----------------------------------------------------
// 6. Message 監聽器 (來自 Popup, Content Script 與 Offscreen)
// ----------------------------------------------------
chrome.runtime.onMessage.addListener((request: ExtensionMessage, sender, sendResponse) => {
  const { type, payload } = request;

  switch (type) {
    case 'BG_CREATE_ROOM': {
      const mode: ConnectionMode = payload?.mode || 'DEFAULT';
      const serverUrl = payload?.customServerUrl || DEFAULT_SERVER_URL;

      if (mode === 'P2P') {
        ensureOffscreenDocument()
          .then(() => {
            chrome.runtime.sendMessage(
              {
                type: 'OFFSCREEN_PEER_CREATE_ROOM',
                payload: { userId }
              } as ExtensionMessage,
              (res) => {
                if (res?.success) {
                  currentRoomState = {
                    roomId: res.roomId,
                    isHost: true,
                    allowGuestControl: false,
                    serverUrl: 'WebRTC P2P (純端對端直連)',
                    currentUrl: payload.currentUrl,
                    mode: 'P2P',
                    p2pStatus: 'CONNECTED',
                    connectionStatus: 'CONNECTED',
                    connectedPeerCount: 1,
                    pendingJoinRequests: [],
                    compositeCode: res.roomId
                  };
                  persistRoomSession(currentRoomState);
                  broadcastToVideoTabs({
                    type: 'CS_ROOM_STATE_CHANGED',
                    payload: currentRoomState
                  });
                  sendResponse({
                    success: true,
                    compositeCode: res.roomId,
                    roomId: res.roomId,
                    roomState: currentRoomState
                  });
                } else {
                  sendResponse({ success: false, error: res?.error || '建立 P2P 房間失敗' });
                }
              }
            );
          })
          .catch((err) => {
            sendResponse({ success: false, error: err.message });
          });
        return true;
      }

      initSocketConnection(serverUrl)
        .then((s) => {
          s.emit('CREATE_ROOM', {
            event: 'CREATE_ROOM',
            data: {
              userId,
              currentUrl: payload.currentUrl,
              isSelfHosted: mode === 'CUSTOM_IP' || !!payload.customServerUrl,
              mode,
              customServerUrl: mode === 'CUSTOM_IP' ? serverUrl : undefined
            }
          });

          const createTimer = setTimeout(() => {
            sendResponse({ success: false, error: '伺服器回應逾時 (CREATE_ROOM_SUCCESS 未收到)' });
          }, 6000);

          s.once('CREATE_ROOM_SUCCESS', async (res: any) => {
            clearTimeout(createTimer);
            const base64Url = btoa(serverUrl);
            let compositeCode = `${res.roomId}|${base64Url}`;
            if (mode === 'CUSTOM_IP') {
              compositeCode = `IP:${res.roomId}|${base64Url}`;
            }

            currentRoomState = {
              roomId: res.roomId,
              isHost: true,
              allowGuestControl: res.data.allowGuestControl,
              serverUrl,
              currentUrl: payload.currentUrl,
              mode,
              p2pStatus: undefined,
              connectionStatus: 'CONNECTED',
              connectedPeerCount: 1,
              compositeCode
            };
            persistRoomSession(currentRoomState);

            broadcastToVideoTabs({
              type: 'CS_ROOM_STATE_CHANGED',
              payload: currentRoomState
            });

            sendResponse({ success: true, compositeCode, roomId: res.roomId, roomState: currentRoomState });
          });
        })
        .catch((err) => {
          console.error('[Background] BG_CREATE_ROOM 失敗:', err);
          sendResponse({ success: false, error: err.message });
        });
      return true;
    }

    case 'BG_JOIN_ROOM': {
      const rawInput = payload.shareCode ? payload.shareCode.trim() : '';

      // 若為純 6 碼或指名 P2P 模式，走 PeerJS 雲端握手
      if (
        payload.mode === 'P2P' ||
        (!rawInput.includes('|') && !rawInput.startsWith('http') && !rawInput.startsWith('IP:') && !rawInput.startsWith('P2P:'))
      ) {
        ensureOffscreenDocument()
          .then(() => {
            chrome.runtime.sendMessage(
              {
                type: 'OFFSCREEN_PEER_JOIN_ROOM',
                payload: { roomId: rawInput, userId }
              } as ExtensionMessage,
              (res) => {
                if (res?.success) {
                  // 若在回調抵達前已收到核准訊號，避免被覆蓋為 awaitingApproval: true
                  if (!currentRoomState || currentRoomState.p2pStatus !== 'CONNECTED') {
                    currentRoomState = {
                      roomId: res.roomId,
                      isHost: false,
                      allowGuestControl: false,
                      serverUrl: 'WebRTC P2P (純端對端直連)',
                      mode: 'P2P',
                      p2pStatus: 'CONNECTING',
                      connectionStatus: 'CONNECTED',
                      guestAwaitingApproval: true,
                      connectedPeerCount: 1,
                      compositeCode: res.roomId
                    };
                    persistRoomSession(currentRoomState);
                  }
                  broadcastToVideoTabs({
                    type: 'CS_ROOM_STATE_CHANGED',
                    payload: currentRoomState
                  });
                  sendResponse({ success: true, roomId: res.roomId, roomState: currentRoomState });
                } else {
                  sendResponse({ success: false, error: res?.error || '加入 P2P 房間失敗' });
                }
              }
            );
          })
          .catch((err) => {
            sendResponse({ success: false, error: err.message });
          });
        return true;
      }
      const parsed = parseShareCode(payload.shareCode);
      const { roomId, serverUrl, mode } = parsed;

      initSocketConnection(serverUrl)
        .then((s) => {
          s.emit('JOIN_ROOM', {
            event: 'JOIN_ROOM',
            roomId,
            data: { userId, mode }
          });

          const joinTimer = setTimeout(() => {
            sendResponse({ success: false, error: '伺服器回應逾時 (JOIN_ROOM_SUCCESS 未收到)' });
          }, 6000);

          s.once('JOIN_ROOM_SUCCESS', async (res: any) => {
            clearTimeout(joinTimer);
            const actualMode: ConnectionMode = mode === 'P2P' ? 'P2P' : (res.data.mode || 'DEFAULT');

            currentRoomState = {
              roomId: res.roomId,
              isHost: false,
              allowGuestControl: res.data.allowGuestControl,
              serverUrl,
              currentUrl: res.data.currentUrl,
              mode: actualMode,
              p2pStatus: actualMode === 'P2P' ? 'CONNECTING' : undefined,
              connectionStatus: 'CONNECTED',
              connectedPeerCount: 0,
              compositeCode: payload.shareCode
            };
            persistRoomSession(currentRoomState);

            if (actualMode === 'P2P') {
              await ensureOffscreenDocument();
              chrome.runtime.sendMessage({
                type: 'OFFSCREEN_INIT_P2P',
                payload: {
                  role: 'GUEST',
                  roomId: res.roomId,
                  userId,
                  socketId: s.id,
                  hostSocketId: res.data.hostSocketId
                }
              } as ExtensionMessage).catch(() => {});
            }

            broadcastToVideoTabs({
              type: 'CS_ROOM_STATE_CHANGED',
              payload: currentRoomState
            });

            sendResponse({ success: true, roomId: res.roomId, roomState: currentRoomState });
          });

          s.once('ERROR', (err: any) => {
            clearTimeout(joinTimer);
            sendResponse({ success: false, error: err.message });
          });
        })
        .catch((err) => {
          console.error('[Background] BG_JOIN_ROOM 失敗:', err);
          sendResponse({ success: false, error: err.message });
        });
      return true;
    }

    // 雙向路由：若 P2P 直連已建立，優先透過 DataChannel 傳送；否則透過 Socket.IO
    case 'BG_SYNC_STATE': {
      const syncData = payload?.data ?? (request as any).data;
      const targetGuestSocketId = payload?.targetGuestSocketId ?? (request as any).targetGuestSocketId;

      // 核心過濾防線：比對發送事件的分頁網址是否符合房間目標影片
      if (sender.tab?.url && currentRoomState?.currentUrl) {
        const senderVideoId = getVideoIdentifier(sender.tab.url);
        const roomVideoId = getVideoIdentifier(currentRoomState.currentUrl);
        if (senderVideoId && roomVideoId && senderVideoId !== roomVideoId) {
          console.log(`[Background] 捨棄來自非當前房間目標影片分頁的同步事件 (${sender.tab.url})`);
          break;
        }
      }

      if (currentRoomState?.mode === 'P2P' && currentRoomState?.p2pStatus === 'CONNECTED') {
        chrome.runtime.sendMessage({
          type: 'OFFSCREEN_SEND_DATA',
          payload: syncData
        } as ExtensionMessage).catch(() => {});
      } else if (socket && currentRoomState) {
        socket.emit('SYNC_STATE', {
          event: 'SYNC_STATE',
          roomId: currentRoomState.roomId,
          targetGuestSocketId,
          data: syncData
        });
      }
      break;
    }

    case 'BG_REDIRECT_ROOM': {
      if (currentRoomState && currentRoomState.isHost) {
        currentRoomState.currentUrl = payload.targetUrl;
        verifyAndRedirect(payload.targetUrl);

        broadcastToVideoTabs({
          type: 'CS_ROOM_STATE_CHANGED',
          payload: currentRoomState
        });

        if (currentRoomState.mode === 'P2P' && currentRoomState.p2pStatus === 'CONNECTED') {
          chrome.runtime.sendMessage({
            type: 'OFFSCREEN_SEND_DATA',
            payload: {
              type: 'REDIRECT_ROOM',
              targetUrl: payload.targetUrl
            }
          } as ExtensionMessage).catch(() => {});
        }

        if (socket) {
          socket.emit('REDIRECT_ROOM', {
            event: 'REDIRECT_ROOM',
            roomId: currentRoomState.roomId,
            data: { targetUrl: payload.targetUrl }
          });
        }
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: '非 Host 無法發起跳轉' });
      }
      return true;
    }

    case 'BG_TOGGLE_PERMISSION': {
      if (currentRoomState && currentRoomState.isHost) {
        currentRoomState.allowGuestControl = payload.allowGuestControl;
        broadcastToVideoTabs({
          type: 'CS_PERMISSION_UPDATED',
          payload: { allowGuestControl: payload.allowGuestControl }
        });

        if (currentRoomState.mode === 'P2P' && currentRoomState.p2pStatus === 'CONNECTED') {
          chrome.runtime.sendMessage({
            type: 'OFFSCREEN_SEND_DATA',
            payload: {
              type: 'TOGGLE_PERMISSION',
              allowGuestControl: payload.allowGuestControl
            }
          } as ExtensionMessage).catch(() => {});
        }

        if (socket) {
          socket.emit('TOGGLE_PERMISSION', {
            event: 'TOGGLE_PERMISSION',
            roomId: currentRoomState.roomId,
            data: { allowGuestControl: payload.allowGuestControl }
          });
        }
        sendResponse({ success: true });
      }
      return true;
    }

    case 'BG_LEAVE_ROOM': {
      chrome.action.setBadgeText({ text: '' });
      chrome.runtime.sendMessage({ type: 'OFFSCREEN_CLOSE_P2P' } as ExtensionMessage).catch(() => {});
      if (socket) {
        socket.emit('LEAVE_ROOM');
        socket.disconnect();
        socket = null;
      }
      closeOffscreenDocument().catch(() => {});
      currentRoomState = null;
      persistRoomSession(null);
      broadcastToVideoTabs({
        type: 'CS_ROOM_STATE_CHANGED',
        payload: null
      });
      chrome.runtime.sendMessage({
        type: 'CS_ROOM_STATE_CHANGED',
        payload: null
      }).catch(() => {});
      sendResponse({ success: true });
      break;
    }

    case 'BG_APPROVE_JOIN_REQUEST': {
      chrome.runtime.sendMessage(
        {
          type: 'OFFSCREEN_APPROVE_JOIN_REQUEST',
          payload: {
            requestId: payload.requestId,
            hostCurrentUrl: currentRoomState?.currentUrl
          }
        } as ExtensionMessage,
        () => {
          if (currentRoomState && currentRoomState.pendingJoinRequests) {
            currentRoomState.pendingJoinRequests = currentRoomState.pendingJoinRequests.filter(
              (r) => r.requestId !== payload.requestId
            );
            const count = currentRoomState.pendingJoinRequests.length;
            chrome.action.setBadgeText({ text: count > 0 ? `${count}` : '' });
            chrome.action.setBadgeBackgroundColor({ color: '#10b981' });
            broadcastToVideoTabs({
              type: 'CS_ROOM_STATE_CHANGED',
              payload: currentRoomState
            });
            chrome.runtime.sendMessage({
              type: 'CS_ROOM_STATE_CHANGED',
              payload: currentRoomState
            }).catch(() => {});
          }
          sendResponse({ success: true });
        }
      );
      return true;
    }

    case 'BG_REJECT_JOIN_REQUEST': {
      chrome.runtime.sendMessage(
        {
          type: 'OFFSCREEN_REJECT_JOIN_REQUEST',
          payload: { requestId: payload.requestId }
        } as ExtensionMessage,
        () => {
          if (currentRoomState && currentRoomState.pendingJoinRequests) {
            currentRoomState.pendingJoinRequests = currentRoomState.pendingJoinRequests.filter(
              (r) => r.requestId !== payload.requestId
            );
            const count = currentRoomState.pendingJoinRequests.length;
            chrome.action.setBadgeText({ text: count > 0 ? `${count}` : '' });
            chrome.action.setBadgeBackgroundColor({ color: '#10b981' });
            broadcastToVideoTabs({
              type: 'CS_ROOM_STATE_CHANGED',
              payload: currentRoomState
            });
            chrome.runtime.sendMessage({
              type: 'CS_ROOM_STATE_CHANGED',
              payload: currentRoomState
            }).catch(() => {});
          }
          sendResponse({ success: true });
        }
      );
      return true;
    }

    case 'CS_JOIN_REQUESTS_UPDATED': {
      if (currentRoomState) {
        const requests = payload.pendingRequests || [];
        currentRoomState.pendingJoinRequests = requests;
        const count = requests.length;
        chrome.action.setBadgeText({ text: count > 0 ? `${count}` : '' });
        chrome.action.setBadgeBackgroundColor({ color: '#10b981' });
        broadcastToVideoTabs({
          type: 'CS_ROOM_STATE_CHANGED',
          payload: currentRoomState
        });
        chrome.runtime.sendMessage({
          type: 'CS_ROOM_STATE_CHANGED',
          payload: currentRoomState
        }).catch(() => {});
      }
      break;
    }

    case 'GET_ROOM_STATE': {
      sendResponse({ roomState: currentRoomState, userId, compositeCode: currentRoomState?.compositeCode });
      break;
    }

    // ----------------------------------------------------
    // Offscreen WebRTC 消息與信令轉發
    // ----------------------------------------------------
    case 'OFFSCREEN_SIGNAL_OFFER': {
      if (socket && currentRoomState) {
        socket.emit('SIGNAL_OFFER', {
          event: 'SIGNAL_OFFER',
          roomId: currentRoomState.roomId,
          data: payload
        });
      }
      break;
    }

    case 'OFFSCREEN_SIGNAL_ANSWER': {
      if (socket && currentRoomState) {
        socket.emit('SIGNAL_ANSWER', {
          event: 'SIGNAL_ANSWER',
          roomId: currentRoomState.roomId,
          data: payload
        });
      }
      break;
    }

    case 'OFFSCREEN_SIGNAL_ICE_CANDIDATE': {
      if (socket && currentRoomState) {
        socket.emit('SIGNAL_ICE_CANDIDATE', {
          event: 'SIGNAL_ICE_CANDIDATE',
          roomId: currentRoomState.roomId,
          data: payload
        });
      }
      break;
    }

    case 'BG_P2P_GUEST_APPROVED': {
      if (currentRoomState) {
        currentRoomState.p2pStatus = 'CONNECTED';
        currentRoomState.guestAwaitingApproval = false;
        currentRoomState.connectedPeerCount = payload?.memberCount || 2;
        if (payload?.hostCurrentUrl) {
          currentRoomState.currentUrl = payload.hostCurrentUrl;
        }
        broadcastToVideoTabs({
          type: 'CS_ROOM_STATE_CHANGED',
          payload: currentRoomState
        });
        chrome.runtime.sendMessage({
          type: 'CS_ROOM_STATE_CHANGED',
          payload: currentRoomState
        }).catch(() => {});
      }
      sendResponse({ success: true });
      break;
    }

    case 'CS_ROOM_STATE_CHANGED': {
      if (payload) {
        currentRoomState = {
          ...(currentRoomState || {}),
          ...payload
        };
        broadcastToVideoTabs({
          type: 'CS_ROOM_STATE_CHANGED',
          payload: currentRoomState
        });
      }
      break;
    }

    case 'OFFSCREEN_P2P_STATUS': {
      if (currentRoomState) {
        currentRoomState.p2pStatus = payload.status;
        currentRoomState.connectedPeerCount = payload.peerCount;
        if (payload.status === 'CONNECTED') {
          currentRoomState.serverlessHandshakeState = 'CONNECTED';
        }
        broadcastToVideoTabs({
          type: 'CS_ROOM_STATE_CHANGED',
          payload: currentRoomState
        });
        // 即時通知開啟中的 Popup 控制面板
        chrome.runtime.sendMessage({
          type: 'CS_ROOM_STATE_CHANGED',
          payload: currentRoomState
        }).catch(() => {});
      }
      break;
    }

    case 'OFFSCREEN_TRIGGER_FALLBACK': {
      console.warn('[Background] Offscreen 回報 P2P 連線失敗，啟動降級流程:', payload.reason);
      if (socket && currentRoomState) {
        socket.emit('P2P_FALLBACK', {
          roomId: currentRoomState.roomId,
          reason: payload.reason
        });
        currentRoomState.p2pStatus = 'FALLBACK';
        currentRoomState.mode = 'DEFAULT';
        broadcastToVideoTabs({
          type: 'CS_ROOM_STATE_CHANGED',
          payload: currentRoomState
        });
      }
      break;
    }

    case 'OFFSCREEN_DATA_RECEIVED': {
      // 來自 DataChannel 直連同步事件
      const syncData = payload;
      if (syncData.action) {
        broadcastToVideoTabs({
          type: 'CS_SYNC_RECEIVED',
          payload: { data: syncData }
        });
      } else if (syncData.type === 'REDIRECT_ROOM') {
        if (currentRoomState) {
          currentRoomState.currentUrl = syncData.targetUrl;
        }
        verifyAndRedirect(syncData.targetUrl);
        broadcastToVideoTabs({
          type: 'CS_ROOM_STATE_CHANGED',
          payload: currentRoomState
        });
      } else if (syncData.type === 'TOGGLE_PERMISSION') {
        if (currentRoomState) {
          currentRoomState.allowGuestControl = syncData.allowGuestControl;
        }
        broadcastToVideoTabs({
          type: 'CS_PERMISSION_UPDATED',
          payload: { allowGuestControl: syncData.allowGuestControl }
        });
      }
      break;
    }

    // Serverless 剪貼簿模式專屬訊息 (完全不經任何伺服器)
    case 'BG_SERVERLESS_CREATE_OFFER': {
      ensureOffscreenDocument()
        .then(() => {
          chrome.runtime.sendMessage(
            { type: 'OFFSCREEN_SERVERLESS_CREATE_OFFER' } as ExtensionMessage,
            (res) => {
              if (res?.success) {
                if (!currentRoomState) {
                  currentRoomState = {
                    roomId: res.roomId,
                    isHost: true,
                    allowGuestControl: false,
                    serverUrl: 'WebRTC P2P (純端對端直連)',
                    currentUrl: payload?.currentUrl,
                    mode: 'P2P',
                    p2pStatus: 'CONNECTING',
                    serverlessHandshakeState: 'AWAITING_ANSWER',
                    offerCode: res.offerCode,
                    connectedPeerCount: 1
                  };
                } else {
                  currentRoomState.offerCode = res.offerCode;
                }
                broadcastToVideoTabs({
                  type: 'CS_ROOM_STATE_CHANGED',
                  payload: currentRoomState
                });
                sendResponse({
                  success: true,
                  offerCode: res.offerCode,
                  roomId: res.roomId,
                  peerId: res.peerId,
                  roomState: currentRoomState
                });
              } else {
                sendResponse({ success: false, error: res?.error || '產生 P2P 邀請碼失敗' });
              }
            }
          );
        })
        .catch((err) => {
          sendResponse({ success: false, error: err.message });
        });
      return true;
    }

    case 'BG_SERVERLESS_ACCEPT_OFFER': {
      ensureOffscreenDocument()
        .then(() => {
          chrome.runtime.sendMessage(
            {
              type: 'OFFSCREEN_SERVERLESS_ACCEPT_OFFER',
              payload: { offerCode: payload.offerCode }
            } as ExtensionMessage,
            (res) => {
              if (res?.success) {
                currentRoomState = {
                  roomId: res.roomId,
                  isHost: false,
                  allowGuestControl: false,
                  serverUrl: 'WebRTC P2P (純端對端直連)',
                  currentUrl: payload?.currentUrl,
                  mode: 'P2P',
                  p2pStatus: 'CONNECTING',
                  serverlessHandshakeState: 'AWAITING_HOST_CONFIRM',
                  answerCode: res.answerCode,
                  connectedPeerCount: 0
                };
                broadcastToVideoTabs({
                  type: 'CS_ROOM_STATE_CHANGED',
                  payload: currentRoomState
                });
                sendResponse({
                  success: true,
                  answerCode: res.answerCode,
                  roomId: res.roomId,
                  roomState: currentRoomState
                });
              } else {
                sendResponse({ success: false, error: res?.error || '解析邀請碼失敗，請確認代碼格式完整' });
              }
            }
          );
        })
        .catch((err) => {
          sendResponse({ success: false, error: err.message });
        });
      return true;
    }

    case 'BG_SERVERLESS_ACCEPT_ANSWER': {
      chrome.runtime.sendMessage(
        {
          type: 'OFFSCREEN_SERVERLESS_ACCEPT_ANSWER',
          payload: { answerCode: payload.answerCode }
        } as ExtensionMessage,
        (res) => {
          if (res?.success) {
            if (currentRoomState) {
              currentRoomState.serverlessHandshakeState = 'CONNECTED';
              currentRoomState.p2pStatus = 'CONNECTED';
              currentRoomState.connectedPeerCount = 1;
              broadcastToVideoTabs({
                type: 'CS_ROOM_STATE_CHANGED',
                payload: currentRoomState
              });
              chrome.runtime.sendMessage({
                type: 'CS_ROOM_STATE_CHANGED',
                payload: currentRoomState
              }).catch(() => {});
            }
            sendResponse({ success: true, roomState: currentRoomState });
          } else {
            sendResponse({ success: false, error: res?.error || '套用回執碼失敗，請確認代碼完整性' });
          }
        }
      );
      return true;
    }
  }
});
