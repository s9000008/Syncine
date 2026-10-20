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
// 房主「已確認卡頓 (>5s)」旗標：期間心跳一律回報 paused:true，避免暫停被下一次心跳抵銷 (規格 9.1)
let hostStallActive = false;
let seekDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let isUserSeeking = false;
let wasPlayingBeforeSeek = false;
let lastSyncedTime = 0;

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
function findNiconicoVideo(): HTMLVideoElement | null {
  const allVideos = Array.from(
    document.querySelectorAll(
      '[data-name="VideoPlayer"] video, [data-name="MainVideoPlayer"] video, #MainVideoPlayer video, .MainVideoPlayer video, video'
    )
  ) as HTMLVideoElement[];

  // 排除 Niconico 廣告容器內的 video，避免誤綁廣告播放器
  const candidates = allVideos.filter(
    (v) => !v.closest('[class*="VideoAd"], #nv_watch_VideoAdContainer, [class*="AdContainer"]')
  );
  if (candidates.length === 0) return null;

  // 1. 優先鎖定正在播放且已載入的 video
  const playing = candidates.find((v) => !v.paused && v.readyState > 0);
  if (playing) return playing;

  // 2. 優先鎖定具備有效 src (如 blob:) 且可視寬度大於 0 的主播放器 video
  const activeMain = candidates.find(
    (v) => Boolean(v.currentSrc || v.getAttribute('src')) && v.offsetWidth > 0
  );
  if (activeMain) return activeMain;

  // 3. 鎖定具備有效 src 或 readyState > 0 的 video
  const withSrc = candidates.find(
    (v) => Boolean(v.currentSrc || v.getAttribute('src')) || v.readyState > 0
  );
  if (withSrc) return withSrc;

  return candidates[0];
}

function findAnime1Video(): HTMLVideoElement | null {
  const videos = Array.from(
    document.querySelectorAll('video.vjs-tech, .video-js video, .vjscontainer video, video')
  ) as HTMLVideoElement[];
  if (videos.length === 0) return null;

  // 1. 優先鎖定正在播放中的 video (支援番劇合集頁切換集數)
  const playing = videos.find((v) => !v.paused);
  if (playing) return playing;

  // 2. 若已綁定之 targetVideo 仍在 DOM 中且已載入串流來源，維持鎖定
  if (
    targetVideo &&
    document.contains(targetVideo) &&
    (Boolean(targetVideo.currentSrc || targetVideo.getAttribute('src')) || targetVideo.readyState > 0)
  ) {
    return targetVideo;
  }

  // 3. 選擇已載入串流來源 (點過播放鈕) 的 video
  const loaded = videos.find(
    (v) => Boolean(v.currentSrc || v.getAttribute('src')) || v.readyState > 0
  );
  if (loaded) return loaded;

  // 4. 預設選擇第一個可視的 video.vjs-tech
  return videos.find((v) => v.offsetWidth > 0) || videos[0];
}

function findVideoElement(): HTMLVideoElement | null {
  const host = window.location.hostname;

  if (host.includes('youtube.com')) {
    return document.querySelector('video.html5-main-video') as HTMLVideoElement;
  } else if (host.includes('bilibili.com')) {
    return document.querySelector('.bpx-player-video-wrap video') || document.querySelector('video') as HTMLVideoElement;
  } else if (host.includes('nicovideo.jp')) {
    return findNiconicoVideo();
  } else if (host.includes('anime1.me')) {
    return findAnime1Video();
  } else if (host.includes('google.com')) {
    return document.querySelector('video.video-stream') || document.querySelector('video') as HTMLVideoElement;
  }
  return document.querySelector('video') as HTMLVideoElement;
}

/**
 * Anime1.me 專屬：懶載入播放器自動喚醒機制
 * Anime1 在使用者點擊 .vjs-big-play-button 前，<video class="vjs-tech"> 無 src 屬性。
 * 當收到遠端同步播放/跳轉指令而本地尚未初始化串流時，自動點擊播放鈕觸發 data-apireq 載入並對齊進度。
 */
function ensureAnime1SourceReady(
  video: HTMLVideoElement,
  targetTime: number,
  shouldPlay: boolean
): boolean {
  if (!window.location.hostname.includes('anime1.me')) return true;
  if (Boolean(video.currentSrc || video.getAttribute('src')) || video.readyState > 0) {
    return true;
  }

  (video as any).__syncinePendingTarget = { targetTime, shouldPlay };

  if (!(video as any).__syncineWakingUp) {
    (video as any).__syncineWakingUp = true;
    const container =
      video.closest('.video-js, .vjscontainer, .ap-video-wrapper') || document;
    const bigPlayBtn = container.querySelector('.vjs-big-play-button') as HTMLElement | null;

    video.addEventListener(
      'loadedmetadata',
      () => {
        (video as any).__syncineWakingUp = false;
        const pending = (video as any).__syncinePendingTarget;
        if (!pending) return;
        markProgrammatic(1000);
        if (pending.targetTime > 0.5) {
          video.currentTime = pending.targetTime;
        }
        lastSyncedTime = video.currentTime;
        if (pending.shouldPlay) {
          video.play().catch(() => {});
        } else {
          video.pause();
        }
      },
      { once: true }
    );

    if (bigPlayBtn) {
      console.log('[Syncine Anime1] 偵測到播放器尚未初始化串流，自動點擊 .vjs-big-play-button 載入來源');
      markProgrammatic(1500);
      bigPlayBtn.click();
    }
  }

  return false;
}

