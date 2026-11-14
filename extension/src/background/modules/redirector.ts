import { JoinRequest, RoomStateInfo, isSameVideoOrWebsite } from '../../types/protocol';
import { isPlatformActive, isPlatformDomainActive, isUrlAllowed as checkUrlAllowed } from '../../platforms';
import { APP_VERSION } from '../../version';
import { sanitizeLog } from '../../utils/sanitize';
import { getCandidatesUnlocked, getRoomState } from './session';

let lastSecurityAlertUrl = '';
let lastSecurityAlertTime = 0;

/**
 * 網域安全白名單檢驗函式 (雙重防禦：正則 + 原生 URL 語法解析)
 */
export function isUrlAllowed(rawUrl: string, allowCandidatesOverride?: boolean): boolean {
  const allowCandidates = allowCandidatesOverride !== undefined ? allowCandidatesOverride : getCandidatesUnlocked();
  return checkUrlAllowed(rawUrl, allowCandidates);
}

/**
 * 對因擴充套件更新/重載而失去 Content Script 連線之既有分頁，自動重新注入 Bridge 與 Content Script 並補發訊息
 */
export async function ensureTabScriptsInjected(tabId: number, tabUrl: string): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.scripting?.executeScript || !tabUrl) return;
  const allowCandidates = getCandidatesUnlocked();
  if (!isPlatformDomainActive(tabUrl, allowCandidates) && !isPlatformActive(tabUrl, allowCandidates)) {
    return;
  }

  try {
    const host = new URL(tabUrl).hostname.toLowerCase();
    if (host.includes('youtube.com') || host.includes('youtu.be')) {
      await chrome.scripting
        .executeScript({
          target: { tabId },
          files: ['youtube_bridge.js'],
          world: 'MAIN' as any
        })
        .catch(() => {});
    } else if (host.includes('netflix.com')) {
      await chrome.scripting
        .executeScript({
          target: { tabId },
          files: ['netflix_bridge.js'],
          world: 'MAIN' as any
        })
        .catch(() => {});
    }

    await chrome.scripting
      .executeScript({
        target: { tabId },
        files: ['content.js']
      })
      .catch(() => {});
  } catch {
    // 忽略無權限或系統內部分頁異常
  }
}

async function healAndResendToVideoTab(tabId: number, tabUrl: string, payloadMsg: any): Promise<void> {
  await ensureTabScriptsInjected(tabId, tabUrl);
  setTimeout(() => {
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.sendMessage(tabId, payloadMsg).catch(() => {});
    }
  }, 150);
}

/**
 * 擴充套件安裝、更新或重新載入時，主動掃描已開啟之受支援影音分頁並無縫重注入最新腳本，解決更新後首次執行失聯問題
 */
export function reinjectExistingVideoTabs(): void {
  if (typeof chrome === 'undefined' || !chrome.tabs) return;
  const allowCandidates = getCandidatesUnlocked();

  chrome.tabs.query({}, (tabs) => {
    if (!Array.isArray(tabs)) return;
    tabs.forEach((tab) => {
      const targetUrl = tab.url || (tab as any).pendingUrl;
      if (
        tab.id &&
        targetUrl &&
        (isPlatformDomainActive(targetUrl, allowCandidates) || isPlatformActive(targetUrl, allowCandidates))
      ) {
        const tabId = tab.id;
        chrome.tabs.sendMessage(tabId, { type: 'CS_PING' }, (res) => {
          const err = chrome.runtime?.lastError;
          if (err || !res?.success) {
            void ensureTabScriptsInjected(tabId, targetUrl);
          }
        });
      }
    });
  });
}

/**
 * 僅向已正式啟用支援之影片分頁發送廣播
 */
export function broadcastToVideoTabs(msg: any): void {
  if (typeof chrome === 'undefined' || !chrome.tabs) return;
  const allowCandidates = getCandidatesUnlocked();

  chrome.tabs.query({}, (tabs) => {
    let sentCount = 0;
    tabs.forEach((tab) => {
      const pendingUrl = (tab as any).pendingUrl;
      const targetUrl = tab.url || pendingUrl;
      // 局部開放守衛：僅向已正式啟用支援之分頁發送廣播 (涵蓋 tab.url.includes('nicovideo.jp') || tab.url.includes('catchplay.com') || tab.url.includes('netflix.com'))
      if (
        tab.id &&
        targetUrl &&
        (isPlatformDomainActive(targetUrl, allowCandidates) || isPlatformActive(targetUrl, allowCandidates))
      ) {
        const tabId = tab.id;
        const outbound = { ...msg, parentTabUrl: targetUrl };
        chrome.tabs.sendMessage(tabId, outbound).catch(() => {
          void healAndResendToVideoTab(tabId, targetUrl, outbound);
        });
        sentCount++;
      }
    });
    console.log(
      `[Background] broadcastToVideoTabs (${msg?.type || 'unknown'}): 已發送至 ${sentCount} 個影片分頁 (系統查詢到 ${tabs.length} 個分頁)`
    );
  });
}

