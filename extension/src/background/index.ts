import {
  ConnectionMode,
  ExtensionMessage,
  PlaybackConflictState,
  RoomStateInfo,
  getCanonicalVideoUrl,
  getVideoIdentifier,
  isNonVideoBrowsePage,
  validateSyncData
} from '../types/protocol';
import { HOST_WHITELIST, isPlatformPermitted, isUniversalSupportedUrl } from '../platforms';
import { DEFAULT_SERVER_URL } from '../config';
import { sanitizeLog } from '../utils/sanitize';
import { parseConnectionCode, formatShareCode } from '../utils/connectionParser';
import {
  buildUnifiedDiagnosticReport,
  recordContentionDiagnostic,
  recordDiagnosticEvent
} from './modules/diagnostics';
import {
  ensureSessionHydrated,
  getCandidatesUnlocked,
  getRoomState,
  getUserId,
  persistRoomSession,
  setRoomState
} from './modules/session';
import { clearBadgeAndResetSession, initKeepAliveListeners, syncKeepAliveAlarm } from './modules/keepAlive';
import { closeOffscreenDocument, ensureOffscreenDocument, sendOffscreenMessage } from './modules/offscreenManager';
import {
  broadcastRoomState,
  broadcastToVideoTabs,
  isUrlAllowed,
  reinjectExistingVideoTabs,
  syncJoinRequestBadge,
  verifyAndRedirect
} from './modules/redirector';
import { disconnectSocket, getSocket, initSocketConnection } from './modules/socketClient';

// 規格 5.1 安全白名單單一真理來源 (由 platforms.ts 統一維護並轉匯出供相容性引用)
export { HOST_WHITELIST };
export { isUrlAllowed, verifyAndRedirect };

const hydrateBackgroundSession = () =>
  ensureSessionHydrated({
    onRelaySessionRestored: (saved) => {
      syncKeepAliveAlarm(true);
      if (saved.serverUrl) {
        initSocketConnection(saved.serverUrl).catch((err) => {
          console.warn('[Background] 自動恢復工作階段連線失敗:', sanitizeLog(err?.message || err));
        });
      }
    }
  });

// Service Worker 啟動時立即觸發非阻塞還原、保活監聽初始化與已開啟分頁之腳本自癒檢查
hydrateBackgroundSession().then(() => {
  reinjectExistingVideoTabs();
});
initKeepAliveListeners();

if (typeof chrome !== 'undefined' && chrome.runtime?.onInstalled) {
  chrome.runtime.onInstalled.addListener(() => {
    hydrateBackgroundSession().then(() => {
      reinjectExistingVideoTabs();
    });
  });
}

function sanitizeRoomInitialUrl(rawUrl?: string): string {
  const isBrowserInternalUrl =
    typeof rawUrl === 'string' &&
    (rawUrl.startsWith('chrome://') ||
      rawUrl.startsWith('about:') ||
      rawUrl.startsWith('edge://') ||
      rawUrl.startsWith('chrome-extension://') ||
      rawUrl.startsWith('moz-extension://'));
  return isBrowserInternalUrl ? '' : getCanonicalVideoUrl(rawUrl);
}

/**
 * 解析複合分享碼 (RoomID|Base64(ServerURL))
 */
export function parseShareCode(inputCode: string): { roomId: string; serverUrl: string; mode: ConnectionMode } {
  const parsed = parseConnectionCode(inputCode, 'DEFAULT', DEFAULT_SERVER_URL);
  return {
    roomId: parsed.roomId,
    serverUrl: parsed.serverUrl || DEFAULT_SERVER_URL,
    mode: parsed.mode
  };
}

