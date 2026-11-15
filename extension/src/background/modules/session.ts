import { RoomStateInfo } from '../../types/protocol';
import { sanitizeLog } from '../../utils/sanitize';

export const SESSION_STORAGE_KEY = 'syncine_active_session';

/**
 * 密碼學安全隨機 User ID 產生器 (杜絕偽造與預測)
 */
export function generateSecureUserId(prefix: string = 'user_', byteLength: number = 8): string {
  const array = new Uint8Array(byteLength);
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(array);
  } else {
    for (let i = 0; i < byteLength; i++) {
      array[i] = Math.floor(Math.random() * 256);
    }
  }
  return prefix + Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('');
}

let userId: string = generateSecureUserId();
let currentRoomState: RoomStateInfo | null = null;
let candidatesUnlocked = false;
let hydrationPromise: Promise<void> | null = null;

export function getUserId(): string {
  return userId;
}

export function getRoomState(): RoomStateInfo | null {
  return currentRoomState;
}

export function setRoomState(state: RoomStateInfo | null): void {
  currentRoomState = state;
}

export function getCandidatesUnlocked(): boolean {
  return candidatesUnlocked;
}

export function persistRoomSession(state: RoomStateInfo | null): void {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
  if (state) {
    chrome.storage.local.set({ [SESSION_STORAGE_KEY]: state });
  } else {
    chrome.storage.local.remove([SESSION_STORAGE_KEY]);
  }
}

export interface HydrateOptions {
  onRelaySessionRestored?: (saved: RoomStateInfo) => void;
}

/**
 * 確保 Service Worker 喚醒後已完成本機 storage 工作階段還原（單一併發鎖定）
 */
export function ensureSessionHydrated(options?: HydrateOptions): Promise<void> {
  if (hydrationPromise) {
    return hydrationPromise;
  }

  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    hydrationPromise = Promise.resolve();
    return hydrationPromise;
  }

  hydrationPromise = new Promise<void>((resolve) => {
    chrome.storage.local.get(
      ['syncine_user_id', 'coview_user_id', SESSION_STORAGE_KEY, 'syncine_unlock_candidates'],
      (result) => {
        if (result?.syncine_user_id) {
          userId = result.syncine_user_id;
        } else if (result?.coview_user_id) {
          userId = result.coview_user_id;
          chrome.storage.local.set({ syncine_user_id: userId });
        } else {
          chrome.storage.local.set({ syncine_user_id: userId });
        }

        candidatesUnlocked = Boolean(result?.syncine_unlock_candidates);

        // 僅在尚未於本次 SW 生命週期建立新狀態時才還原舊工作階段
        if (!currentRoomState && result?.[SESSION_STORAGE_KEY]) {
          const saved = result[SESSION_STORAGE_KEY] as RoomStateInfo;
          console.log('[Background] 還原前次本機暫存工作階段:', sanitizeLog(saved.roomId));

          if (saved.mode === 'P2P') {
            // P2P 連線依賴 Offscreen WebRTC Peer 實例，SW 重啟後無法隱式續傳連線，需標記斷線並清除過期審核態
            currentRoomState = {
              ...saved,
              connectionStatus: 'DISCONNECTED',
              p2pStatus: 'DISCONNECTED',
              guestAwaitingApproval: false,
              pendingJoinRequests: []
            };
            persistRoomSession(currentRoomState);
          } else {
            currentRoomState = {
              ...saved,
              connectionStatus: 'RECONNECTING'
            };
            if (saved.serverUrl && options?.onRelaySessionRestored) {
              options.onRelaySessionRestored(currentRoomState);
            }
          }
        }
        resolve();
      }
    );
  });

  return hydrationPromise;
}

if (typeof chrome !== 'undefined' && chrome?.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.syncine_unlock_candidates) {
      candidatesUnlocked = Boolean(changes.syncine_unlock_candidates.newValue);
    }
  });
}
