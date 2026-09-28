import { SyncData, getVideoIdentifier } from '../types/protocol';
import { getStandaloneText } from '../locales';

console.log('[Syncine ContentScript] 腳本已載入 (Frame:', window.self === window.top ? 'Main Window' : 'Iframe', ')');

// ----------------------------------------------------
// 1. MV3 長連接 Port 保活
// ----------------------------------------------------
let keepAlivePort: chrome.runtime.Port | null = null;
try {
  keepAlivePort = chrome.runtime.connect({ name: 'syncine-keepalive' });
  keepAlivePort.onDisconnect.addListener(() => {
    console.log('[Syncine ContentScript] Keep-Alive Port 斷開，試圖重新連線...');
  });
} catch (e) {
  console.warn('[Syncine] 建立 Keep-Alive Port 失敗:', e);
}

// ----------------------------------------------------
// 2. 全域狀態變數
// ----------------------------------------------------
let targetVideo: HTMLVideoElement | null = null;
let programmaticUntilTimestamp = 0;
let roomState: {
  isInRoom: boolean;
  isHost: boolean;
  allowGuestControl: boolean;
  currentUrl?: string;
} = {
  isInRoom: false,
  isHost: false,
  allowGuestControl: false
};
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let bufferingTimer: ReturnType<typeof setTimeout> | null = null;
let seekDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let isUserSeeking = false;
let wasPlayingBeforeSeek = false;

function markProgrammatic(durationMs = 800) {
  programmaticUntilTimestamp = Date.now() + durationMs;
}

function isProgrammatic(): boolean {
  return Date.now() < programmaticUntilTimestamp;
}

/**
 * 核心防線：檢查當前分頁影片是否為房間目前指定播放的影片
 * 若房主另開新分頁播放新影片，舊分頁將判定為 false，立即靜音心跳與事件
 */
function isCurrentActiveVideoTab(): boolean {
  if (!roomState.isInRoom) return false;
  // 若房間未指定 currentUrl，暫不限制
  if (!roomState.currentUrl) return true;

  const myId = getVideoIdentifier(window.location.href);
  const roomId = getVideoIdentifier(roomState.currentUrl);
  if (!myId || !roomId) return true;
  return myId === roomId;
}

// ----------------------------------------------------
// 3. 跨平台 Video 選擇器與動態捕捉
// ----------------------------------------------------
function findVideoElement(): HTMLVideoElement | null {
  const host = window.location.hostname;

  if (host.includes('youtube.com')) {
    return document.querySelector('video.html5-main-video') as HTMLVideoElement;
  } else if (host.includes('bilibili.com')) {
    return document.querySelector('.bpx-player-video-wrap video') || document.querySelector('video') as HTMLVideoElement;
  } else if (host.includes('google.com')) {
    return document.querySelector('video.video-stream') || document.querySelector('video') as HTMLVideoElement;
  }
  return document.querySelector('video') as HTMLVideoElement;
}

// YouTube SPA 導航與廣告偵測
function isYouTubeAdPlaying(): boolean {
  if (!window.location.hostname.includes('youtube.com')) return false;
  const adOverlay = document.querySelector('.video-ads') || document.querySelector('.ytp-ad-player-overlay');
  return !!adOverlay && (adOverlay as HTMLElement).offsetWidth > 0;
}

// ----------------------------------------------------
// 4. 定時心跳 (Host 端 3 秒發送一次)
// ----------------------------------------------------
function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    if (!targetVideo || !roomState.isInRoom || !roomState.isHost) return;

    // 核心防護：若本分頁已非房間當前影片，自我靜音並停止心跳，徹底根絕時間軸干擾
    if (!isCurrentActiveVideoTab()) {
      console.log('[Syncine Heartbeat] 偵測到本分頁影片已過期 (非當前房間目標影片)，自動靜音心跳');
      stopHeartbeat();
      return;
    }

    if (isYouTubeAdPlaying()) return;

    chrome.runtime.sendMessage({
      type: 'BG_SYNC_STATE',
      data: {
        action: 'HEARTBEAT',
        currentTime: targetVideo.currentTime,
        paused: targetVideo.paused,
        timestamp: Date.now()
      }
    });
  }, 3000);
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