function handleCreateRoom(payload: any, sendResponse: (res: any) => void): void {
  const mode: ConnectionMode = payload?.mode || 'DEFAULT';
  const serverUrl = payload?.customServerUrl || DEFAULT_SERVER_URL;
  const cleanUrl = sanitizeRoomInitialUrl(payload?.currentUrl);
  const userId = getUserId();
  const candidatesUnlocked = getCandidatesUnlocked();

  if (mode === 'P2P') {
    sendOffscreenMessage({
      type: 'OFFSCREEN_PEER_CREATE_ROOM',
      payload: { userId }
    } as ExtensionMessage)
      .then((res) => {
        if (res?.success) {
          const compositeCode = formatShareCode('P2P', res.roomId);
          const nextState: RoomStateInfo = {
            roomId: res.roomId,
            isHost: true,
            allowGuestControl: false,
            serverUrl: 'P2P',
            currentUrl: cleanUrl,
            mode: 'P2P',
            p2pStatus: 'CONNECTED',
            connectionStatus: 'CONNECTED',
            connectedPeerCount: 1,
            pendingJoinRequests: [],
            compositeCode
          };
          setRoomState(nextState);
          persistRoomSession(nextState);
          syncKeepAliveAlarm(true);
          broadcastToVideoTabs({
            type: 'CS_ROOM_STATE_CHANGED',
            payload: nextState
          });
          sendResponse({
            success: true,
            compositeCode,
            roomId: res.roomId,
            roomState: nextState
          });
        } else {
          const errCode = res?.error || 'ERR_P2P_SIGNAL_FAILED';
          sendResponse({ success: false, error: errCode, code: errCode });
        }
      })
      .catch((err) => {
        sendResponse({ success: false, error: err?.message || 'ERR_P2P_SIGNAL_FAILED', code: 'ERR_P2P_SIGNAL_FAILED' });
      });
    return;
  }

  initSocketConnection(serverUrl)
    .then((s) => {
      s.emit('CREATE_ROOM', {
        event: 'CREATE_ROOM',
        data: {
          userId,
          currentUrl: cleanUrl,
          isSelfHosted: mode === 'CUSTOM_IP' || !!payload?.customServerUrl,
          mode,
          customServerUrl: mode === 'CUSTOM_IP' ? serverUrl : undefined,
          language: payload?.language,
          allowUniversal: candidatesUnlocked
        }
      });

      let createSettled = false;
      const cleanupCreateListeners = () => {
        s.off('CREATE_ROOM_SUCCESS', onCreateSuccess);
        s.off('ERROR', onCreateError);
      };

      const createTimer = setTimeout(() => {
        if (createSettled) return;
        createSettled = true;
        cleanupCreateListeners();
        sendResponse({ success: false, error: 'ERR_SERVER_TIMEOUT', code: 'ERR_SERVER_TIMEOUT' });
      }, 6000);

      const onCreateSuccess = (res: any) => {
        if (createSettled) return;
        createSettled = true;
        clearTimeout(createTimer);
        cleanupCreateListeners();
        const compositeCode = formatShareCode(mode, res.roomId, serverUrl);
        const nextState: RoomStateInfo = {
          roomId: res.roomId,
          isHost: true,
          allowGuestControl: Boolean(res.data?.allowGuestControl),
          serverUrl,
          currentUrl: cleanUrl,
          mode,
          p2pStatus: undefined,
          connectionStatus: 'CONNECTED',
          connectedPeerCount: 1,
          compositeCode,
          resumeToken: res.data?.resumeToken
        };
        setRoomState(nextState);
        persistRoomSession(nextState);
        syncKeepAliveAlarm(true);

        broadcastToVideoTabs({
          type: 'CS_ROOM_STATE_CHANGED',
          payload: nextState
        });

        sendResponse({ success: true, compositeCode, roomId: res.roomId, roomState: nextState });
      };

      const onCreateError = (err: any) => {
        if (createSettled) return;
        createSettled = true;
        clearTimeout(createTimer);
        cleanupCreateListeners();
        const code = err?.code || 'ERR_UNKNOWN';
        sendResponse({ success: false, error: code, code });
      };

      s.once('CREATE_ROOM_SUCCESS', onCreateSuccess);
      s.once('ERROR', onCreateError);
    })
    .catch((err) => {
      console.warn('[Background] BG_CREATE_ROOM 失敗:', sanitizeLog(err?.message || err));
      sendResponse({ success: false, error: err?.message || 'ERR_SERVER_UNREACHABLE', code: err?.message || 'ERR_SERVER_UNREACHABLE' });
    });
}

