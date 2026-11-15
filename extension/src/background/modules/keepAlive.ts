import { getRoomState, setRoomState, persistRoomSession } from './session';
import { getSocket, initSocketConnection } from './socketClient';
import { broadcastRoomState } from './redirector';

export const KEEP_ALIVE_ALARM_NAME = 'syncine-ping-alarm';
export const LEGACY_KEEP_ALIVE_ALARM_NAME = 'coview-ping-alarm';

/**
 * 依據是否處於活躍房間動態啟停 Service Worker 保活定時器（遵守 Chrome 官方 0.5 分鐘最低間隔）
 */
export function syncKeepAliveAlarm(isRoomActive: boolean): void {
  if (typeof chrome === 'undefined' || !chrome.alarms) return;

  if (isRoomActive) {
    chrome.alarms.get(KEEP_ALIVE_ALARM_NAME, (existing) => {
      if (!existing) {
        chrome.alarms.create(KEEP_ALIVE_ALARM_NAME, { periodInMinutes: 0.5 });
      }
    });
  } else {
    chrome.alarms.clear(KEEP_ALIVE_ALARM_NAME).catch(() => {});
    chrome.alarms.clear(LEGACY_KEEP_ALIVE_ALARM_NAME).catch(() => {});
  }
}

/**
 * 初始化 MV3 Service Worker 保活與長連接監聽器
 */
export function initKeepAliveListeners(): void {
  if (typeof chrome === 'undefined') return;

  if (chrome.runtime?.onConnect) {
    chrome.runtime.onConnect.addListener((port) => {
      if (port.name === 'syncine-keepalive' || port.name === 'coview-keepalive') {
        console.log('[Background] 收到 Content Script 長連接保活 Port');
        port.onDisconnect.addListener((p) => {
          const lastError = chrome.runtime.lastError;
          const portError = (p as any)?.error;
          if (lastError || portError) {
            // 正常 bfcache 或分頁關閉釋放
          }
          console.log('[Background] Content Script Port 斷開');
        });
      }
    });
  }

  if (chrome.alarms?.onAlarm) {
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === KEEP_ALIVE_ALARM_NAME || alarm.name === LEGACY_KEEP_ALIVE_ALARM_NAME) {
        const room = getRoomState();
        if (!room) {
          syncKeepAliveAlarm(false);
          return;
        }
        const socket = getSocket();
        if (room.mode !== 'P2P' && room.serverUrl && (!socket || !socket.connected)) {
          console.log('[Background Keep-Alive] 偵測到中繼房間斷線，嘗試恢復連線');
          initSocketConnection(room.serverUrl).catch((err) => {
            console.warn('[Background Keep-Alive] 恢復連線失敗:', err?.message || err);
          });
        }
      }
    });
  }
}

export function clearBadgeAndResetSession(broadcast: boolean = true): void {
  if (typeof chrome !== 'undefined' && chrome.action) {
    chrome.action.setBadgeText({ text: '' });
  }
  syncKeepAliveAlarm(false);
  setRoomState(null);
  persistRoomSession(null);
  if (broadcast) {
    broadcastRoomState(null);
  }
}