// ----------------------------------------------------
// 5. 5 秒容差與單程延遲補償演算法 (規格 4.2)
// ----------------------------------------------------
function applySyncState(data: SyncData) {
  if (!targetVideo || !roomState.isInRoom) return;
  // 觀眾端防護：若自身尚未處於目標影片，不套用時間軸校準，避免分頁未跳轉前時間跳動
  if (!isCurrentActiveVideoTab()) {
    console.log('[Syncine] 當前分頁影片與房間目標不符，略過時間軸同步');
    return;
  }

  if (isYouTubeAdPlaying()) {
    console.log('[Syncine] 廣告播放中，忽略同步事件');
    return;
  }

  const { action, currentTime: serverSentTime, timestamp: clientSentTimestamp, paused: serverPaused } = data;
  const clientReceiveTimestamp = Date.now();

  // 計算單程延遲 (毫秒轉秒)
  const networkLatency = Math.max(0, (clientReceiveTimestamp - clientSentTimestamp) / 2 / 1000);
  const isTargetPaused = action === 'PAUSE' || (action === 'HEARTBEAT' && serverPaused);
  const targetServerTime = serverSentTime + (isTargetPaused ? 0 : networkLatency);
  const localTime = targetVideo.currentTime;
  const timeDiff = Math.abs(localTime - targetServerTime);

  // 標記接下來的 1000ms 為腳本同步操作，防止事件回彈與循環觸發
  markProgrammatic(1000);

  if (action === 'PLAY') {
    // 只有在時間差大於 0.5 秒或處於不同播放狀態時校準進度，避免極小誤差造成重複 Seek
    if (timeDiff > 0.5) {
      targetVideo.currentTime = targetServerTime;
    }
    if (targetVideo.paused) {
      targetVideo.play().catch((err) => console.log('[Syncine Play Intercepted]:', err));
    }
  } else if (action === 'PAUSE') {
    // 暫停時若時間差距小於 0.5 秒直接 pause，不強制 seek，消除播放器暫停時的畫面閃爍與誤判卡頓
    if (timeDiff > 0.5) {
      targetVideo.currentTime = targetServerTime;
    }
    targetVideo.pause();
  } else if (action === 'SEEK') {
    // 主動 Seek 事件無視容差，強制作業更新時間軸
    targetVideo.currentTime = targetServerTime;

    // 同步發送端的播放狀態：若發送端在播放，全員跟隨播放；若發送端在暫停，全員跟隨暫停
    if (serverPaused === false) {
      console.log('[Syncine Seek] 發送端正在播放，接收端跟隨同步播放');
      targetVideo.play().catch((err) => console.log('[Syncine Seek Play Intercepted]:', err));
    } else if (serverPaused === true) {
      console.log('[Syncine Seek] 發送端處於暫停，接收端跟隨暫停');
      targetVideo.pause();
    }
  } else if (action === 'HEARTBEAT') {
    // 1. 雙向校準播放狀態
    if (typeof serverPaused === 'boolean') {
      if (serverPaused && !targetVideo.paused) {
        console.log('[Syncine Heartbeat] 主機目前為暫停，觀眾對齊暫停');
        targetVideo.pause();
      } else if (!serverPaused && targetVideo.paused) {
        console.log('[Syncine Heartbeat] 主機目前為播放，觀眾對齊播放');
        targetVideo.play().catch(() => {});
      }
    }

    // 2. 被動心跳 5 秒容差檢查 (在暫停或非必要狀態下不隨意位移)
    if (timeDiff > 5) {
      console.log(`[Syncine Heartbeat] 時間差為 ${timeDiff.toFixed(2)} 秒 (>5秒)，強制同步位移至: ${targetServerTime}`);
      targetVideo.currentTime = targetServerTime;
    }
  }
}