function handleJoinRoom(payload: any, sendResponse: (res: any) => void): void {
  const rawInput = payload?.shareCode ? String(payload.shareCode).trim() : '';
  const fallbackMode: ConnectionMode = payload?.mode || 'P2P';
  const parsed = parseConnectionCode(rawInput, fallbackMode, DEFAULT_SERVER_URL);
  const { roomId, serverUrl, mode } = parsed;
  const userId = getUserId();

  if (!roomId) {
    sendResponse({ success: false, error: 'ERR_INVALID_CODE', code: 'ERR_INVALID_CODE' });
    return;
  }

  if (mode === 'P2P') {
    sendOffscreenMessage({
      type: 'OFFSCREEN_PEER_JOIN_ROOM',
      payload: { roomId, userId }
    } as ExtensionMessage)
      .then((res) => {
        if (res?.success) {
          const existingState = getRoomState();
          // 若在回調抵達前已收到核准訊號，避免被覆蓋為 awaitingApproval: true
          if (!existingState || existingState.p2pStatus !== 'CONNECTED') {
            const nextState: RoomStateInfo = {
              roomId: res.roomId,
              isHost: false,
              allowGuestControl: false,
              serverUrl: 'P2P',
              mode: 'P2P',
              p2pStatus: 'CONNECTING',
              connectionStatus: 'CONNECTED',
              guestAwaitingApproval: true,
              connectedPeerCount: 1,
              compositeCode: formatShareCode('P2P', res.roomId)
            };
            setRoomState(nextState);
            persistRoomSession(nextState);
          }
          syncKeepAliveAlarm(true);
          const latestState = getRoomState();
          broadcastToVideoTabs({
            type: 'CS_ROOM_STATE_CHANGED',
            payload: latestState
          });
          sendResponse({ success: true, roomId: res.roomId, roomState: latestState });
        } else {
          const errCode = res?.error || 'ERR_P2P_SIGNAL_FAILED';
          sendResponse({ success: false, error: errCode, code: errCode });
        }
      })
      .catch((err) => {
        sendResponse({ success: false, error: err?.message || 'ERR_P2P_SIGNAL_FAILED', code: 'ERR_P2P_SIGNAL_FAILED' });
      });
    return;
  }

  initSocketConnection(serverUrl)
    .then((s) => {
      const existingState = getRoomState();
      s.emit('JOIN_ROOM', {
        event: 'JOIN_ROOM',
        roomId,
        data: {
          userId,
          mode,
          resumeToken: existingState?.roomId === roomId ? existingState.resumeToken : undefined
        }
      });

      let joinSettled = false;
      const cleanupJoinListeners = () => {
        s.off('JOIN_ROOM_SUCCESS', onJoinSuccess);
        s.off('ERROR', onJoinError);
      };

      const joinTimer = setTimeout(() => {
        if (joinSettled) return;
        joinSettled = true;
        cleanupJoinListeners();
        sendResponse({ success: false, error: 'ERR_SERVER_TIMEOUT', code: 'ERR_SERVER_TIMEOUT' });
      }, 6000);

      const onJoinSuccess = (res: any) => {
        if (joinSettled) return;
        joinSettled = true;
        clearTimeout(joinTimer);
        cleanupJoinListeners();
        const actualMode: ConnectionMode = res.data?.mode || mode;

        const nextState: RoomStateInfo = {
          roomId: res.roomId,
          isHost: res.data?.isHost ?? false,
          allowGuestControl: Boolean(res.data?.allowGuestControl),
          serverUrl,
          currentUrl: getCanonicalVideoUrl(res.data?.currentUrl),
          mode: actualMode,
          p2pStatus: undefined,
          connectionStatus: 'CONNECTED',
          connectedPeerCount: 0,
          compositeCode: formatShareCode(actualMode, res.roomId, serverUrl),
          resumeToken: res.data?.resumeToken
        };
        setRoomState(nextState);
        persistRoomSession(nextState);
        syncKeepAliveAlarm(true);

        if (!nextState.isHost && nextState.currentUrl) {
          verifyAndRedirect(nextState.currentUrl);
        }

        broadcastToVideoTabs({
          type: 'CS_ROOM_STATE_CHANGED',
          payload: nextState
        });

        sendResponse({ success: true, roomId: res.roomId, roomState: nextState });
      };

      const onJoinError = (err: any) => {
        if (joinSettled) return;
        joinSettled = true;
        clearTimeout(joinTimer);
        cleanupJoinListeners();
        const code = err?.code || 'ERR_ROOM_NOT_FOUND';
        sendResponse({ success: false, error: code, code });
      };

      s.once('JOIN_ROOM_SUCCESS', onJoinSuccess);
      s.once('ERROR', onJoinError);
    })
    .catch((err) => {
      sendResponse({ success: false, error: err?.message || 'ERR_SERVER_UNREACHABLE', code: 'ERR_SERVER_UNREACHABLE' });
    });
}

