import { SyncData, getVideoIdentifier, getCanonicalVideoUrl, isSameVideoOrWebsite } from '../types/protocol';
import { getStandaloneText } from '../locales/standalone';

console.log('[Syncine ContentScript] 腳本已載入 (Frame:', window.self === window.top ? 'Main Window' : 'Iframe', ')');

// ----------------------------------------------------
// 1. MV3 長連接 Port 保活與 bfcache 生命週期管理
// ----------------------------------------------------
let keepAlivePort: chrome.runtime.Port | null = null;

function setupKeepAlivePort() {
  if (window.self !== window.top) return;
  try {
    if (keepAlivePort) {
      try { keepAlivePort.disconnect(); } catch (_) {}
      keepAlivePort = null;
    }
    keepAlivePort = chrome.runtime.connect({ name: 'syncine-keepalive' });
    keepAlivePort.onDisconnect.addListener((port) => {
      // 關鍵：存取 lastError 與 port.error，標記異常已被捕捉，
      // 防止 Chrome 拋出「Unchecked runtime.lastError: The page keeping the extension port is moved into back/forward cache...」
      const lastError = chrome.runtime.lastError;
      const portError = (port as any)?.error;
      if (lastError || portError) {
        console.log('[Syncine ContentScript] Keep-Alive Port 正常釋放或因 bfcache 凍結切斷:', lastError?.message || portError?.message);
      }
      keepAlivePort = null;
    });
  } catch (e) {
    console.warn('[Syncine] 建立 Keep-Alive Port 失敗:', e);
  }
}

// 監聽現代瀏覽器快退快進快取 (Back/Forward Cache, bfcache) 生命週期
window.addEventListener('pagehide', (event) => {
  // 當分頁即將進入 bfcache 時主動斷開 Port，防止被 Chrome 強制殺死並報錯
  if (event.persisted && keepAlivePort) {
    try { keepAlivePort.disconnect(); } catch (_) {}
    keepAlivePort = null;
  }
});

window.addEventListener('pageshow', (event) => {
  // 當分頁從 bfcache 被喚醒時，重新建立 Port 連線並恢復房間狀態
  if (event.persisted) {
    setupKeepAlivePort();
    queryInitialRoomState();
  }
});

// 初始化啟動保活 Port
setupKeepAlivePort();

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
let roomPlaybackState: 'PLAYING' | 'PAUSED' | 'IDLE' = 'IDLE';

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

  return isSameVideoOrWebsite(window.location.href, roomState.currentUrl);
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

/**
 * Netflix 專屬：主觀看播放器 video 選取機制
 * 優先鎖定 .watch-video 或主播放器容器內的 video，並防範 /browse 預覽預告片干擾
 */