// ----------------------------------------------------
// 6. 綁定 Video DOM 事件監聽
// ----------------------------------------------------
function attachVideoListeners(video: HTMLVideoElement) {
  if ((video as any).__syncine_attached || (video as any).__coview_attached) return;
  (video as any).__syncine_attached = true;
  targetVideo = video;

  console.log('[Syncine] 成功綁定 Target Video DOM');

  video.addEventListener('play', () => {
    // 未在房間內，徹底放行使用者原生播放！
    if (!roomState.isInRoom) return;
    // 舊分頁或非當前影片，不外發同步事件
    if (!isCurrentActiveVideoTab()) return;
    if (isProgrammatic() || isYouTubeAdPlaying()) return;

    if (!roomState.isHost && !roomState.allowGuestControl) {
      console.warn('[Syncine Intercept] 觀眾無權限發起播放，回滾狀態');
      markProgrammatic(400);
      video.pause();
      return;
    }

    chrome.runtime.sendMessage({
      type: 'BG_SYNC_STATE',
      data: {
        action: 'PLAY',
        currentTime: video.currentTime,
        paused: false,
        timestamp: Date.now()
      }
    });
  });

  video.addEventListener('pause', () => {
    // 未在房間內，徹底放行使用者原生暫停！
    if (!roomState.isInRoom) return;
    // 舊分頁或非當前影片，不外發同步事件
    if (!isCurrentActiveVideoTab()) return;
    if (isProgrammatic() || isYouTubeAdPlaying()) return;

    if (!roomState.isHost && !roomState.allowGuestControl) {
      console.warn('[Syncine Intercept] 觀眾無權限發起暫停，回滾狀態');
      markProgrammatic(400);
      video.play().catch(() => {});
      return;
    }

    chrome.runtime.sendMessage({
      type: 'BG_SYNC_STATE',
      data: {
        action: 'PAUSE',
        currentTime: video.currentTime,
        paused: true,
        timestamp: Date.now()
      }
    });
  });

  function broadcastSeek() {
    if (!targetVideo || !roomState.isInRoom) return;
    if (!isCurrentActiveVideoTab()) return;

    // 若跳轉前處於播放狀態，或當前已開播，則目標狀態認定為播放中 (paused: false)
    const isPaused = targetVideo.paused && !wasPlayingBeforeSeek;

    chrome.runtime.sendMessage({
      type: 'BG_SYNC_STATE',
      data: {
        action: 'SEEK',
        currentTime: targetVideo.currentTime,
        paused: isPaused,
        timestamp: Date.now()
      }
    });
  }

  video.addEventListener('seeking', () => {
    if (!roomState.isInRoom) return;
    if (!isCurrentActiveVideoTab()) return;
    if (isProgrammatic() || isYouTubeAdPlaying()) return;
    if (!roomState.isHost && !roomState.allowGuestControl) return;

    if (!isUserSeeking) {
      isUserSeeking = true;
      wasPlayingBeforeSeek = !video.paused;
    }

    if (seekDebounceTimer) clearTimeout(seekDebounceTimer);
    seekDebounceTimer = setTimeout(() => {
      broadcastSeek();
    }, 150);
  });

  video.addEventListener('seeked', () => {
    if (!roomState.isInRoom) return;
    if (!isCurrentActiveVideoTab()) return;
    if (isProgrammatic() || isYouTubeAdPlaying()) return;
    if (!roomState.isHost && !roomState.allowGuestControl) return;

    if (seekDebounceTimer) clearTimeout(seekDebounceTimer);
    setTimeout(() => {
      broadcastSeek();
      isUserSeeking = false;
    }, 50);
  });

  // 規格 9: 緩衝卡頓處理 (waiting) - 5 秒防抖，避免網路輕微波動造成過度頻繁暫停
  video.addEventListener('waiting', () => {
    if (!roomState.isInRoom) return;
    if (!isCurrentActiveVideoTab()) return;
    if (isProgrammatic() || isYouTubeAdPlaying() || video.paused) return;
    if (!roomState.isHost && !roomState.allowGuestControl) return;

    // 只有在真正卡頓持續超過 5 秒時才廣播暫停
    if (bufferingTimer) clearTimeout(bufferingTimer);
    bufferingTimer = setTimeout(() => {
      if (!video.paused && !isProgrammatic()) {
        console.log('[Syncine] 偵測到嚴重網路卡頓 (>5s)，廣播全房暫停');
        chrome.runtime.sendMessage({
          type: 'BG_SYNC_STATE',
          data: {
            action: 'PAUSE',
            currentTime: video.currentTime,
            paused: true,
            timestamp: Date.now()
          }
        });
      }
    }, 5000);
  });

  video.addEventListener('playing', () => {
    if (bufferingTimer) {
      clearTimeout(bufferingTimer);
      bufferingTimer = null;
    }
  });

  video.addEventListener('canplay', () => {
    if (bufferingTimer) {
      clearTimeout(bufferingTimer);
      bufferingTimer = null;
    }
  });
}