function handleOffscreenDataReceived(syncData: any): void {
  if (!syncData || typeof syncData !== 'object') return;
  const currentRoomState = getRoomState();

  // 房主端二重防禦：若房主已關閉觀眾控制，且為播放操作，直接忽略
  if (currentRoomState?.isHost && !currentRoomState.allowGuestControl && syncData.action) {
    console.warn('[Background Security Drop] 房主已關閉觀眾操作，忽略 DataChannel 傳入的播放操作');
    return;
  }

  // 觀眾端不可發起 REDIRECT_ROOM 或 TOGGLE_PERMISSION
  if (currentRoomState?.isHost && (syncData.type === 'REDIRECT_ROOM' || syncData.type === 'TOGGLE_PERMISSION')) {
    console.warn('[Background Security Drop] 拒絕處理 DataChannel 傳入之偽造特權指令:', sanitizeLog(syncData.type));
    return;
  }

  if (syncData.action) {
    const validated = validateSyncData(syncData, !currentRoomState?.isHost);
    if (!validated) {
      console.warn('[Background Security Drop] 捨棄校驗失敗的 DataChannel 播放同步封包');
      return;
    }
    broadcastToVideoTabs({
      type: 'CS_SYNC_RECEIVED',
      payload: { data: validated }
    });
  } else if (syncData.type === 'REDIRECT_ROOM') {
    const cleanTarget = getCanonicalVideoUrl(syncData.targetUrl);
    if (!isUrlAllowed(cleanTarget)) {
      verifyAndRedirect(cleanTarget);
      return;
    }
    if (currentRoomState) {
      currentRoomState.currentUrl = cleanTarget;
      persistRoomSession(currentRoomState);
    }
    verifyAndRedirect(cleanTarget);
    broadcastToVideoTabs({
      type: 'CS_ROOM_STATE_CHANGED',
      payload: currentRoomState
    });
  } else if (syncData.type === 'TOGGLE_PERMISSION') {
    const allow = Boolean(syncData.allowGuestControl);
    if (currentRoomState) {
      currentRoomState.allowGuestControl = allow;
      persistRoomSession(currentRoomState);
    }
    broadcastToVideoTabs({
      type: 'CS_PERMISSION_UPDATED',
      payload: { allowGuestControl: allow }
    });
  } else if (syncData.type === 'REQUEST_INIT_SYNC') {
    if (currentRoomState?.isHost) {
      broadcastToVideoTabs({
        type: 'CS_REQUEST_CURRENT_STATE',
        payload: {}
      });
    }
  }
}

