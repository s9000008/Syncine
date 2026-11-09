import { SyncData, getVideoIdentifier, getCanonicalVideoUrl, isSameVideoOrWebsite } from '../types/protocol';
import { isPlatformActive, isPlatformDomainActive, isPlatformDomainPermitted, isPlatformPermitted, isUniversalSupportedUrl } from '../platforms';
import { getStandaloneText } from '../locales/standalone';

// 頂層視窗防禦守衛 (防止注入廣告/沙盒 iframe；僅特例放行 Crunchyroll 官方 Vilos 播放器專用子框架)
const isTopFrame = window.self === window.top;
const isAllowedPlayerFrame = window.location.hostname === 'static.crunchyroll.com';
const isEligibleFrame = isTopFrame || isAllowedPlayerFrame;
let parentTabUrl = isAllowedPlayerFrame ? document.referrer || '' : '';

function getEffectivePageUrl(): string {
  return isAllowedPlayerFrame && parentTabUrl ? parentTabUrl : window.location.href;
}

// 局部開放守衛：依據已開放網域判定 (支援從平台首頁透過 SPA 導航進入播放頁；未解鎖候選網站維持 100% 靜默休眠)
let isSiteActive =
  isAllowedPlayerFrame ||
  isPlatformDomainActive(window.location.href) ||
  isPlatformActive(window.location.href);

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
  // 當分頁從 bfcache 被喚醒時，僅在已啟用平台重新建立 Port 連線並恢復房間狀態
  if (event.persisted && isEligibleFrame && isSiteActive) {
    if (isTopFrame) setupKeepAlivePort();
    queryInitialRoomState();
  }
});

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
let lastInitSyncKey = '';
let syncWatchdogTimer: ReturnType<typeof setInterval> | null = null;

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

  return isSameVideoOrWebsite(getEffectivePageUrl(), roomState.currentUrl);
}

/**
 * 觀眾端主動初始拉取同步：當觀眾分頁載入完成且綁定 <video> 後，向房主請求一次最新時間軸與播放狀態
 * 解決觀眾跳轉載入期間錯過首次同步廣播，或房主處於暫停狀態時無後續事件之問題
 */