// YouTube 與 Niconico 廣告偵測
function isYouTubeAdPlaying(): boolean {
  const host = window.location.hostname;
  if (host.includes('nicovideo.jp')) {
    const adContainer =
      document.querySelector('#nv_watch_VideoAdContainer') ||
      document.querySelector('[class*="VideoAdContainer"]');
    if (!adContainer || (adContainer as HTMLElement).offsetWidth === 0) return false;
    const adVideo = adContainer.querySelector('video') as HTMLVideoElement | null;
    return Boolean(adVideo && !adVideo.paused && (adVideo.currentSrc || adVideo.getAttribute('src')));
  }
  if (!host.includes('youtube.com')) return false;
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
        paused: targetVideo.paused || hostStallActive,
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

  // Anime1.me 懶載入防護：若收到需播放或跳轉指令但本地播放器尚未點擊載入 src，先自動喚醒載入
  const needsSource = action === 'PLAY' || action === 'SEEK' || (action === 'HEARTBEAT' && !serverPaused);
  if (needsSource) {
    if (!ensureAnime1SourceReady(targetVideo, targetServerTime, !isTargetPaused)) {
      return;
    }
  }

  // 標記接下來的 1000ms 為腳本同步操作，防止事件回彈與循環觸發
  markProgrammatic(1000);

  if (action === 'PLAY') {
    // 只有在時間差大於 0.5 秒或處於不同播放狀態時校準進度，避免極小誤差造成重複 Seek
    if (timeDiff > 0.5) {
      targetVideo.currentTime = targetServerTime;
    }
    lastSyncedTime = targetVideo.currentTime;
    if (targetVideo.paused) {
      targetVideo.play().catch((err) => console.log('[Syncine Play Intercepted]:', err));
    }
  } else if (action === 'PAUSE') {
    // 暫停時若時間差距小於 0.5 秒直接 pause，不強制 seek，消除播放器暫停時的畫面閃爍與誤判卡頓
    if (timeDiff > 0.5) {
      targetVideo.currentTime = targetServerTime;
    }
    lastSyncedTime = targetVideo.currentTime;
    targetVideo.pause();
  } else if (action === 'SEEK') {
    // 主動 Seek 事件無視容差，強制作業更新時間軸
    targetVideo.currentTime = targetServerTime;
    lastSyncedTime = targetServerTime;

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
      lastSyncedTime = targetServerTime;
    } else {
      lastSyncedTime = targetVideo.currentTime;
    }
  }
}