// ----------------------------------------------------
// Message 監聽器 (來自 Popup, Content Script 與 Offscreen)
// ----------------------------------------------------
if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((request: ExtensionMessage, sender, sendResponse) => {
    const { type, payload } = request;

    switch (type) {
      case 'BG_CREATE_ROOM': {
        hydrateBackgroundSession().then(() => handleCreateRoom(payload, sendResponse));
        return true;
      }

      case 'BG_JOIN_ROOM': {
        hydrateBackgroundSession().then(() => handleJoinRoom(payload, sendResponse));
        return true;
      }

      case 'BG_SYNC_STATE': {
        const syncData = payload?.data ?? (request as any).data;
        const targetGuestSocketId = payload?.targetGuestSocketId ?? (request as any).targetGuestSocketId;
        if (!syncData) break;

        hydrateBackgroundSession().then(() => {
          const room = getRoomState();
          if (!room) {
            console.warn('[Background] BG_SYNC_STATE 捨棄：尚未加入房間或工作階段已丟失');
            return;
          }

          if (
            room.isHost &&
            (!room.currentUrl || isNonVideoBrowsePage(room.currentUrl)) &&
            sender.tab?.url &&
            !isNonVideoBrowsePage(sender.tab.url)
          ) {
            room.currentUrl = getCanonicalVideoUrl(sender.tab.url);
            persistRoomSession(room);
            broadcastRoomState(room);
          }

          if (sender.tab?.url && !isNonVideoBrowsePage(sender.tab.url) && !syncData.videoUrl) {
            syncData.videoUrl = getCanonicalVideoUrl(sender.tab.url);
          }

          if (sender.tab?.url && room.currentUrl && !isNonVideoBrowsePage(room.currentUrl)) {
            const senderVideoId = getVideoIdentifier(sender.tab.url);
            const roomVideoId = getVideoIdentifier(room.currentUrl);
            if (senderVideoId && roomVideoId && senderVideoId !== roomVideoId) {
              if (!(room.isHost && sender.tab.active && !isNonVideoBrowsePage(sender.tab.url))) {
                console.log(`[Background] 捨棄來自非當前房間目標影片分頁的同步事件 (${sanitizeLog(sender.tab.url)})`);
                return;
              }
            }
          }

          if (room.mode === 'P2P') {
            chrome.runtime
              .sendMessage({
                type: 'OFFSCREEN_SEND_DATA',
                payload: syncData
              } as ExtensionMessage)
              .catch(() => {});
          } else {
            const socket = getSocket();
            if (socket) {
              socket.emit('SYNC_STATE', {
                event: 'SYNC_STATE',
                roomId: room.roomId,
                targetGuestSocketId,
                data: syncData
              });
            }
          }
        });
        break;
      }

      case 'BG_REDIRECT_ROOM': {
        const rawTargetUrl = payload?.targetUrl ?? (request as any).targetUrl;
        if (!rawTargetUrl || typeof rawTargetUrl !== 'string') {
          sendResponse({ success: false, error: 'ERR_INVALID_CODE', code: 'ERR_INVALID_CODE' });
          return true;
        }
        hydrateBackgroundSession().then(() => {
          const currentRoomState = getRoomState();
          if (currentRoomState && currentRoomState.isHost) {
            const cleanTarget = getCanonicalVideoUrl(rawTargetUrl);
            if (!isUrlAllowed(cleanTarget)) {
              verifyAndRedirect(cleanTarget);
              sendResponse({ success: false, error: 'ERR_UNAUTHORIZED_URL', code: 'ERR_UNAUTHORIZED_URL' });
              return;
            }
            currentRoomState.currentUrl = cleanTarget;
            persistRoomSession(currentRoomState);
            verifyAndRedirect(cleanTarget);
            broadcastToVideoTabs({
              type: 'CS_ROOM_STATE_CHANGED',
              payload: currentRoomState
            });

            if (currentRoomState.mode === 'P2P') {
              chrome.runtime
                .sendMessage({
                  type: 'OFFSCREEN_SEND_DATA',
                  payload: {
                    type: 'REDIRECT_ROOM',
                    targetUrl: cleanTarget
                  }
                } as ExtensionMessage)
                .catch(() => {});
            }

            const socket = getSocket();
            if (socket) {
              socket.emit('REDIRECT_ROOM', {
                event: 'REDIRECT_ROOM',
                roomId: currentRoomState.roomId,
                data: {
                  targetUrl: cleanTarget,
                  allowUniversal: getCandidatesUnlocked()
                }
              });
            }
            sendResponse({ success: true });
          } else {
            sendResponse({ success: false, error: 'ERR_HOST_ONLY', code: 'ERR_HOST_ONLY' });
          }
        });
        return true;
      }

      case 'BG_TOGGLE_PERMISSION': {
        hydrateBackgroundSession().then(() => {
          const currentRoomState = getRoomState();
          if (currentRoomState && currentRoomState.isHost) {
            currentRoomState.allowGuestControl = Boolean(payload?.allowGuestControl);
            persistRoomSession(currentRoomState);
            broadcastToVideoTabs({
              type: 'CS_PERMISSION_UPDATED',
              payload: { allowGuestControl: currentRoomState.allowGuestControl }
            });

            if (currentRoomState.mode === 'P2P') {
              chrome.runtime
                .sendMessage({
                  type: 'OFFSCREEN_UPDATE_PERMISSION',
                  payload: { allowGuestControl: currentRoomState.allowGuestControl }
                } as ExtensionMessage)
                .catch(() => {});

              if (currentRoomState.p2pStatus === 'CONNECTED') {
                chrome.runtime
                  .sendMessage({
                    type: 'OFFSCREEN_SEND_DATA',
                    payload: {
                      type: 'TOGGLE_PERMISSION',
                      allowGuestControl: currentRoomState.allowGuestControl
                    }
                  } as ExtensionMessage)
                  .catch(() => {});
              }
            }

            const socket = getSocket();
            if (socket) {
              socket.emit('TOGGLE_PERMISSION', {
                event: 'TOGGLE_PERMISSION',
                roomId: currentRoomState.roomId,
                data: { allowGuestControl: currentRoomState.allowGuestControl }
              });
            }
            sendResponse({ success: true });
          } else {
            sendResponse({ success: false, error: 'ERR_HOST_ONLY', code: 'ERR_HOST_ONLY' });
          }
        });
        return true;
      }

      case 'BG_LEAVE_ROOM': {
        chrome.runtime.sendMessage({ type: 'OFFSCREEN_CLOSE_P2P' } as ExtensionMessage).catch(() => {});
        disconnectSocket(true);
        closeOffscreenDocument().catch(() => {});
        clearBadgeAndResetSession(true);
        sendResponse({ success: true });
        break;
      }

      case 'BG_APPROVE_JOIN_REQUEST': {
        hydrateBackgroundSession().then(() => {
          const currentRoomState = getRoomState();
          sendOffscreenMessage({
            type: 'OFFSCREEN_APPROVE_JOIN_REQUEST',
            payload: {
              requestId: payload.requestId,
              hostCurrentUrl: currentRoomState?.currentUrl
            }
          } as ExtensionMessage).then(() => {
            const latestRoom = getRoomState();
            if (latestRoom?.pendingJoinRequests) {
              latestRoom.pendingJoinRequests = latestRoom.pendingJoinRequests.filter(
                (r) => r.requestId !== payload.requestId
              );
              persistRoomSession(latestRoom);
              syncJoinRequestBadge(latestRoom.pendingJoinRequests);
              broadcastRoomState(latestRoom);
            }
            // 房主核准觀眾後，分階段延遲主動推播當前影片時間與播放狀態，兼顧已就緒與導航載入中之觀眾對齊
            for (const delay of [600, 1800]) {
              setTimeout(() => {
                if (getRoomState()?.isHost) {
                  broadcastToVideoTabs({
                    type: 'CS_REQUEST_CURRENT_STATE',
                    payload: {}
                  });
                }
              }, delay);
            }
            sendResponse({ success: true });
          });
        });
        return true;
      }

      case 'BG_REJECT_JOIN_REQUEST': {
        hydrateBackgroundSession().then(() => {
          sendOffscreenMessage({
            type: 'OFFSCREEN_REJECT_JOIN_REQUEST',
            payload: { requestId: payload.requestId }
          } as ExtensionMessage).then(() => {
            const latestRoom = getRoomState();
            if (latestRoom?.pendingJoinRequests) {
              latestRoom.pendingJoinRequests = latestRoom.pendingJoinRequests.filter(
                (r) => r.requestId !== payload.requestId
              );
              persistRoomSession(latestRoom);
              syncJoinRequestBadge(latestRoom.pendingJoinRequests);
              broadcastRoomState(latestRoom);
            }
            sendResponse({ success: true });
          });
        });
        return true;
      }

      case 'BG_REQUEST_INIT_SYNC': {
        hydrateBackgroundSession().then(() => {
          const currentRoomState = getRoomState();
          if (currentRoomState && !currentRoomState.isHost) {
            if (currentRoomState.mode === 'P2P') {
              chrome.runtime
                .sendMessage({
                  type: 'OFFSCREEN_SEND_DATA',
                  payload: { type: 'REQUEST_INIT_SYNC' }
                } as ExtensionMessage)
                .catch(() => {});
            } else {
              const socket = getSocket();
              if (socket && socket.connected) {
                socket.emit('REQUEST_INIT_SYNC', {
                  event: 'REQUEST_INIT_SYNC',
                  roomId: currentRoomState.roomId
                });
              }
            }
          }
          sendResponse({ success: true });
        });
        return true;
      }

      case 'CS_JOIN_REQUESTS_UPDATED': {
        const currentRoomState = getRoomState();
        if (currentRoomState) {
          const requests = payload?.pendingRequests || [];
          currentRoomState.pendingJoinRequests = requests;
          syncJoinRequestBadge(requests);
          broadcastRoomState(currentRoomState);
        }
        break;
      }

      case 'GET_ROOM_STATE': {
        const tabUrl = sender.tab?.url;
        hydrateBackgroundSession().then(() => {
          const roomState = getRoomState();
          sendResponse({
            roomState,
            userId: getUserId(),
            compositeCode: roomState?.compositeCode,
            tabUrl
          });
        });
        return true;
      }

      case 'BG_PLAYBACK_CONFLICT_DETECTED': {
        hydrateBackgroundSession().then(() => {
          const currentRoomState = getRoomState();
          if (!currentRoomState || !payload) {
            sendResponse({ success: false });
            return;
          }
          const rawConflict = payload as PlaybackConflictState;
          const cleanHost = String(rawConflict.hostname || 'unknown')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9.-]/g, '')
            .slice(0, 80) || 'unknown';
          const cleanPlatform = sanitizeLog(rawConflict.platformId || 'unknown', 32) || 'unknown';
          const sanitizedConflict: PlaybackConflictState = {
            detected: Boolean(rawConflict.detected),
            platformId: cleanPlatform,
            hostname: cleanHost,
            reversalCount: Math.max(0, Math.min(9999, Number(rawConflict.reversalCount) || 0)),
            circuitBreakerActive: Boolean(rawConflict.circuitBreakerActive),
            lastDetectedAt: Number(rawConflict.lastDetectedAt) || Date.now(),
            dismissed: currentRoomState.playbackConflict?.dismissed ?? false,
            recentEvents: Array.isArray(rawConflict.recentEvents)
              ? rawConflict.recentEvents.slice(-15).map((evt) => ({
                  timestamp: Number(evt?.timestamp) || Date.now(),
                  type: evt?.type || 'UNPROMPTED_STATE_FLIP',
                  platformId: cleanPlatform,
                  hostname: cleanHost,
                  expectedState: evt?.expectedState || 'IDLE',
                  observedAction: evt?.observedAction || 'PLAY',
                  deltaMs: Math.max(0, Math.min(60000, Number(evt?.deltaMs) || 0)),
                  hadRecentUserInput: Boolean(evt?.hadRecentUserInput)
                }))
              : []
          };
          currentRoomState.playbackConflict = sanitizedConflict;
          recordContentionDiagnostic(sanitizedConflict);
          persistRoomSession(currentRoomState);
          broadcastRoomState(currentRoomState);
          sendResponse({ success: true });
        });
        return true;
      }

      case 'BG_DISMISS_PLAYBACK_CONFLICT': {
        hydrateBackgroundSession().then(() => {
          const currentRoomState = getRoomState();
          if (currentRoomState?.playbackConflict) {
            currentRoomState.playbackConflict = {
              ...currentRoomState.playbackConflict,
              dismissed: true
            };
            recordDiagnosticEvent('CONTENTION', 'CONFLICT_BANNER_DISMISSED');
            persistRoomSession(currentRoomState);
            broadcastRoomState(currentRoomState);
          }
          sendResponse({ success: true });
        });
        return true;
      }

      case 'GET_DIAGNOSTIC_REPORT':
      case 'GET_P2P_DIAGNOSTIC': {
        hydrateBackgroundSession().then(() => {
          const currentRoomState = getRoomState();
          const requestedCode = typeof payload?.errorCode === 'string' ? payload.errorCode : undefined;
          const needsP2POffscreen =
            currentRoomState?.mode === 'P2P' || (typeof requestedCode === 'string' && requestedCode.startsWith('ERR_P2P'));

          if (!needsP2POffscreen) {
            const report = buildUnifiedDiagnosticReport({
              roomState: currentRoomState,
              errorCode: requestedCode
            });
            sendResponse({ success: true, data: report });
            return;
          }

          ensureOffscreenDocument()
            .then(() => {
              chrome.runtime.sendMessage(
                {
                  type: 'OFFSCREEN_GET_DIAGNOSTIC',
                  payload: { errorCode: requestedCode }
                } as ExtensionMessage,
                (res) => {
                  const p2pMd = !chrome.runtime.lastError && res?.success ? res?.data?.markdownReport : undefined;
                  const report = buildUnifiedDiagnosticReport({
                    roomState: currentRoomState,
                    errorCode: requestedCode,
                    p2pMarkdown: p2pMd
                  });
                  sendResponse({ success: true, data: report });
                }
              );
            })
            .catch(() => {
              const report = buildUnifiedDiagnosticReport({
                roomState: currentRoomState,
                errorCode: requestedCode
              });
              sendResponse({ success: true, data: report });
            });
        });
        return true;
      }

      case 'BG_P2P_GUEST_APPROVED': {
        hydrateBackgroundSession().then(() => {
          const currentRoomState = getRoomState();
          if (currentRoomState) {
            currentRoomState.p2pStatus = 'CONNECTED';
            currentRoomState.guestAwaitingApproval = false;
            currentRoomState.connectedPeerCount = payload?.memberCount || 2;
            const prevUrl = currentRoomState.currentUrl;
            if (payload?.hostCurrentUrl) {
              const cleanHostUrl = getCanonicalVideoUrl(payload.hostCurrentUrl);
              if (isUrlAllowed(cleanHostUrl)) {
                currentRoomState.currentUrl = cleanHostUrl;
              } else {
                verifyAndRedirect(cleanHostUrl);
              }
            }
            persistRoomSession(currentRoomState);
            // 核心防轟炸：若網址未變更且已在 JOIN_ROOM_SUCCESS 階段校驗過，切勿重複執行 verifyAndRedirect 避免二次警報
            if (!currentRoomState.isHost && currentRoomState.currentUrl) {
              if (!prevUrl || prevUrl !== currentRoomState.currentUrl) {
                verifyAndRedirect(currentRoomState.currentUrl);
              }
            }
            broadcastRoomState(currentRoomState);
          }
          sendResponse({ success: true });
        });
        return true;
      }

      case 'CS_ROOM_STATE_CHANGED': {
        if (payload === null) {
          clearBadgeAndResetSession(false);
          broadcastToVideoTabs({
            type: 'CS_ROOM_STATE_CHANGED',
            payload: null
          });
        } else if (payload) {
          const nextState: RoomStateInfo = {
            ...(getRoomState() || ({} as RoomStateInfo)),
            ...payload
          };
          setRoomState(nextState);
          persistRoomSession(nextState);
          syncKeepAliveAlarm(true);
          broadcastToVideoTabs({
            type: 'CS_ROOM_STATE_CHANGED',
            payload: nextState
          });
        }
        break;
      }

      case 'OFFSCREEN_P2P_STATUS': {
        const currentRoomState = getRoomState();
        if (currentRoomState) {
          currentRoomState.p2pStatus = payload.status;
          currentRoomState.connectedPeerCount = payload.peerCount;
          persistRoomSession(currentRoomState);
          broadcastRoomState(currentRoomState);
        }
        break;
      }

      case 'OFFSCREEN_DATA_RECEIVED': {
        handleOffscreenDataReceived(payload);
        break;
      }
    }
  });
}