export function broadcastRoomState(state: RoomStateInfo | null): void {
  broadcastToVideoTabs({
    type: 'CS_ROOM_STATE_CHANGED',
    payload: state
  });
  if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
    chrome.runtime
      .sendMessage({
        type: 'CS_ROOM_STATE_CHANGED',
        payload: state
      })
      .catch(() => {});
  }
}

export function syncJoinRequestBadge(pendingRequests?: JoinRequest[]): void {
  if (typeof chrome === 'undefined' || !chrome.action) return;
  const count = pendingRequests?.length || 0;
  chrome.action.setBadgeText({ text: count > 0 ? `${count}` : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#10b981' });
}

/**
 * 驗證目標網址是否符合平台安全白名單；若安全則智慧切換或導航分頁，若違規則觸發 15 秒冷卻資安警報
 */
export function verifyAndRedirect(targetUrl: string): void {
  const cleanUrl = typeof targetUrl === 'string' ? targetUrl.trim() : '';
  const isSafe = isUrlAllowed(cleanUrl);
  const currentRoomState = getRoomState();

  if (isSafe) {
    console.log(`[Background] 通過安全白名單，處理跳轉/同步: ${sanitizeLog(cleanUrl)}`);
    if (typeof chrome === 'undefined' || !chrome.tabs) return;

    chrome.tabs.query({}, (tabs) => {
      // 1. 優先查詢當前焦點視窗的活躍分頁，若無則查詢全域活躍分頁
      const activeTab =
        tabs && (tabs.find((t) => t.active && (t as any).lastFocusedWindow) || tabs.find((t) => t.active));

      // 2. 核心防重整守衛：若當前活躍分頁已在目標影片/網站，絕對不強制刷新畫面 (杜絕 tabs.update)
      const isAlreadyOnVideo = activeTab && isSameVideoOrWebsite(activeTab.url, cleanUrl);
      if (isAlreadyOnVideo) {
        console.log(
          `[Background] 當前活躍分頁已在目標網站/影片 (Tab ID: ${activeTab.id}): ${sanitizeLog(cleanUrl)}，不強制刷新畫面`
        );
        if (activeTab.id) {
          const tabId = activeTab.id;
          const tabUrl = activeTab.url || cleanUrl;
          const stateMsg = {
            type: 'CS_ROOM_STATE_CHANGED',
            payload: currentRoomState
          };
          chrome.tabs.sendMessage(tabId, stateMsg).catch(() => {
            void healAndResendToVideoTab(tabId, tabUrl, stateMsg);
          });
        }
        return;
      }

      // 3. 檢查其他非活躍分頁中是否已有分頁在目標影片/網站
      const existingTargetTab = tabs && tabs.find((t) => isSameVideoOrWebsite(t.url, cleanUrl));
      if (existingTargetTab && existingTargetTab.id) {
        console.log(
          `[Background] 偵測到現有分頁已在目標網站/影片 (Tab ID: ${existingTargetTab.id}): ${sanitizeLog(cleanUrl)}，切換焦點，不強制刷新畫面`
        );
        const tabId = existingTargetTab.id;
        const tabUrl = existingTargetTab.url || cleanUrl;
        const stateMsg = {
          type: 'CS_ROOM_STATE_CHANGED',
          payload: currentRoomState
        };
        chrome.tabs.sendMessage(tabId, stateMsg).catch(() => {
          void healAndResendToVideoTab(tabId, tabUrl, stateMsg);
        });
        // 僅切換至目標影片分頁，絕對不調用 chrome.tabs.update 重新載入網址
        chrome.tabs.update(existingTargetTab.id, { active: true });
        return;
      }

      // 4. 若所有分頁皆不在目標網站/影片，才執行導航跳轉至新影片
      if (activeTab && activeTab.id) {
        console.log(`[Background] 目標網站與觀眾當前畫面不同，導航活躍分頁至: ${sanitizeLog(cleanUrl)}`);
        chrome.tabs.update(activeTab.id, { url: cleanUrl });
      } else {
        console.log(`[Background] 查無活躍分頁，自動新建分頁載入目標影片: ${sanitizeLog(cleanUrl)}`);
        chrome.tabs.create({ url: cleanUrl });
      }
    });
  } else {
    console.error(`[Syncine 資安警告] 攔截非白名單跳轉網址: ${sanitizeLog(cleanUrl)}`);
    const now = Date.now();
    // 核心防轟炸冷卻機制：若 15 秒內已針對同一非安全網址發出過警告，則抑制重複發送
    if (cleanUrl === lastSecurityAlertUrl && now - lastSecurityAlertTime < 15000) {
      console.warn(`[Syncine Background] 15秒內已針對此網址發出資安警告，抑制重複派發: ${sanitizeLog(cleanUrl)}`);
      return;
    }
    lastSecurityAlertUrl = cleanUrl;
    lastSecurityAlertTime = now;

    if (typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
          chrome.tabs
            .sendMessage(tabs[0].id, {
              type: 'SHOW_SECURITY_ALERT',
              payload: { url: cleanUrl, version: APP_VERSION }
            })
            .catch(() => {});
        }
      });
    }
  }
}