function findNetflixVideo(): HTMLVideoElement | null {
  const watchPlayer = document.querySelector(
    '.watch-video video, .nf-player-container video, [data-uia="watch-video"] video'
  ) as HTMLVideoElement | null;
  if (watchPlayer) return watchPlayer;

  if (window.location.pathname.includes('/watch/')) {
    const videos = Array.from(document.querySelectorAll('video')) as HTMLVideoElement[];
    const visible = videos.find((v) => v.offsetWidth > 0 && v.offsetHeight > 0);
    if (visible) return visible;
    return videos[0] || null;
  }
  return null;
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
  } else if (host.includes('netflix.com')) {
    return findNetflixVideo();
  } else if (host.includes('vimeo.com')) {
    return document.querySelector('.vp-video-wrapper video, .player-container video, video') as HTMLVideoElement;
  } else if (host.includes('gamer.com.tw')) {
    return document.querySelector('#ani_video_html5_api, video.vjs-tech, #ani_video video, video') as HTMLVideoElement;
  } else if (host.includes('twitch.tv')) {
    return document.querySelector('div[data-a-target="video-player"] video, .video-player__container video, video') as HTMLVideoElement;
  } else if (host.includes('disneyplus.com')) {
    return document.querySelector('video.btm-media-client, #video-player video, .hive-media-client-video, video') as HTMLVideoElement;
  } else if (host.includes('primevideo.com') || host.includes('amazon.com')) {
    return document.querySelector('.webPlayerElement video, .rendererContainer video, [data-testid="web-player"] video, video') as HTMLVideoElement;
  } else if (host.includes('myvideo.net.tw')) {
    return document.querySelector('#video_player_html5_api, #playerContainer video, .vjs-tech, video') as HTMLVideoElement;
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

  // 判定真實可見之 YouTube 廣告元素：
  // 必須同時存在 ad-showing / ad-interrupting 且覆蓋層中有實際可見的廣告文本、倒數或跳過按鈕
  // 杜絕廣告攔截器 (如 uBlock Origin / Brave Shields) 攔截廣告後遺留之 DOM class 誤判偽陽性
  const player = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
  const isAdClassPresent = Boolean(
    player && (player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting'))
  );

  if (!isAdClassPresent) return false;

  // 尋找真實可見的廣告文字或跳過按鈕覆蓋層 (寬高皆大於 0 且未被 display: none / visibility: hidden 隱藏)
  const adElement = document.querySelector(
    '.ytp-ad-text, .ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button, .ytp-ad-preview-container, .ytp-ad-duration-remaining'
  ) as HTMLElement | null;

  if (adElement && adElement.offsetWidth > 0 && adElement.offsetHeight > 0) {
    try {
      const style = window.getComputedStyle(adElement);
      if (style.display !== 'none' && style.visibility !== 'hidden') {
        return true;
      }
    } catch (_) {}
  }

  return false;
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

/**
 * 瀏覽器自動播放政策 (Autoplay Policy) 彈性降級播放輔助函式
 * 若瀏覽器因「使用者尚未與本頁面互動」攔截 video.play()，自動轉為靜音播放以確保同步，
 * 並在使用者首次點擊或按鍵時自動解除靜音。
 */
function safePlayVideo(video: HTMLVideoElement) {
  if (!video.paused) return;
  video.play().catch((err) => {
    console.warn('[Syncine] video.play() 攔截 (受瀏覽器 Autoplay 政策限制):', err);
    video.muted = true;
    video.play().then(() => {
      console.log('[Syncine] 由於瀏覽器 Autoplay 限制，已先自動靜音並開始播放，點擊頁面任意處即可開啟聲音');
      const unmute = () => {
        video.muted = false;
        window.removeEventListener('click', unmute);
        window.removeEventListener('keydown', unmute);
      };
      window.addEventListener('click', unmute, { once: true });
      window.addEventListener('keydown', unmute, { once: true });
    }).catch((e) => {
      console.error('[Syncine] 靜音播放仍然被攔截:', e);
    });
  });
}

/**
 * 跨平台安全播放控制適配器 (Cross-Platform Playback Adapter)
 * 在 Netflix 平台上，直接修改 HTML5 video.currentTime 會被 Cadmium 播放器攔截並拋出崩潰異常
 * 透過自訂事件轉發給 MAIN 世界的 netflix_bridge.js 調用內部 VideoPlayer API
 */
function applySeek(video: HTMLVideoElement, targetTime: number) {
  if (window.location.hostname.includes('netflix.com')) {
    window.dispatchEvent(
      new CustomEvent('SYNCINE_NETFLIX_CMD', {
        detail: { action: 'SEEK', currentTime: targetTime }
      })
    );
  } else {
    video.currentTime = targetTime;
  }
}

function applyPlay(video: HTMLVideoElement) {
  if (window.location.hostname.includes('netflix.com')) {
    window.dispatchEvent(
      new CustomEvent('SYNCINE_NETFLIX_CMD', {
        detail: { action: 'PLAY' }
      })
    );
  }
  safePlayVideo(video);
}

function applyPause(video: HTMLVideoElement) {
  if (window.location.hostname.includes('netflix.com')) {
    window.dispatchEvent(
      new CustomEvent('SYNCINE_NETFLIX_CMD', {
        detail: { action: 'PAUSE' }
      })
    );
  }
  video.pause();
}

// ----------------------------------------------------
// 5. 5 秒容差與單程延遲補償演算法 (規格 4.2)
// ----------------------------------------------------
function applySyncState(data: SyncData) {
  if (!targetVideo) {
    const v = findVideoElement();
    if (v) attachVideoListeners(v);
  }
  if (!targetVideo) {
    console.warn('[Syncine] applySyncState 略過: 未能鎖定 Target Video DOM');
    return;
  }
  if (!roomState.isInRoom) {
    console.warn('[Syncine] applySyncState 略過: 本分頁尚未處於房間中 (isInRoom=false)');
    return;
  }
  // 觀眾端防護：若自身尚未處於目標影片，不套用時間軸校準，避免分頁未跳轉前時間跳動
  if (!isCurrentActiveVideoTab()) {
    console.log(`[Syncine] 當前分頁影片與房間目標不符，略過時間軸同步 (myId: ${getVideoIdentifier(window.location.href)}, roomId: ${getVideoIdentifier(roomState.currentUrl)})`);
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
    roomPlaybackState = 'PLAYING';
    console.log(`[Syncine ContentScript] 執行同步播放 (PLAY) -> 目標時間: ${targetServerTime.toFixed(2)}s (本地: ${localTime.toFixed(2)}s, 差: ${timeDiff.toFixed(2)}s)`);
    // 只有在時間差大於 0.5 秒或處於不同播放狀態時校準進度，避免極小誤差造成重複 Seek
    if (timeDiff > 0.5) {
      applySeek(targetVideo, targetServerTime);
    }
    lastSyncedTime = targetServerTime;
    applyPlay(targetVideo);
  } else if (action === 'PAUSE') {
    roomPlaybackState = 'PAUSED';
    console.log(`[Syncine ContentScript] 執行同步暫停 (PAUSE) -> 目標時間: ${targetServerTime.toFixed(2)}s (本地: ${localTime.toFixed(2)}s)`);
    // 暫停時若時間差距小於 0.5 秒直接 pause，不強制 seek，消除播放器暫停時的畫面閃爍與誤判卡頓
    if (timeDiff > 0.5) {
      applySeek(targetVideo, targetServerTime);
    }
    lastSyncedTime = targetServerTime;
    applyPause(targetVideo);
  } else if (action === 'SEEK') {
    console.log(`[Syncine ContentScript] 執行同步進度跳轉 (SEEK) -> 目標時間: ${targetServerTime.toFixed(2)}s, 發送端狀態: ${serverPaused ? '暫停' : '播放'}`);
    applySeek(targetVideo, targetServerTime);
    lastSyncedTime = targetServerTime;

    // 同步發送端的播放狀態：若發送端在播放，全員跟隨播放；若發送端在暫停，全員跟隨暫停
    if (serverPaused === false) {
      roomPlaybackState = 'PLAYING';
      applyPlay(targetVideo);
    } else if (serverPaused === true) {
      roomPlaybackState = 'PAUSED';
      applyPause(targetVideo);
    }
  } else if (action === 'HEARTBEAT') {
    // 1. 雙向校準播放狀態
    if (typeof serverPaused === 'boolean') {
      roomPlaybackState = serverPaused ? 'PAUSED' : 'PLAYING';
      if (serverPaused && !targetVideo.paused) {
        console.log('[Syncine Heartbeat] 主機目前為暫停，觀眾對齊暫停');
        applyPause(targetVideo);
      } else if (!serverPaused && targetVideo.paused) {
        console.log('[Syncine Heartbeat] 主機目前為播放，觀眾對齊播放');
        applyPlay(targetVideo);
      }
    }

    // 2. 被動心跳 5 秒容差檢查 (在暫停或非必要狀態下不隨意位移)
    if (timeDiff > 5) {
      console.log(`[Syncine Heartbeat] 時間差為 ${timeDiff.toFixed(2)} 秒 (>5秒)，強制同步位移至: ${targetServerTime}`);
      applySeek(targetVideo, targetServerTime);
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
      // 僅在房間明確處於 PAUSED 狀態時，觀眾私自點擊播放才回滾至暫停
      // 若房間本就處於 PLAYING，為正常播放對齊，切勿回滾形成死鎖
      if (roomPlaybackState === 'PAUSED') {
        console.warn('[Syncine Intercept] 觀眾無權限發起播放，回滾狀態至暫停');
        markProgrammatic(400);
        applyPause(video);
      }
      return;
    }

    console.log(`[Syncine Host] 捕捉到本機播放操作 (play)，發送 BG_SYNC_STATE: PLAY (currentTime: ${video.currentTime.toFixed(2)}s)`);
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
      // 僅在房間明確處於 PLAYING 狀態時，觀眾私自點擊暫停才回滾至播放
      // 若房間本就處於 PAUSED 或初始化階段，切勿強制喚醒播放！
      if (roomPlaybackState === 'PLAYING') {
        console.warn('[Syncine Intercept] 觀眾無權限發起暫停，回滾狀態至播放');
        markProgrammatic(400);
        applyPlay(video);
      }
      return;
    }

    console.log(`[Syncine Host] 捕捉到本機暫停操作 (pause)，發送 BG_SYNC_STATE: PAUSE (currentTime: ${video.currentTime.toFixed(2)}s)`);
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

    console.log(`[Syncine Host] 捕捉到本機進度跳轉 (seek)，發送 BG_SYNC_STATE: SEEK -> ${targetVideo.currentTime.toFixed(2)}s (paused: ${isPaused})`);
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
      if (lastSyncedTime > 0 && Math.abs(video.currentTime - lastSyncedTime) > 1.5) {
        console.warn(`[Syncine Intercept] 觀眾無權限拖曳進度條，強制回滾至同步時間: ${lastSyncedTime.toFixed(2)}s`);
        markProgrammatic(400);
        if (window.location.hostname.includes('netflix.com')) {
          applySeek(video, lastSyncedTime);
        } else {
          video.currentTime = lastSyncedTime;
        }
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

  // 監聽影片播放結束 (支援自動連播下一集/換集)
  video.addEventListener('ended', () => {
    if (roomState.isInRoom && roomState.isHost && isPlaylistOrEpisodeSupported()) {
      markPlaylistActionTriggered('Video Ended (Auto-Play Next Trigger)');
    }
  });
}

// ----------------------------------------------------
// 6.5 清單與上下集 (Next/Prev Episode) 自動跳轉同步管理
// ----------------------------------------------------
let lastPlaylistActionTime = 0;
let lastAutoRedirectedUrl = '';
let playlistCheckDebounceTimer: any = null;

/**
 * 檢查當前畫面或網站是否具備「清單、選集、上下集」功能支援
 */
export function isPlaylistOrEpisodeSupported(): boolean {
  try {
    const host = window.location.hostname.toLowerCase();
    const path = window.location.pathname.toLowerCase();
    const search = window.location.search;

    // 1. YouTube 播放清單與下一部支援
    if (host.includes('youtube.com')) {
      if (search.includes('list=')) return true;
      if (document.querySelector('ytd-playlist-panel-renderer, #playlist, .ytd-playlist-panel-renderer, #playlist-items')) {
        return true;
      }
      const nextBtn = document.querySelector('.ytp-next-button') as HTMLElement | null;
      if (nextBtn && nextBtn.style.display !== 'none' && !nextBtn.getAttribute('aria-disabled')) {
        return true;
      }
      return false;
    }

    // 2. Bilibili 番劇選集與分 P 支援
    if (host.includes('bilibili.com')) {
      if (path.includes('/bangumi/play/')) return true;
      if (search.includes('p=')) return true;
      if (document.querySelector('#multi_page, .cur-list, .ep-list-wrapper, .section-ep-wrapper, .bpx-player-ctrl-btn-next, .squirtle-video-next')) {
        return true;
      }
      return false;
    }

    // 3. Netflix 影集選集與下一集支援
    if (host.includes('netflix.com')) {
      if (!path.includes('/watch/')) return false;
      if (document.querySelector('[data-uia="control-episodes"], [data-uia="control-next"], [data-uia*="next-episode"], .button-nfVideos-next, [data-uia*="next-episode-seamless"], [data-uia*="postplay"]')) {
        return true;
      }
      return false;
    }

    // 4. 巴哈姆特動畫瘋選集與下一集支援
    if (host.includes('gamer.com.tw')) {
      if (document.querySelector('section.season, .ani-tabs, .season ul li, .ani-episode__item, .ani-control__btn--next')) {
        return true;
      }
      return false;
    }

    // 5. Vimeo 播放清單與展示集支援
    if (host.includes('vimeo.com')) {
      if (path.includes('/showcase/') || path.includes('/channels/') || path.includes('/groups/')) return true;
      if (document.querySelector('.playlist-container, .showcase-item, .vp-teleport-tray, [aria-label*="Next video"]')) {
        return true;
      }
      return false;
    }

    // 6. Twitch VOD 清單與合輯支援
    if (host.includes('twitch.tv')) {
      if (search.includes('collection=')) return true;
      if (document.querySelector('[data-a-target="player-next-video-button"], [data-a-target="collection-item"]')) {
        return true;
      }
      return false;
    }

    // 7. Disney+ 影集選集與下一集支援
    if (host.includes('disneyplus.com')) {
      if (path.includes('/series/')) return true;
      if (document.querySelector('[data-testid*="next-episode"], [data-testid*="up-next"], [aria-label*="Next Episode"], [aria-label*="下一集"], .up-next-card, [data-testid="episode-card"]')) {
        return true;
      }
      return false;
    }

    // 8. Prime Video 影集選集與下一集支援
    if (host.includes('primevideo.com') || host.includes('amazon.com')) {
      if (document.querySelector('[data-testid="next-episode-button"], .next-episode, [aria-label*="Next Episode"], [aria-label*="下一集"], .dv-player-next-episode, .nextUpCard')) {
        return true;
      }
      return false;
    }

    // 9. MyVideo 劇集選集支援
    if (host.includes('myvideo.net.tw')) {
      if (path.includes('/details/3/')) return true;
      if (document.querySelector('.episode-item, .episode_list, .drama-episode, .season-list, [data-testid="next-episode"]')) {
        return true;
      }
      return false;
    }

    return false;
  } catch (e) {
    return false;
  }
}

/**
 * 標記使用者已觸發換集或切換清單動作 (點擊或影片播放結束)
 */
export function markPlaylistActionTriggered(source: string) {
  lastPlaylistActionTime = Date.now();
  console.log(`[Syncine Playlist] 捕捉到換集/切片觸發信號 (${source})`);
}

/**
 * 監聽畫面上的上下集按鈕與清單項目點擊
 */
function initPlaylistClickListeners() {
  document.addEventListener(
    'click',
    (e) => {
      if (!roomState.isInRoom || !roomState.isHost) return;

      const target = e.target as HTMLElement | null;
      if (!target) return;

      // YouTube: 下一部/上一部/清單條目/推薦下一部
      if (
        target.closest(
          '.ytp-next-button, .ytp-prev-button, ytd-playlist-panel-video-renderer, #playlist-items ytd-playlist-panel-video-renderer, .ytp-upnext'
        )
      ) {
        markPlaylistActionTriggered('YouTube Next/Prev/Playlist Click');
        return;
      }

      // Bilibili: 下一集/上一集/選集條目/分P條目
      if (
        target.closest(
          '.bpx-player-ctrl-btn-next, .bpx-player-ctrl-btn-prev, .squirtle-video-next, .ep-item, .section-ep-wrapper li, #multi_page .cur-list li, .part-item'
        )
      ) {
        markPlaylistActionTriggered('Bilibili Episode/Part Click');
        return;
      }

      // Netflix: 下一集/選集抽屜按鈕/片尾連播按鈕
      if (
        target.closest(
          '[data-uia="control-next"], [data-uia*="next-episode"], [data-uia*="postplay"], [data-uia="control-episodes"], .button-nfVideos-next, [aria-label="Next Episode"], [aria-label="下一集"], [data-uia="next-episode-seamless-button"]'
        )
      ) {
        markPlaylistActionTriggered('Netflix Next Episode Click');
        return;
      }

      // 巴哈姆特動畫瘋: 集數點擊 / 下一集點擊
      if (
        target.closest(
          'section.season a, .ani-tabs a, .season ul li a, .ani-episode__item a, .ani-control__btn--next'
        )
      ) {
        markPlaylistActionTriggered('Bahamut Episode/Next Click');
        return;
      }

      // Vimeo: 下一部 / 展示集點擊
      if (
        target.closest(
          '[aria-label*="Next video"], .vp-teleport-tray a, .showcase-item a, .vp-video-tray a'
        )
      ) {
        markPlaylistActionTriggered('Vimeo Next/Playlist Click');
        return;
      }

      // Twitch: 下一部影片 / 合輯項目點擊
      if (
        target.closest(
          '[data-a-target="player-next-video-button"], [data-a-target="collection-item"]'
        )
      ) {
        markPlaylistActionTriggered('Twitch Next/Collection Click');
        return;
      }

      // Disney+: 下一集 / 推薦卡片點擊
      if (
        target.closest(
          '[data-testid*="next-episode"], [data-testid*="up-next"], .up-next-card, [aria-label*="Next Episode"], [aria-label*="下一集"]'
        )
      ) {
        markPlaylistActionTriggered('Disney+ Next Episode Click');
        return;
      }

      // Prime Video: 下一集點擊
      if (
        target.closest(
          '[data-testid="next-episode-button"], .next-episode, [aria-label*="Next Episode"], [aria-label*="下一集"], .nextUpCard'
        )
      ) {
        markPlaylistActionTriggered('Prime Video Next Episode Click');
        return;
      }

      // MyVideo: 劇集列表點擊
      if (
        target.closest(
          '.episode-item, .drama-episode, .season-list a, .episode_list a'
        )
      ) {
        markPlaylistActionTriggered('MyVideo Episode Click');
        return;
      }
    },
    true
  );
}

/**
 * 檢查是否需要廣播清單或上下集跳轉
 */
export function checkAndBroadcastPlaylistNavigation(source: string) {
  if (!roomState.isInRoom || !roomState.isHost) return;

  const currentHref = window.location.href;
  const currentVideoId = getVideoIdentifier(currentHref);
  const roomVideoId = getVideoIdentifier(roomState.currentUrl);

  // 1. 若影片 ID 未改變，不觸發房間跳轉
  if (!currentVideoId || currentVideoId === roomVideoId || isSameVideoOrWebsite(currentHref, roomState.currentUrl)) return;

  // 2. 條件檢查：「只有在畫面或網站有支援這個功能時才能生效，或是有觸發這個功能時才生效」
  const hasSupport = isPlaylistOrEpisodeSupported();
  const isRecentAction = Date.now() - lastPlaylistActionTime < 15000; // 15秒內曾觸發換集或影片播畢

  if (!hasSupport && !isRecentAction) {
    console.log(`[Syncine Playlist] 忽略跳轉 (${source})：當前頁面不具備清單/選集支援且未偵測到換集觸發`);
    return;
  }

  // 3. 取得純淨標準網址
  const cleanTarget = getCanonicalVideoUrl(currentHref);
  if (!cleanTarget) return;

  // 避免重複廣播相同目標
  if (cleanTarget === lastAutoRedirectedUrl) return;
  lastAutoRedirectedUrl = cleanTarget;

  console.log(`[Syncine Playlist] 🎬 房主觸發清單/上下集跳轉 (${source}): ${cleanTarget}，即時廣播全房同步！`);

  chrome.runtime
    .sendMessage({
      type: 'BG_REDIRECT_ROOM',
      targetUrl: cleanTarget
    })
    .then((res) => {
      if (res?.success) {
        roomState.currentUrl = cleanTarget;
        console.log(`[Syncine Playlist] ✅ 全房換集跳轉廣播成功: ${cleanTarget}`);
      }
    })
    .catch((err) => {
      console.warn('[Syncine Playlist] 跳轉廣播失敗:', err);
    });
}

function handleUrlOrVideoChange(triggerSource: string) {
  if (!roomState.isInRoom || !roomState.isHost) return;

  clearTimeout(playlistCheckDebounceTimer);
  playlistCheckDebounceTimer = setTimeout(() => {
    checkAndBroadcastPlaylistNavigation(triggerSource);
  }, 400);
}

// 監聽 YouTube SPA 導航與標準歷史記錄變更事件
window.addEventListener('yt-navigate-finish', () => {
  handleUrlOrVideoChange('YouTube yt-navigate-finish');
});
window.addEventListener('popstate', () => {
  handleUrlOrVideoChange('popstate');
});
window.addEventListener('hashchange', () => {
  handleUrlOrVideoChange('hashchange');
});

// 初始化清單與上下集點擊監聽
initPlaylistClickListeners();

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
      // 跨平台 SPA 網址變更偵測與上下集清單跳轉處理
      if (window.location.href !== lastObservedUrl) {
        lastObservedUrl = window.location.href;
        handleUrlOrVideoChange('MutationObserver URL Change');

        const h = window.location.hostname;
        if (h.includes('nicovideo.jp') || h.includes('netflix.com') || h.includes('bilibili.com') || h.includes('youtube.com') || h.includes('vimeo.com') || h.includes('gamer.com.tw') || h.includes('twitch.tv') || h.includes('disneyplus.com') || h.includes('primevideo.com') || h.includes('amazon.com') || h.includes('myvideo.net.tw')) {
          console.log('[Syncine] 偵測到 SPA 網頁導航切換');
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
  window.location.hostname.includes('nicovideo.jp') ||
  window.location.hostname.includes('netflix.com')
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
        if (
          window.location.hostname.includes('netflix.com') &&
          !window.location.pathname.includes('/watch/')
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

// ----------------------------------------------------
// 7. 房間狀態向後台同步與查詢
// ----------------------------------------------------
function queryInitialRoomState() {
  if (window.self !== window.top) return;
  chrome.runtime.sendMessage({ type: 'GET_ROOM_STATE' }, (res) => {
    if (chrome.runtime.lastError) {
      console.warn('[Syncine ContentScript] queryInitialRoomState 異常:', chrome.runtime.lastError.message);
      return;
    }
    console.log('[Syncine ContentScript] queryInitialRoomState 回傳房間狀態:', res?.roomState);
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
}

// 首次啟動向 Background 獲取最新狀態
queryInitialRoomState();

// 監聽來自 Background 的動態訊息
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  const { type, payload } = request;

  if (type === 'CS_SYNC_RECEIVED') {
    console.log('[Syncine ContentScript] 收到遠端同步指令 (CS_SYNC_RECEIVED):', payload?.data);
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
      roomPlaybackState = 'IDLE';
      lastSyncedTime = 0;
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
          paused: targetVideo.paused,
          timestamp: Date.now()
        }
      });
    }
  } else if (type === 'CS_PERMISSION_UPDATED') {
    roomState.allowGuestControl = payload.allowGuestControl;
    console.log('[Syncine] 觀眾權限狀態更新:', roomState.allowGuestControl);
  } else if (type === 'SHOW_SECURITY_ALERT') {
    const alertMsg = getStandaloneText('ERR_UNAUTHORIZED_URL');
    const ver = payload?.version ? ` [Syncine v${payload.version}]` : '';
    alert(`${alertMsg}${ver}\n(${payload?.url || ''})`);
  }

  // 保持訊息通道暢通並確認已接收，避免 Background catch 到未捕獲之連線異常
  sendResponse?.({ received: true });
  return true;
});

initObserver();