// 監聽分頁載入完成：若處於 activeTab 通用模式且為外部網頁，安全嘗試注入 content.js；若已在房間內則主動推播房間狀態加速首連同步
if (typeof chrome !== 'undefined' && chrome.tabs?.onUpdated) {
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab?.url) {
      if (getCandidatesUnlocked() && isUniversalSupportedUrl(tab.url) && !isPlatformPermitted(tab.url)) {
        if (typeof (chrome as any).scripting !== 'undefined' && (chrome as any).scripting.executeScript) {
          (chrome as any).scripting
            .executeScript({
              target: { tabId },
              files: ['content.js']
            })
            .then(() => {
              setTimeout(() => {
                chrome.tabs.sendMessage(tabId, { type: 'CS_ACTIVATE_UNIVERSAL' }).catch(() => {});
              }, 120);
            })
            .catch(() => {});
        }
      }

      const activeRoom = getRoomState();
      if (activeRoom && (isPlatformPermitted(tab.url) || (getCandidatesUnlocked() && isUniversalSupportedUrl(tab.url)))) {
        setTimeout(() => {
          const latestRoom = getRoomState();
          if (latestRoom) {
            chrome.tabs
              .sendMessage(tabId, {
                type: 'CS_ROOM_STATE_CHANGED',
                payload: latestRoom,
                parentTabUrl: tab.url
              })
              .catch(() => {});
          }
        }, 200);
      }
    }
  });
}