// ----------------------------------------------------
// 7. MutationObserver 與初始化
// ----------------------------------------------------
function initObserver() {
  const v = findVideoElement();
  if (v) {
    attachVideoListeners(v);
  }

  const observer = new MutationObserver(() => {
    const video = findVideoElement();
    if (video && video !== targetVideo) {
      attachVideoListeners(video);
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

// YouTube SPA 切換影片事件
window.addEventListener('yt-navigate-finish', () => {
  console.log('[Syncine] 偵測到 YouTube SPA 網頁導航切換');
  setTimeout(() => {
    initObserver();
    if (roomState.isInRoom && roomState.isHost) {
      if (isCurrentActiveVideoTab()) {
        startHeartbeat();
      } else {
        stopHeartbeat();
      }
    }
  }, 1000);
});

// 向 Background 獲取最新狀態
chrome.runtime.sendMessage({ type: 'GET_ROOM_STATE' }, (res) => {
  if (res?.roomState) {
    roomState = {
      isInRoom: true,
      isHost: res.roomState.isHost,
      allowGuestControl: res.roomState.allowGuestControl,
      currentUrl: res.roomState.currentUrl
    };
    if (roomState.isHost && isCurrentActiveVideoTab()) {
      startHeartbeat();
    } else {
      stopHeartbeat();
    }
  } else {
    roomState = { isInRoom: false, isHost: false, allowGuestControl: false };
    stopHeartbeat();
  }
});

// 監聽來自 Background 的動態訊息
chrome.runtime.onMessage.addListener((request) => {
  const { type, payload } = request;

  if (type === 'CS_SYNC_RECEIVED') {
    applySyncState(payload.data);
  } else if (type === 'CS_ROOM_STATE_CHANGED') {
    if (payload) {
      roomState = {
        isInRoom: true,
        isHost: payload.isHost,
        allowGuestControl: payload.allowGuestControl,
        currentUrl: payload.currentUrl
      };
      console.log('[Syncine] 房間狀態即時更新 (已在房間中):', roomState);
      if (roomState.isHost && isCurrentActiveVideoTab()) {
        startHeartbeat();
      } else {
        stopHeartbeat();
      }
    } else {
      roomState = { isInRoom: false, isHost: false, allowGuestControl: false };
      stopHeartbeat();
      console.log('[Syncine] 已退出房間，完全釋放播放器控制權限');
    }
  } else if (type === 'CS_REQUEST_CURRENT_STATE') {
    // 規格 4.1 Host 被要求回報狀態給新進人員 (僅當前影片分頁允許回報)
    if (targetVideo && roomState.isHost && isCurrentActiveVideoTab()) {
      console.log('[Syncine Host] 回報最新影片狀態給新進成員 Socket:', payload.targetGuestSocketId);
      chrome.runtime.sendMessage({
        type: 'BG_SYNC_STATE',
        targetGuestSocketId: payload.targetGuestSocketId,
        data: {
          action: targetVideo.paused ? 'PAUSE' : 'PLAY',
          currentTime: targetVideo.currentTime,
          timestamp: Date.now()
        }
      });
    }
  } else if (type === 'CS_PERMISSION_UPDATED') {
    roomState.allowGuestControl = payload.allowGuestControl;
    console.log('[Syncine] 觀眾權限狀態更新:', roomState.allowGuestControl);
  } else if (type === 'SHOW_SECURITY_ALERT') {
    const alertMsg = getStandaloneText('ERR_UNAUTHORIZED_URL', '【Syncine 安全警告】房主嘗試將您導向未授權的網址，系統已自動攔截！');
    alert(`${alertMsg} (${payload.url})`);
  }
});

initObserver();