function requestInitialSyncIfNeeded() {
  if (!roomState.isInRoom || roomState.isHost || !targetVideo) return;
  if (!isCurrentActiveVideoTab()) return;

  const effectiveUrl = getEffectivePageUrl();
  const key = `${roomState.currentUrl || ''}::${getVideoIdentifier(effectiveUrl) || effectiveUrl}`;
  if (!key || key === lastInitSyncKey) return;
  lastInitSyncKey = key;

  const sendInitReq = () => {
    if (!roomState.isInRoom || roomState.isHost) return;
    chrome.runtime.sendMessage({ type: 'BG_REQUEST_INIT_SYNC' }).catch(() => {});
  };

  sendInitReq();
  if (targetVideo.readyState < 1) {
    targetVideo.addEventListener('loadedmetadata', () => sendInitReq(), { once: true });
  }
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
    targetVideo.isConnected &&
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

/**
 * 判斷是否為串流平台前置/插播廣告之 <video> 元素 (如 Google IMA / Niconico / YouTube Ad)
 */
function isAdVideoElement(v: HTMLVideoElement): boolean {
  try {
    return Boolean(
      v.closest(
        '.ima-ad-container, [id*="ad-container" i], [class*="ad-container" i], [class*="VideoAd"], #nv_watch_VideoAdContainer, .ytp-ad-player-overlay'
      )
    );
  } catch (_) {
    return false;
  }
}

/**
 * 支援穿透開放式 Shadow DOM (Open ShadowRoot) 之深度 <video> 搜尋器
 * 解決 Apple TV+ (<amp-video-player>)、Disney+ (<disney-web-player>/<btm-media-player>) 與 Max 等採用 Web Components 封裝播放器之問題
 */
function queryAllVideosDeep(
  root: Document | ShadowRoot | Element = document,
  depth = 0
): HTMLVideoElement[] {
  const results: HTMLVideoElement[] = [];
  try {
    const direct = root.querySelectorAll('video');
    for (let i = 0; i < direct.length; i++) {
      results.push(direct[i] as HTMLVideoElement);
    }
    if (depth >= 6) return results;

    const allEls = root.querySelectorAll('*');
    for (let i = 0; i < allEls.length; i++) {
      const sr = (allEls[i] as HTMLElement).shadowRoot;
      if (sr) {
        const nested = queryAllVideosDeep(sr, depth + 1);
        for (let j = 0; j < nested.length; j++) {
          results.push(nested[j]);
        }
      }
    }
  } catch (_) {}
  return results;
}

function pickBestNonAdVideo(candidates: HTMLVideoElement[]): HTMLVideoElement | null {
  const clean = candidates.filter((v) => v && !isAdVideoElement(v));
  if (clean.length === 0) return null;
  if (clean.length === 1) return clean[0];

  // 優先挑選可視且已載入/面積最大之主播放器 video
  const playingVisible = clean.find(
    (v) => !v.paused && v.offsetWidth > 0 && v.offsetHeight > 0
  );
  if (playingVisible) return playingVisible;

  let bestVideo: HTMLVideoElement | null = null;
  let maxArea = 0;
  for (const v of clean) {
    try {
      const rect = v.getBoundingClientRect();
      const style = window.getComputedStyle(v);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;
      const area = rect.width * rect.height;
      if (area > maxArea && (v.duration > 0 || v.src || v.currentSrc || v.readyState > 0 || area > 20000)) {
        maxArea = area;
        bestVideo = v;
      }
    } catch (_) {}
  }
  return bestVideo || clean[0];
}

/**
 * 標準影片的通用方案 (Generic HTML5 Video Fallback)
 * 針對尚未正式支援或採用 Shadow DOM 動態封裝的影音網站，
 * 智能探測頁面及開放式 ShadowRoot 中的標準 HTML5 <video> 元素（過濾廣告容器與微縮預覽視窗）
 */
function findGenericVideoElement(): HTMLVideoElement | null {
  const videos = queryAllVideosDeep(document);
  if (videos.length === 0) return null;
  return pickBestNonAdVideo(videos);
}

function findVideoElement(): HTMLVideoElement | null {
  const host = window.location.hostname;

  if (host.includes('youtube.com')) {
    const ytVideos = Array.from(document.querySelectorAll('video.html5-main-video')) as HTMLVideoElement[];
    const visibleYt = ytVideos.find((v) => v.offsetWidth > 0 && v.offsetHeight > 0);
    return visibleYt || (document.querySelector('video.html5-main-video') as HTMLVideoElement) || findGenericVideoElement();
  } else if (host.includes('bilibili.com')) {
    return (
      (document.querySelector('.bpx-player-video-wrap video') as HTMLVideoElement) ||
      (document.querySelector('.bilibili-player-video video') as HTMLVideoElement) ||
      findGenericVideoElement()
    );
  } else if (host.includes('nicovideo.jp')) {
    return findNiconicoVideo();
  } else if (host.includes('anime1.me')) {
    return findAnime1Video();
  } else if (host.includes('netflix.com')) {
    return findNetflixVideo();
  } else if (host.includes('vimeo.com')) {
    return (
      pickBestNonAdVideo(
        Array.from(document.querySelectorAll('.vp-video-wrapper video, .vp-video video, .player-container video')) as HTMLVideoElement[]
      ) || findGenericVideoElement()
    );
  } else if (host.includes('gamer.com.tw')) {
    return (
      pickBestNonAdVideo(
        Array.from(document.querySelectorAll('#ani_video_html5_api, #ani_video video.vjs-tech, video.vjs-tech')) as HTMLVideoElement[]
      ) || findGenericVideoElement()
    );
  } else if (host.includes('twitch.tv')) {
    return (
      pickBestNonAdVideo(
        Array.from(document.querySelectorAll('div[data-a-target="video-player"] video, .video-player__container video')) as HTMLVideoElement[]
      ) || findGenericVideoElement()
    );
  } else if (host.includes('disneyplus.com')) {
    return (
      pickBestNonAdVideo(
        Array.from(
          document.querySelectorAll(
            'video.btm-media-client, #video-player video, .hive-media-client-video, btm-media-player video, disney-web-player video'
          )
        ) as HTMLVideoElement[]
      ) || findGenericVideoElement()
    );
  } else if (host.includes('primevideo.com') || host.includes('amazon.com')) {
    return (
      pickBestNonAdVideo(
        Array.from(
          document.querySelectorAll(
            '#dv-web-player video, .atvwebplayersdk-video-surface video, .webPlayerSDKContainer video, .webPlayerElement video, .rendererContainer video, [data-testid="web-player"] video'
          )
        ) as HTMLVideoElement[]
      ) || findGenericVideoElement()
    );
  } else if (host.includes('myvideo.net.tw')) {
    return (
      pickBestNonAdVideo(
        Array.from(document.querySelectorAll('#video_player_html5_api, #playerContainer video, video.vjs-tech')) as HTMLVideoElement[]
      ) || findGenericVideoElement()
    );
  } else if (host.includes('linetv.tw')) {
    return (
      pickBestNonAdVideo(
        Array.from(document.querySelectorAll('#line-player video, .player-container video, video.vjs-tech')) as HTMLVideoElement[]
      ) || findGenericVideoElement()
    );
  } else if (host.includes('kktv.me')) {
    return (
      pickBestNonAdVideo(
        Array.from(document.querySelectorAll('.kktv-player video, .bitmovinplayer-container video, #player video')) as HTMLVideoElement[]
      ) || findGenericVideoElement()
    );
  } else if (host.includes('crunchyroll.com')) {
    return (
      pickBestNonAdVideo(
        Array.from(document.querySelectorAll('video#player0, #player0 video, .video-player video, #vilos video')) as HTMLVideoElement[]
      ) || findGenericVideoElement()
    );
  } else if (host.includes('friday.tw')) {
    return (
      pickBestNonAdVideo(
        Array.from(document.querySelectorAll('.player-container video, #player video, video.vjs-tech')) as HTMLVideoElement[]
      ) || findGenericVideoElement()
    );
  } else if (host.includes('max.com') || host.includes('hbomax.com')) {
    return (
      pickBestNonAdVideo(
        Array.from(document.querySelectorAll('[data-testid="playerContainer"] video, [class*="VideoElement"] video')) as HTMLVideoElement[]
      ) || findGenericVideoElement()
    );
  } else if (host.includes('iq.com') || host.includes('iqiyi.com')) {
    return (
      pickBestNonAdVideo(
        Array.from(document.querySelectorAll('#iqpvid video, video[id*="iqp"], .iqp-player video, iq-player video')) as HTMLVideoElement[]
      ) || findGenericVideoElement()
    );
  } else if (host.includes('tv.apple.com')) {
    return (
      pickBestNonAdVideo(
        Array.from(document.querySelectorAll('amp-video-player video, apple-tv-plus-player video')) as HTMLVideoElement[]
      ) || findGenericVideoElement()
    );
  }
  return findGenericVideoElement();
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

// YouTube、Niconico 與 Google IMA (動畫瘋/OTT) 前置廣告偵測
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
  if (host.includes('gamer.com.tw')) {
    const aniRoot = document.getElementById('ani_video');
    if (aniRoot && aniRoot.classList.contains('vjs-ad-playing')) return true;
    const imaAdVideo = document.querySelector('.ima-ad-container video') as HTMLVideoElement | null;
    if (imaAdVideo && !imaAdVideo.paused && imaAdVideo.offsetWidth > 0) return true;
    return false;
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
        playbackRate: targetVideo.playbackRate,
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
    document.documentElement.dataset.syncineNfHandled = '0';
    window.dispatchEvent(
      new CustomEvent('SYNCINE_NETFLIX_CMD', {
        detail: { action: 'PLAY' }
      })
    );
    if (document.documentElement.dataset.syncineNfHandled === '1') {
      // 若瀏覽器 Autoplay 政策阻擋了 Cadmium player.play()，於短暫延遲後降級為靜音自動播放
      setTimeout(() => {
        if (video.paused && roomState.isInRoom && roomPlaybackState === 'PLAYING') {
          safePlayVideo(video);
        }
      }, 250);
      return;
    }
  }
  safePlayVideo(video);
}

function applyPause(video: HTMLVideoElement) {
  if (window.location.hostname.includes('netflix.com')) {
    document.documentElement.dataset.syncineNfHandled = '0';
    window.dispatchEvent(
      new CustomEvent('SYNCINE_NETFLIX_CMD', {
        detail: { action: 'PAUSE' }
      })
    );
    if (document.documentElement.dataset.syncineNfHandled === '1') {
      return;
    }
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

  if (
    typeof data.playbackRate === 'number' &&
    data.playbackRate >= 0.25 &&
    data.playbackRate <= 4 &&
    Math.abs(targetVideo.playbackRate - data.playbackRate) > 0.01
  ) {
    try {
      targetVideo.playbackRate = data.playbackRate;
    } catch (_) {}
  }

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
  requestInitialSyncIfNeeded();
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
        playbackRate: video.playbackRate,
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
        playbackRate: video.playbackRate,
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
        playbackRate: targetVideo.playbackRate,
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
      if (lastSyncedTime >= 0 && Math.abs(video.currentTime - lastSyncedTime) > 1.5) {
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

  // 監聽倍速變更 (支援 0.5x ~ 2x 倍速同步)
  video.addEventListener('ratechange', () => {
    if (!roomState.isInRoom || !isCurrentActiveVideoTab()) return;
    if (isProgrammatic() || isYouTubeAdPlaying()) return;
    if (!roomState.isHost && !roomState.allowGuestControl) return;

    chrome.runtime.sendMessage({
      type: 'BG_SYNC_STATE',
      data: {
        action: video.paused ? 'PAUSE' : 'PLAY',
        currentTime: video.currentTime,
        playbackRate: video.playbackRate,
        paused: video.paused,
        timestamp: Date.now()
      }
    });
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

    // 10. LINE TV 劇集與分集支援
    if (host.includes('linetv.tw')) {
      if (path.includes('/eps/')) return true;
      if (document.querySelector('.eps-item, .ep-btn, [data-testid="next-episode"], .episode_li, .eps_item')) {
        return true;
      }
      return false;
    }

    // 11. KKTV 影集與分集支援
    if (host.includes('kktv.me')) {
      if (document.querySelector('.play-series-item, .next-episode-btn, .series-item, [data-testid*="next-episode"]')) {
        return true;
      }
      return false;
    }

    // 12. Crunchyroll 動畫選集與下一集支援 (含 Vilos 子框架觸發換集)
    if (host.includes('crunchyroll.com')) {
      if (path.includes('/watch/')) return true;
      if (document.querySelector('[data-t="next-episode-btn"], .playable-card, [data-t="episode-card"], .next-episode-btn')) {
        return true;
      }
      return false;
    }

    // 13. 遠傳 friDay 影音劇集選集支援
    if (host.includes('friday.tw')) {
      if (search.includes('episode=')) return true;
      if (document.querySelector('.episode-item, .drama-item, .item-episode, [data-episode]')) {
        return true;
      }
      return false;
    }

    // 14. Max (HBO Max) 影集與下一集支援
    if (host.includes('max.com') || host.includes('hbomax.com')) {
      if (path.includes('/video/watch/') || path.includes('/player/')) return true;
      if (document.querySelector('[data-testid*="next-episode"], [data-testid*="up-next"], [aria-label*="Next Episode"], [aria-label*="下一集"]')) {
        return true;
      }
      return false;
    }

    // 15. 愛奇藝 iQIYI 選集與下一集支援
    if (host.includes('iq.com') || host.includes('iqiyi.com')) {
      if (document.querySelector('.album-item, .episode-item, .iqp-btn-next, [data-player-hook="next-btn"]')) {
        return true;
      }
      return false;
    }

    // 16. Apple TV+ 影集選集與下一集支援 (含 Shadow DOM 內連播切換)
    if (host.includes('tv.apple.com')) {
      if (path.includes('/episode/') || path.includes('umc.cmc.')) return true;
      if (document.querySelector('[data-testid*="next-episode"], .upstream-next-item, [aria-label*="Next Episode"], [aria-label*="下一集"]')) {
        return true;
      }
      return false;
    }

    // 17. Niconico 系列連播與下一部支援
    if (host.includes('nicovideo.jp')) {
      if (search.includes('playlist=')) return true;
      if (document.querySelector('[data-anchor-area="next_video"], [aria-label*="次の動画"], [aria-label*="Next"], [class*="Series"] a, [class*="Playlist"] a')) {
        return true;
      }
      return false;
    }

    // 18. Anime1.me 上下集與分類合集導覽支援
    if (host.includes('anime1.me')) {
      if (search.includes('cat=')) return true;
      if (document.querySelector('.nav-previous a, .nav-next a, a[rel="prev"], a[rel="next"], .cat-links a')) {
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
let playlistClickListenerBound = false;
function initPlaylistClickListeners() {
  if (playlistClickListenerBound) return;
  playlistClickListenerBound = true;
  document.addEventListener(
    'click',
    (e) => {
      if (!isSiteActive || !roomState.isInRoom || !roomState.isHost) return;

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

      // LINE TV: 分集點擊 / 下一集
      if (
        target.closest(
          '.eps-item, .ep-btn, [data-testid="next-episode"], .episode_li, .eps_item'
        )
      ) {
        markPlaylistActionTriggered('LINE TV Episode/Next Click');
        return;
      }

      // KKTV: 選集點擊 / 下一集
      if (
        target.closest(
          '.play-series-item, .next-episode-btn, .series-item, [data-testid*="next-episode"]'
        )
      ) {
        markPlaylistActionTriggered('KKTV Episode/Next Click');
        return;
      }

      // Crunchyroll: 選集卡片 / 下一集
      if (
        target.closest(
          '[data-t="next-episode-btn"], .playable-card, [data-t="episode-card"], .next-episode-btn'
        )
      ) {
        markPlaylistActionTriggered('Crunchyroll Next/Episode Click');
        return;
      }

      // 遠傳 friDay 影音: 分集列表點擊
      if (
        target.closest(
          '.episode-item, .drama-item, .item-episode, [data-episode]'
        )
      ) {
        markPlaylistActionTriggered('friDay Episode Click');
        return;
      }

      // Max (HBO Max): 下一集點擊
      if (
        target.closest(
          '[data-testid*="next-episode"], [data-testid*="up-next"], [aria-label*="Next Episode"], [aria-label*="下一集"]'
        )
      ) {
        markPlaylistActionTriggered('Max Next Episode Click');
        return;
      }

      // 愛奇藝 iQIYI: 選集與下一集點擊
      if (
        target.closest(
          '.album-item, .episode-item, .iqp-btn-next, [data-player-hook="next-btn"]'
        )
      ) {
        markPlaylistActionTriggered('iQIYI Episode/Next Click');
        return;
      }

      // Apple TV+: 下一集點擊
      if (
        target.closest(
          '[data-testid*="next-episode"], .upstream-next-item, [aria-label*="Next Episode"], [aria-label*="下一集"]'
        )
      ) {
        markPlaylistActionTriggered('Apple TV+ Next Episode Click');
        return;
      }

      // Niconico: 下一部 / 系列選集點擊
      if (
        target.closest(
          '[data-anchor-area="next_video"], [data-anchor-area="prev_video"], [aria-label*="次の動画"], [class*="Series"] a, [class*="Playlist"] a'
        )
      ) {
        markPlaylistActionTriggered('Niconico Next/Series Click');
        return;
      }

      // Anime1.me: 上一集 / 下一集 / 全集連結點擊
      if (
        target.closest(
          '.nav-previous a, .nav-next a, a[rel="prev"], a[rel="next"], .cat-links a'
        )
      ) {
        markPlaylistActionTriggered('Anime1 Prev/Next Episode Click');
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
  // 確保目標頁面必須為合法影音播放路徑（排除使用者退回首頁或 /browse 瀏覽頁，杜絕誤發非播放頁跳轉）
  if (!isPlatformPermitted(currentHref)) return;

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
      payload: { targetUrl: cleanTarget }
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
  if (!isSiteActive) return;
  handleUrlOrVideoChange('YouTube yt-navigate-finish');
});
window.addEventListener('popstate', () => {
  if (!isSiteActive) return;
  handleUrlOrVideoChange('popstate');
});
window.addEventListener('hashchange', () => {
  if (!isSiteActive) return;
  handleUrlOrVideoChange('hashchange');
});

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
      if (!isSiteActive) return;
      // 跨平台 SPA 網址變更偵測與上下集清單跳轉處理
      if (window.location.href !== lastObservedUrl) {
        lastObservedUrl = window.location.href;
        handleUrlOrVideoChange('MutationObserver URL Change');

        console.log('[Syncine] 偵測到 SPA 網頁導航切換');
        setTimeout(() => {
          if (!isSiteActive) return;
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
  if (!isTopFrame || !isSiteActive) return;
  console.log('[Syncine] 偵測到 YouTube SPA 網頁導航切換');
  setTimeout(() => {
    if (!isTopFrame || !isSiteActive) return;
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
// 8. 房間狀態向後台同步與查詢
// ----------------------------------------------------
function queryInitialRoomState() {
  if ((window.self !== window.top && !isAllowedPlayerFrame) || !isSiteActive) return;
  chrome.runtime.sendMessage({ type: 'GET_ROOM_STATE' }, (res) => {
    if (chrome.runtime.lastError) {
      console.warn('[Syncine ContentScript] queryInitialRoomState 異常:', chrome.runtime.lastError.message);
      return;
    }
    if (isAllowedPlayerFrame && res?.tabUrl) {
      parentTabUrl = res.tabUrl;
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
        requestInitialSyncIfNeeded();
      }
    } else {
      roomState = { isInRoom: false, isHost: false, allowGuestControl: false };
      lastInitSyncKey = '';
      stopHeartbeat();
    }
  });
}

// 監聽來自 Background / Popup 的動態訊息
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  const { type, payload } = request || {};
  if (isAllowedPlayerFrame && typeof request?.parentTabUrl === 'string' && request.parentTabUrl) {
    parentTabUrl = request.parentTabUrl;
  }

  // 1. activeTab 通用探測與狀態喚醒指令 (即使尚未 active 亦可回應)
  if (type === 'CS_PING') {
    sendResponse({ success: true, isSiteActive, url: window.location.href });
    return true;
  }
  if (type === 'CS_ACTIVATE_UNIVERSAL') {
    isSiteActive = true;
    activateContentScript();
    sendResponse({ success: true, isSiteActive: true });
    return true;
  }

  // 未啟用支援之候選網站僅允許資安攔截警告，其餘指令完全靜默忽略
  if (!isSiteActive && type !== 'SHOW_SECURITY_ALERT') {
    return false;
  }

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
        requestInitialSyncIfNeeded();
      }
    } else {
      roomState = { isInRoom: false, isHost: false, allowGuestControl: false };
      roomPlaybackState = 'IDLE';
      lastSyncedTime = 0;
      lastInitSyncKey = '';
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
    if (!targetVideo || !targetVideo.isConnected) {
      const v = findVideoElement();
      if (v) attachVideoListeners(v);
    }
    if (targetVideo && roomState.isHost && isCurrentActiveVideoTab()) {
      console.log('[Syncine Host] 回報最新影片狀態給新進成員 Socket:', payload?.targetGuestSocketId);
      chrome.runtime.sendMessage({
        type: 'BG_SYNC_STATE',
        targetGuestSocketId: payload?.targetGuestSocketId,
        data: {
          action: targetVideo.paused ? 'PAUSE' : 'PLAY',
          currentTime: targetVideo.currentTime,
          playbackRate: targetVideo.playbackRate,
          paused: targetVideo.paused,
          timestamp: Date.now()
        }
      });
    }
  } else if (type === 'CS_PERMISSION_UPDATED') {
    roomState.allowGuestControl = payload.allowGuestControl;
    console.log('[Syncine] 觀眾權限狀態更新:', roomState.allowGuestControl);
  } else if (type === 'SHOW_SECURITY_ALERT') {
    if (!isTopFrame) return false;
    const alertMsg = getStandaloneText('ERR_UNAUTHORIZED_URL');
    const ver = payload?.version ? ` [Syncine v${payload.version}]` : '';
    alert(`${alertMsg}${ver}\n(${payload?.url || ''})`);
  }

  // 保持訊息通道暢通並確認已接收，避免 Background catch 到未捕獲之連線異常
  sendResponse?.({ received: true });
  return true;
});

function startSyncWatchdog() {
  if (syncWatchdogTimer) clearInterval(syncWatchdogTimer);
  syncWatchdogTimer = setInterval(() => {
    if (!isSiteActive) return;

    // 1. 偵測純 history.pushState 驅動且未觸發外層 DOM 變動之 SPA 路由切換
    if (isTopFrame && window.location.href !== lastObservedUrl) {
      lastObservedUrl = window.location.href;
      handleUrlOrVideoChange('Watchdog URL Change');
    }

    // 2. 偵測 Shadow DOM 內部延遲掛載 (Apple TV+ / Disney+ / Max) 或換集後舊 <video> 被銷毀替換
    if (!targetVideo || !targetVideo.isConnected) {
      const v = findVideoElement();
      if (v) {
        attachVideoListeners(v);
        if (roomState.isInRoom && roomState.isHost && isCurrentActiveVideoTab() && !heartbeatTimer) {
          startHeartbeat();
        }
      }
    }
  }, 1000);
}

let isInitialized = false;
function activateContentScript() {
  if (isInitialized || !isEligibleFrame) return;
  isInitialized = true;
  console.log('[Syncine ContentScript] 啟動同步服務');
  if (isTopFrame) {
    setupKeepAlivePort();
    initPlaylistClickListeners();
  }
  initObserver();
  startSyncWatchdog();
  queryInitialRoomState();
}

function deactivateContentScript() {
  isSiteActive = false;
  isInitialized = false;
  lastInitSyncKey = '';
  stopHeartbeat();
  if (syncWatchdogTimer) {
    clearInterval(syncWatchdogTimer);
    syncWatchdogTimer = null;
  }
  if (bufferingTimer) {
    clearTimeout(bufferingTimer);
    bufferingTimer = null;
  }
  if (domObserver) {
    domObserver.disconnect();
    domObserver = null;
  }
  if (keepAlivePort) {
    try { keepAlivePort.disconnect(); } catch (_) {}
    keepAlivePort = null;
  }
  roomState = { isInRoom: false, isHost: false, allowGuestControl: false };
}

// 啟動守衛：正式開放平台(及專屬播放器子框架)立即同步啟動；候選網站預設 100% 靜默，僅在彩蛋解鎖時啟動
if (isEligibleFrame) {
  if (isSiteActive) {
    activateContentScript();
  } else if (isTopFrame) {
    if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
      chrome.storage.local.get(['syncine_unlock_candidates'], (res) => {
        if (
          res?.syncine_unlock_candidates &&
          (isPlatformDomainPermitted(window.location.href) ||
            isPlatformPermitted(window.location.href) ||
            isUniversalSupportedUrl(window.location.href))
        ) {
          isSiteActive = true;
          activateContentScript();
        }
      });
    }
  }

  if (isTopFrame && typeof chrome !== 'undefined' && chrome?.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.syncine_unlock_candidates) {
        const unlocked = Boolean(changes.syncine_unlock_candidates.newValue);
        if (
          unlocked &&
          (isPlatformDomainPermitted(window.location.href) ||
            isPlatformPermitted(window.location.href) ||
            isUniversalSupportedUrl(window.location.href))
        ) {
          isSiteActive = true;
          activateContentScript();
        } else if (!unlocked && !isPlatformDomainActive(window.location.href, false)) {
          deactivateContentScript();
        }
      }
    });
  }
}