// ----------------------------------------------------
// 6. 綁定 Video DOM 事件監聽
// ----------------------------------------------------
function attachVideoListeners(video: HTMLVideoElement) {
  if (targetVideo !== video) {
    targetVideo = video;
    lastSyncedTime = video.currentTime || 0;
  }
  if ((video as any).__syncine_attached || (video as any).__coview_attached) return;
  (video as any).__syncine_attached = true;

  console.log('[Syncine] 成功綁定 Target Video DOM');

  // 持續追蹤合法播放推進時間，供無權限觀眾私自拖曳進度條時回滾基準使用
  video.addEventListener('timeupdate', () => {
    if (!video.seeking && !isUserSeeking) {
      if (
        !roomState.isInRoom ||
        roomState.isHost ||
        roomState.allowGuestControl ||
        Math.abs(video.currentTime - lastSyncedTime) < 1.5
      ) {
        lastSyncedTime = video.currentTime;
      }
    }
  });

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

    // 房主手動暫停，卡頓狀態隨之結束 (不再於恢復時自動發送 PLAY)
    hostStallActive = false;

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

    lastSyncedTime = targetVideo.currentTime;
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

    if (!roomState.isHost && !roomState.allowGuestControl) {
      if (Math.abs(video.currentTime - lastSyncedTime) > 0.5) {
        console.warn(`[Syncine Intercept] 觀眾無權限拖曳進度條，強制回滾至同步時間: ${lastSyncedTime.toFixed(2)}s`);
        markProgrammatic(400);
        video.currentTime = lastSyncedTime;
      }
      return;
    }

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

  // 規格 9.1: 緩衝卡頓處理 (waiting) - 僅「房主」卡頓超過 5 秒才廣播全房暫停
  // 觀眾 (含已授權觀眾) 自身卡頓不外發任何指令，僅本機緩衝，落後進度交由心跳 5 秒容差校正
  video.addEventListener('waiting', () => {
    if (!roomState.isInRoom) return;
    if (!roomState.isHost) return;
    if (!isCurrentActiveVideoTab()) return;
    if (isProgrammatic() || isYouTubeAdPlaying() || video.paused) return;

    // 只有在真正卡頓持續超過 5 秒時才廣播暫停 (5 秒防抖，避免網路輕微波動造成過度頻繁暫停)
    if (bufferingTimer) clearTimeout(bufferingTimer);
    bufferingTimer = setTimeout(() => {
      bufferingTimer = null;
      if (!roomState.isInRoom || !roomState.isHost) return;
      if (video.paused || isProgrammatic() || isYouTubeAdPlaying()) return;

      console.log('[Syncine] 房主偵測到嚴重網路卡頓 (>5s)，廣播全房暫停');
      hostStallActive = true;
      chrome.runtime.sendMessage({
        type: 'BG_SYNC_STATE',
        data: {
          action: 'PAUSE',
          currentTime: video.currentTime,
          paused: true,
          timestamp: Date.now()
        }
      });
    }, 5000);
  });

  video.addEventListener('playing', () => {
    if (bufferingTimer) {
      clearTimeout(bufferingTimer);
      bufferingTimer = null;
    }

    // 房主自卡頓恢復：主動發送 PLAY 恢復全房 (若期間被手動暫停，hostStallActive 已被重置，不會發送)
    if (hostStallActive) {
      hostStallActive = false;
      if (
        roomState.isInRoom &&
        roomState.isHost &&
        isCurrentActiveVideoTab() &&
        !video.paused &&
        !isYouTubeAdPlaying()
      ) {
        console.log('[Syncine] 房主卡頓恢復，發送 PLAY 恢復全房');
        chrome.runtime.sendMessage({
          type: 'BG_SYNC_STATE',
          data: {
            action: 'PLAY',
            currentTime: video.currentTime,
            paused: false,
            timestamp: Date.now()
          }
        });
      }
    }
  });

  video.addEventListener('canplay', () => {
    // 僅取消尚在倒數中的卡頓判定；已確認的卡頓由 playing 事件負責恢復
    if (bufferingTimer) {
      clearTimeout(bufferingTimer);
      bufferingTimer = null;
    }
  });
}

// ----------------------------------------------------
// 7. MutationObserver 與初始化
// ----------------------------------------------------
let domObserver: MutationObserver | null = null;
let lastObservedUrl = window.location.href;

function initObserver() {
  const v = findVideoElement();
  if (v) {
    attachVideoListeners(v);
  }

  if (!domObserver && document.body) {
    domObserver = new MutationObserver(() => {
      // Niconico / SPA 網址變更偵測
      if (window.location.href !== lastObservedUrl) {
        lastObservedUrl = window.location.href;
        if (window.location.hostname.includes('nicovideo.jp')) {
          console.log('[Syncine] 偵測到 Niconico SPA 網頁導航切換');
          setTimeout(() => {
            const nextVideo = findVideoElement();
            if (nextVideo) attachVideoListeners(nextVideo);
            if (roomState.isInRoom && roomState.isHost) {
              if (isCurrentActiveVideoTab()) {
                startHeartbeat();
              } else {
                stopHeartbeat();
              }
            }
          }, 800);
        }
      }

      const video = findVideoElement();
      if (video && video !== targetVideo) {
        attachVideoListeners(video);
      }
    });

    domObserver.observe(document.body, { childList: true, subtree: true });
  }
}

// Anime1.me 合集頁與 Niconico 多重 Video 動態切換：於捕獲階段優先鎖定使用者點擊播放之 Video
if (
  window.location.hostname.includes('anime1.me') ||
  window.location.hostname.includes('nicovideo.jp')
) {
  document.addEventListener(
    'play',
    (e) => {
      const el = e.target;
      if (el instanceof HTMLVideoElement) {
        // 排除 Niconico 廣告容器內的 video
        if (
          window.location.hostname.includes('nicovideo.jp') &&
          el.closest('[class*="VideoAd"], #nv_watch_VideoAdContainer, [class*="AdContainer"]')
        ) {
          return;
        }
        if (el !== targetVideo) {
          attachVideoListeners(el);
        }
      }
    },
    true
  );
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
      hostStallActive = false;
      if (bufferingTimer) {
        clearTimeout(bufferingTimer);
        bufferingTimer = null;
      }
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
    const alertMsg = getStandaloneText('ERR_UNAUTHORIZED_URL');
    alert(`${alertMsg} (${payload.url})`);
  }
});

initObserver();
