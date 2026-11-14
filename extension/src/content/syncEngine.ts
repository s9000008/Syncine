import {
  PlaybackConflictState,
  SyncData,
  getVideoIdentifier,
  getCanonicalVideoUrl,
  isSameVideoOrWebsite,
  isNonVideoBrowsePage
} from '../types/protocol';
import { PlaybackContentionDetector } from './contentionDetector';
import {
  isPlatformActive,
  isPlatformDomainActive,
  isPlatformDomainPermitted,
  isPlatformPermitted,
  isUniversalSupportedUrl
} from '../platforms';
import { getStandaloneText } from '../locales/standalone';
import {
  PlaybackStateProvider,
  findGenericVideoElement,
  resolvePlatformAdapter,
  safePlayVideo
} from './adapters';

const hasDom = typeof window !== 'undefined' && typeof document !== 'undefined';

// 頂層視窗防禦守衛 (防止注入廣告/沙盒 iframe；僅特例放行 Crunchyroll 官方 Vilos 播放器專用子框架)
const isTopFrame = hasDom ? window.self === window.top : false;
const isAllowedPlayerFrame = hasDom ? window.location.hostname === 'static.crunchyroll.com' : false;
const isEligibleFrame = isTopFrame || isAllowedPlayerFrame;
let parentTabUrl = isAllowedPlayerFrame && hasDom ? document.referrer || '' : '';

export function getEffectivePageUrl(): string {
  if (!hasDom) return '';
  return isAllowedPlayerFrame && parentTabUrl ? parentTabUrl : window.location.href;
}

// 局部開放守衛：依據已開放網域判定 (支援從平台首頁透過 SPA 導航進入播放頁；未解鎖候選網站維持 100% 靜默休眠)
let isSiteActive = hasDom
  ? isAllowedPlayerFrame || isPlatformDomainActive(window.location.href) || isPlatformActive(window.location.href)
  : false;

// ----------------------------------------------------
// 1. MV3 長連接 Port 保活與 bfcache 生命週期管理
// ----------------------------------------------------
let keepAlivePort: chrome.runtime.Port | null = null;
const instanceAttachedSymbol = Symbol('syncine_attached');

function isExtensionContextValid(): boolean {
  try {
    return typeof chrome !== 'undefined' && Boolean(chrome.runtime && chrome.runtime.id);
  } catch {
    return false;
  }
}

function setupKeepAlivePort(): void {
  if (!hasDom || window.self !== window.top || !isExtensionContextValid()) return;
  try {
    if (keepAlivePort) {
      try {
        keepAlivePort.disconnect();
      } catch {
        // 忽略舊 Port 釋放異常
      }
      keepAlivePort = null;
    }
    keepAlivePort = chrome.runtime.connect({ name: 'syncine-keepalive' });
    keepAlivePort.onDisconnect.addListener((port) => {
      if (!isExtensionContextValid()) {
        keepAlivePort = null;
        deactivateContentScript();
        return;
      }
      const lastError = chrome.runtime.lastError;
      const portError = (port as any)?.error;
      if (lastError || portError) {
        console.log(
          '[Syncine ContentScript] Keep-Alive Port 正常釋放或因 bfcache 凍結切斷:',
          lastError?.message || portError?.message
        );
      }
      keepAlivePort = null;
    });
  } catch (e) {
    console.warn('[Syncine] 建立 Keep-Alive Port 失敗:', e);
  }
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
  guestAwaitingApproval?: boolean;
} = {
  isInRoom: false,
  isHost: false,
  allowGuestControl: false,
  guestAwaitingApproval: false
};
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let bufferingTimer: ReturnType<typeof setTimeout> | null = null;
// 房主「已確認卡頓 (>5s)」旗標：期間心跳一律回報 paused:true，避免暫停被下一次心跳抵銷 (規格 9.1)
let hostStallActive = false;
let seekDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let userSeekingResetTimer: ReturnType<typeof setTimeout> | null = null;
let isUserSeeking = false;
let wasPlayingBeforeSeek = false;
let lastSyncedTime = 0;
let lastRemoteCommandTime = 0;
let roomPlaybackState: 'PLAYING' | 'PAUSED' | 'IDLE' = 'IDLE';
let lastInitSyncKey = '';
let hasReceivedInitialSync = false;
let initSyncRetryTimer1: ReturnType<typeof setTimeout> | null = null;
let initSyncRetryTimer2: ReturnType<typeof setTimeout> | null = null;
let syncWatchdogTimer: ReturnType<typeof setInterval> | null = null;
let isShowingSecurityAlert = false;
let lastAlertedSecurityUrl = '';
let lastAlertedSecurityTime = 0;

let lastPlaylistActionTime = 0;
let lastAutoRedirectedUrl = '';
let playlistCheckDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let playlistClickListenerBound = false;
let domObserver: MutationObserver | null = null;
let lastObservedUrl = hasDom ? window.location.href : '';
let isInitialized = false;
let userInteractionListenerBound = false;
const contentionDetector = new PlaybackContentionDetector();

function syncContentionContext(): void {
  if (!hasDom) return;
  const adapter = resolvePlatformAdapter(window.location.hostname);
  contentionDetector.updateContext(adapter?.id || 'universal', window.location.hostname);
}

function reportPlaybackContention(conflict: PlaybackConflictState | null): void {
  if (!conflict || typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;
  try {
    chrome.runtime.sendMessage(
      {
        type: 'BG_PLAYBACK_CONFLICT_DETECTED',
        payload: conflict
      },
      () => {
        void chrome.runtime.lastError;
      }
    );
  } catch {
    // 忽略 Extension Context 卸載瞬間之傳送異常
  }
}

function markProgrammatic(durationMs = 800): void {
  programmaticUntilTimestamp = Date.now() + durationMs;
}

function isProgrammatic(): boolean {
  return Date.now() < programmaticUntilTimestamp;
}

function setUserSeekingState(seeking: boolean): void {
  isUserSeeking = seeking;
  if (userSeekingResetTimer) {
    clearTimeout(userSeekingResetTimer);
    userSeekingResetTimer = null;
  }
  if (seeking) {
    userSeekingResetTimer = setTimeout(() => {
      isUserSeeking = false;
      userSeekingResetTimer = null;
    }, 1200);
  }
}

function getCurrentTabCanonicalUrl(): string | undefined {
  const url = getEffectivePageUrl();
  if (!url || isNonVideoBrowsePage(url)) return undefined;
  return getCanonicalVideoUrl(url);
}

const playbackCtxProvider: PlaybackStateProvider = () => ({
  isInRoom: roomState.isInRoom,
  roomPlaybackState,
  lastSyncedTime,
  setLastSyncedTime: (t: number) => {
    lastSyncedTime = t;
  },
  markProgrammatic,
  safePlayVideo
});

function isCurrentActiveVideoTab(incomingVideoUrl?: string): boolean {
  if (!roomState.isInRoom) return false;
  const effectiveUrl = getEffectivePageUrl();
  if (incomingVideoUrl && !isNonVideoBrowsePage(incomingVideoUrl)) {
    return isSameVideoOrWebsite(effectiveUrl, incomingVideoUrl);
  }
  if (!roomState.currentUrl || isNonVideoBrowsePage(roomState.currentUrl)) {
    return !isNonVideoBrowsePage(effectiveUrl);
  }
  if (isSameVideoOrWebsite(effectiveUrl, roomState.currentUrl)) {
    return true;
  }
  if (roomState.isHost && hasDom && !document.hidden && !isNonVideoBrowsePage(effectiveUrl)) {
    return true;
  }
  return false;
}

function clearInitSyncRetries(): void {
  if (initSyncRetryTimer1) {
    clearTimeout(initSyncRetryTimer1);
    initSyncRetryTimer1 = null;
  }
  if (initSyncRetryTimer2) {
    clearTimeout(initSyncRetryTimer2);
    initSyncRetryTimer2 = null;
  }
}

function requestInitialSyncIfNeeded(): void {
  if (!roomState.isInRoom || roomState.isHost || !targetVideo) return;
  if (roomState.guestAwaitingApproval) return;
  if (!isCurrentActiveVideoTab()) return;

  const effectiveUrl = getEffectivePageUrl();
  const key = `${roomState.currentUrl || ''}::${getVideoIdentifier(effectiveUrl) || effectiveUrl}`;
  if (!key || key === lastInitSyncKey) return;
  lastInitSyncKey = key;
  hasReceivedInitialSync = false;
  clearInitSyncRetries();

  const sendInitReq = () => {
    if (!roomState.isInRoom || roomState.isHost || roomState.guestAwaitingApproval || !isExtensionContextValid()) return;
    chrome.runtime.sendMessage({ type: 'BG_REQUEST_INIT_SYNC' }).catch(() => {});
  };

  sendInitReq();
  if (targetVideo.readyState < 1) {
    targetVideo.addEventListener('loadedmetadata', () => sendInitReq(), { once: true });
  }
  initSyncRetryTimer1 = setTimeout(() => {
    if (!hasReceivedInitialSync) sendInitReq();
  }, 1200);
  initSyncRetryTimer2 = setTimeout(() => {
    if (!hasReceivedInitialSync) sendInitReq();
  }, 2500);
}

function findVideoElement(): HTMLVideoElement | null {
  if (!hasDom) return null;
  const adapter = resolvePlatformAdapter(window.location.hostname);
  return adapter ? adapter.findVideo(targetVideo) : findGenericVideoElement();
}

function isCurrentPlatformAdPlaying(): boolean {
  if (!hasDom) return false;
  const adapter = resolvePlatformAdapter(window.location.hostname);
  return adapter?.isAdPlaying ? adapter.isAdPlaying() : false;
}

// ----------------------------------------------------
// 3. 定時心跳 (Host 端 3 秒發送一次)
// ----------------------------------------------------
function startHeartbeat(): void {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    if (!targetVideo || !roomState.isInRoom || !roomState.isHost) return;

    if (!isCurrentActiveVideoTab()) {
      console.log('[Syncine Heartbeat] 偵測到本分頁影片已過期 (非當前房間目標影片)，自動靜音心跳');
      stopHeartbeat();
      return;
    }

    if (isCurrentPlatformAdPlaying()) return;

    chrome.runtime.sendMessage({
      type: 'BG_SYNC_STATE',
      data: {
        action: 'HEARTBEAT',
        currentTime: targetVideo.currentTime,
        playbackRate: targetVideo.playbackRate,
        paused: targetVideo.paused || hostStallActive,
        timestamp: Date.now(),
        videoUrl: getCurrentTabCanonicalUrl()
      }
    });
  }, 3000);
}

function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

// ----------------------------------------------------
// 4. 跨平台播放控制轉派與 5 秒容差延遲補償演算法
// ----------------------------------------------------
function applySeek(video: HTMLVideoElement, targetTime: number): void {
  const adapter = hasDom ? resolvePlatformAdapter(window.location.hostname) : null;
  if (adapter?.applySeek?.(video, targetTime)) return;
  video.currentTime = targetTime;
}

function applyPlay(video: HTMLVideoElement): void {
  const adapter = hasDom ? resolvePlatformAdapter(window.location.hostname) : null;
  if (adapter?.applyPlay?.(video, playbackCtxProvider)) return;
  safePlayVideo(video);
}

function applyPause(video: HTMLVideoElement): void {
  const adapter = hasDom ? resolvePlatformAdapter(window.location.hostname) : null;
  if (adapter?.applyPause?.(video)) return;
  video.pause();
}

function applySyncState(data: SyncData): void {
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
  if (!isCurrentActiveVideoTab(data.videoUrl)) {
    console.log(
      `[Syncine] 當前分頁影片與房間目標不符，略過時間軸同步 (myId: ${getVideoIdentifier(window.location.href)}, roomId: ${getVideoIdentifier(data.videoUrl || roomState.currentUrl)})`
    );
    return;
  }

  if (data.videoUrl && isSameVideoOrWebsite(getEffectivePageUrl(), data.videoUrl)) {
    roomState.currentUrl = data.videoUrl;
  }

  if (isCurrentPlatformAdPlaying()) {
    console.log('[Syncine] 廣告播放中，忽略同步事件');
    return;
  }

  const { action, currentTime: serverSentTime, timestamp: clientSentTimestamp, paused: serverPaused } = data;
  const clientReceiveTimestamp = Date.now();

  const networkLatency = Math.max(0, (clientReceiveTimestamp - clientSentTimestamp) / 2 / 1000);
  const isTargetPaused = action === 'PAUSE' || (action === 'HEARTBEAT' && serverPaused);
  const targetServerTime = serverSentTime + (isTargetPaused ? 0 : networkLatency);
  const localTime = targetVideo.currentTime;
  const timeDiff = Math.abs(localTime - targetServerTime);

  const adapter = hasDom ? resolvePlatformAdapter(window.location.hostname) : null;
  syncContentionContext();
  const needsSource = action === 'PLAY' || action === 'SEEK' || (action === 'HEARTBEAT' && !serverPaused);
  if (needsSource && adapter?.prepareSourceForSync) {
    if (!adapter.prepareSourceForSync(targetVideo, targetServerTime, !isTargetPaused, playbackCtxProvider)) {
      return;
    }
  }

  lastRemoteCommandTime = Date.now();
  hasReceivedInitialSync = true;
  clearInitSyncRetries();
  setUserSeekingState(false);
  markProgrammatic(1000);

  if (
    typeof data.playbackRate === 'number' &&
    data.playbackRate >= 0.25 &&
    data.playbackRate <= 4 &&
    Math.abs(targetVideo.playbackRate - data.playbackRate) > 0.01
  ) {
    try {
      targetVideo.playbackRate = data.playbackRate;
      adapter?.applyPlaybackRate?.(targetVideo, data.playbackRate);
    } catch {
      // 忽略瀏覽器倍速設定異常
    }
  }

  if (action === 'PLAY') {
    roomPlaybackState = 'PLAYING';
    if (timeDiff > 0.5) {
      applySeek(targetVideo, targetServerTime);
    }
    lastSyncedTime = targetServerTime;
    applyPlay(targetVideo);
  } else if (action === 'PAUSE') {
    roomPlaybackState = 'PAUSED';
    if (timeDiff > 0.5) {
      applySeek(targetVideo, targetServerTime);
    }
    lastSyncedTime = targetServerTime;
    applyPause(targetVideo);
  } else if (action === 'SEEK') {
    applySeek(targetVideo, targetServerTime);
    lastSyncedTime = targetServerTime;
    if (serverPaused === false) {
      roomPlaybackState = 'PLAYING';
      applyPlay(targetVideo);
    } else if (serverPaused === true) {
      roomPlaybackState = 'PAUSED';
      applyPause(targetVideo);
    }
  } else if (action === 'HEARTBEAT') {
    if (typeof serverPaused === 'boolean') {
      roomPlaybackState = serverPaused ? 'PAUSED' : 'PLAYING';
      if (serverPaused && !targetVideo.paused) {
        applyPause(targetVideo);
      } else if (!serverPaused && targetVideo.paused) {
        applyPlay(targetVideo);
      }
    }

    if (timeDiff > 3) {
      console.log(`[Syncine Heartbeat] 時間差為 ${timeDiff.toFixed(2)} 秒 (>3秒)，強制同步位移至: ${targetServerTime}`);
      applySeek(targetVideo, targetServerTime);
      lastSyncedTime = targetServerTime;
    } else {
      lastSyncedTime = targetVideo.currentTime;
    }
  }

  contentionDetector.recordSyncineEnforcement(roomPlaybackState, false);
}

// ----------------------------------------------------
// 5. 綁定 Video DOM 事件監聽
// ----------------------------------------------------
function attachVideoListeners(video: HTMLVideoElement): void {
  if (!isExtensionContextValid()) {
    deactivateContentScript();
    return;
  }
  if (targetVideo !== video) {
    targetVideo = video;
    lastSyncedTime = video.currentTime || 0;
  }
  if (roomState.isInRoom && roomState.isHost && isCurrentActiveVideoTab() && !heartbeatTimer) {
    startHeartbeat();
  }
  requestInitialSyncIfNeeded();
  if ((video as any)[instanceAttachedSymbol]) return;
  (video as any)[instanceAttachedSymbol] = true;
  (video as any).__syncine_attached = true;

  console.log('[Syncine] 成功綁定 Target Video DOM');

  video.addEventListener('timeupdate', () => {
    if (!isExtensionContextValid()) {
      deactivateContentScript();
      return;
    }
    if (!video.seeking && !isUserSeeking) {
      const isGuestWithoutControl = roomState.isInRoom && !roomState.isHost && !roomState.allowGuestControl;
      if (
        !isGuestWithoutControl ||
        !contentionDetector.hasRecentUserInteraction() ||
        Math.abs(video.currentTime - lastSyncedTime) < 1.5
      ) {
        lastSyncedTime = video.currentTime;
      }
    }
  });

  video.addEventListener('play', () => {
    if (!isExtensionContextValid()) {
      deactivateContentScript();
      return;
    }
    if (!roomState.isInRoom || !isCurrentActiveVideoTab()) return;
    if (isProgrammatic() || isCurrentPlatformAdPlaying()) return;

    const isGuestWithoutControl = !roomState.isHost && !roomState.allowGuestControl;
    if (isGuestWithoutControl) {
      if (roomPlaybackState === 'PAUSED') {
        const hadUserInput = contentionDetector.hasRecentUserInteraction();
        syncContentionContext();
        reportPlaybackContention(contentionDetector.recordObservedMediaFlip('PLAY', !hadUserInput));
        if (contentionDetector.shouldThrottleRollback()) {
          console.warn('[Syncine Contention] 偵測到控制權拉扯衝突，暫時節流被動回滾 (PAUSE)');
          return;
        }
        if (!hadUserInput && Date.now() - lastRemoteCommandTime >= 2500) {
          return;
        }
        console.warn('[Syncine Intercept] 觀眾無權限發起播放，回滾狀態至暫停');
        markProgrammatic(400);
        contentionDetector.recordSyncineEnforcement('PAUSED', true);
        applyPause(video);
      }
      return;
    }

    syncContentionContext();
    reportPlaybackContention(contentionDetector.recordObservedMediaFlip('PLAY', false));

    roomPlaybackState = 'PLAYING';
    chrome.runtime.sendMessage({
      type: 'BG_SYNC_STATE',
      data: {
        action: 'PLAY',
        currentTime: video.currentTime,
        playbackRate: video.playbackRate,
        paused: false,
        timestamp: Date.now(),
        videoUrl: getCurrentTabCanonicalUrl()
      }
    });
  });

  video.addEventListener('pause', () => {
    if (!isExtensionContextValid()) {
      deactivateContentScript();
      return;
    }
    if (!roomState.isInRoom || !isCurrentActiveVideoTab()) return;
    if (isProgrammatic() || isCurrentPlatformAdPlaying()) return;
    if (video.seeking || isUserSeeking) return;

    hostStallActive = false;

    const isGuestWithoutControl = !roomState.isHost && !roomState.allowGuestControl;
    if (isGuestWithoutControl) {
      if (roomPlaybackState === 'PLAYING') {
        const hadUserInput = contentionDetector.hasRecentUserInteraction();
        syncContentionContext();
        reportPlaybackContention(contentionDetector.recordObservedMediaFlip('PAUSE', !hadUserInput));
        if (contentionDetector.shouldThrottleRollback()) {
          console.warn('[Syncine Contention] 偵測到控制權拉扯衝突，暫時節流被動回滾 (PLAY)');
          return;
        }
        if (!hadUserInput && Date.now() - lastRemoteCommandTime >= 2500) {
          return;
        }
        console.warn('[Syncine Intercept] 觀眾無權限發起暫停，回滾狀態至播放');
        markProgrammatic(400);
        contentionDetector.recordSyncineEnforcement('PLAYING', true);
        applyPlay(video);
      }
      return;
    }

    syncContentionContext();
    reportPlaybackContention(contentionDetector.recordObservedMediaFlip('PAUSE', false));

    roomPlaybackState = 'PAUSED';
    chrome.runtime.sendMessage({
      type: 'BG_SYNC_STATE',
      data: {
        action: 'PAUSE',
        currentTime: video.currentTime,
        playbackRate: video.playbackRate,
        paused: true,
        timestamp: Date.now(),
        videoUrl: getCurrentTabCanonicalUrl()
      }
    });
  });

  function broadcastSeek(): void {
    if (!isExtensionContextValid()) {
      deactivateContentScript();
      return;
    }
    if (!targetVideo || !roomState.isInRoom || !isCurrentActiveVideoTab()) return;
    lastSyncedTime = targetVideo.currentTime;
    const isPaused = wasPlayingBeforeSeek ? false : targetVideo.paused;

    chrome.runtime.sendMessage({
      type: 'BG_SYNC_STATE',
      data: {
        action: 'SEEK',
        currentTime: targetVideo.currentTime,
        playbackRate: targetVideo.playbackRate,
        paused: isPaused,
        timestamp: Date.now(),
        videoUrl: getCurrentTabCanonicalUrl()
      }
    });
  }

  video.addEventListener('seeking', () => {
    if (!isExtensionContextValid()) {
      deactivateContentScript();
      return;
    }
    if (!roomState.isInRoom || !isCurrentActiveVideoTab()) return;
    if (isProgrammatic() || isCurrentPlatformAdPlaying()) return;

    const isGuestWithoutControl = !roomState.isHost && !roomState.allowGuestControl;
    if (isGuestWithoutControl) {
      if (lastSyncedTime >= 0 && Math.abs(video.currentTime - lastSyncedTime) > 1.5) {
        const hadUserInput = contentionDetector.hasRecentUserInteraction();
        syncContentionContext();
        reportPlaybackContention(contentionDetector.recordObservedMediaFlip('SEEK', !hadUserInput));
        if (contentionDetector.shouldThrottleRollback()) {
          console.warn('[Syncine Contention] 偵測到控制權拉扯衝突，暫時節流被動進度回滾');
          return;
        }
        if (!hadUserInput && Date.now() - lastRemoteCommandTime >= 2500) {
          lastSyncedTime = video.currentTime;
          return;
        }
        console.warn(`[Syncine Intercept] 觀眾無權限拖曳進度條，強制回滾至同步時間: ${lastSyncedTime.toFixed(2)}s`);
        markProgrammatic(400);
        contentionDetector.recordSyncineEnforcement(roomPlaybackState, true);
        if (window.location.hostname.includes('netflix.com')) {
          applySeek(video, lastSyncedTime);
        } else {
          applySeek(video, lastSyncedTime);
          video.currentTime = lastSyncedTime;
        }
      }
      return;
    }

    if (!isUserSeeking) {
      syncContentionContext();
      reportPlaybackContention(contentionDetector.recordObservedMediaFlip('SEEK', false));
      setUserSeekingState(true);
      wasPlayingBeforeSeek = !video.paused || roomPlaybackState === 'PLAYING';
    } else {
      setUserSeekingState(true);
    }

    if (seekDebounceTimer) clearTimeout(seekDebounceTimer);
    seekDebounceTimer = setTimeout(() => {
      broadcastSeek();
    }, 150);
  });

  video.addEventListener('seeked', () => {
    setUserSeekingState(false);
    if (!isExtensionContextValid()) {
      deactivateContentScript();
      return;
    }
    if (!roomState.isInRoom || !isCurrentActiveVideoTab()) return;
    if (isProgrammatic() || isCurrentPlatformAdPlaying()) return;
    if (!roomState.isHost && !roomState.allowGuestControl) return;

    if (seekDebounceTimer) clearTimeout(seekDebounceTimer);
    setTimeout(() => {
      broadcastSeek();
      setUserSeekingState(false);
    }, 50);
  });

  video.addEventListener('waiting', () => {
    if (!isExtensionContextValid()) {
      deactivateContentScript();
      return;
    }
    if (!roomState.isInRoom || !roomState.isHost || !isCurrentActiveVideoTab()) return;
    if (isProgrammatic() || isCurrentPlatformAdPlaying() || video.paused) return;

    if (bufferingTimer) clearTimeout(bufferingTimer);
    bufferingTimer = setTimeout(() => {
      bufferingTimer = null;
      if (!roomState.isInRoom || !roomState.isHost) return;
      if (video.paused || isProgrammatic() || isCurrentPlatformAdPlaying()) return;

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

    if (hostStallActive) {
      hostStallActive = false;
      if (
        roomState.isInRoom &&
        roomState.isHost &&
        isCurrentActiveVideoTab() &&
        !video.paused &&
        !isCurrentPlatformAdPlaying()
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
    if (bufferingTimer) {
      clearTimeout(bufferingTimer);
      bufferingTimer = null;
    }
  });

  video.addEventListener('ratechange', () => {
    if (!isExtensionContextValid()) {
      deactivateContentScript();
      return;
    }
    if (!roomState.isInRoom || !isCurrentActiveVideoTab()) return;
    if (isProgrammatic() || isCurrentPlatformAdPlaying()) return;
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

  video.addEventListener('ended', () => {
    if (roomState.isInRoom && roomState.isHost && isPlaylistOrEpisodeSupported()) {
      markPlaylistActionTriggered('Video Ended (Auto-Play Next Trigger)');
    }
  });
}

// ----------------------------------------------------
// 6. 清單與上下集 (Next/Prev Episode) 自動跳轉同步管理 (嚴格依網域隔離)
// ----------------------------------------------------
export function isPlaylistOrEpisodeSupported(): boolean {
  if (!hasDom) return false;
  try {
    const adapter = resolvePlatformAdapter(window.location.hostname);
    return adapter?.isPlaylistSupported ? adapter.isPlaylistSupported(window.location) : false;
  } catch {
    return false;
  }
}

export function markPlaylistActionTriggered(source: string): void {
  lastPlaylistActionTime = Date.now();
  console.log(`[Syncine Playlist] 捕捉到換集/切片觸發信號 (${source})`);
}

export function clearPlaylistActionTrigger(): void {
  lastPlaylistActionTime = 0;
}

/**
 * 依據當前網站 hostname 匹配對應的上下集與清單 DOM 點擊事件（杜絕跨平台通用 class 誤觸）
 */
export function matchPlaylistClickForHostname(
  hostname: string,
  target: HTMLElement | null
): { matched: boolean; ignored: boolean; label?: string } {
  if (!target || typeof target.closest !== 'function') {
    return { matched: false, ignored: false };
  }
  const adapter = resolvePlatformAdapter(hostname);
  if (!adapter) {
    return { matched: false, ignored: false };
  }
  if (adapter.playlistClickSelector && target.closest(adapter.playlistClickSelector)) {
    return { matched: true, ignored: false, label: adapter.playlistClickLabel };
  }
  if (adapter.playlistIgnoreSelector && target.closest(adapter.playlistIgnoreSelector)) {
    return { matched: false, ignored: true };
  }
  return { matched: false, ignored: false };
}

function initPlaylistClickListeners(): void {
  if (!hasDom || playlistClickListenerBound) return;
  playlistClickListenerBound = true;

  document.addEventListener(
    'click',
    (e) => {
      if (!isSiteActive || !roomState.isInRoom || !roomState.isHost) return;
      const target = e.target as HTMLElement | null;
      const result = matchPlaylistClickForHostname(window.location.hostname, target);
      if (result.matched && result.label) {
        markPlaylistActionTriggered(result.label);
      } else if (result.ignored) {
        clearPlaylistActionTrigger();
      }
    },
    true
  );

  document.addEventListener(
    'keydown',
    (e) => {
      if (!isSiteActive || !roomState.isInRoom || !roomState.isHost) return;
      if (
        window.location.hostname.includes('youtube.com') &&
        e.shiftKey &&
        (e.key === 'N' || e.key === 'n' || e.key === 'P' || e.key === 'p')
      ) {
        markPlaylistActionTriggered('YouTube Shift+N/P Shortcut');
      }
    },
    true
  );
}

export function checkAndBroadcastPlaylistNavigation(source: string): void {
  if (!hasDom || !roomState.isInRoom || !roomState.isHost) return;

  const currentHref = window.location.href;
  if (!isPlatformPermitted(currentHref) && !isUniversalSupportedUrl(currentHref)) return;

  const currentVideoId = getVideoIdentifier(currentHref);
  const roomVideoId = getVideoIdentifier(roomState.currentUrl);
  if (!currentVideoId || currentVideoId === roomVideoId || isSameVideoOrWebsite(currentHref, roomState.currentUrl)) {
    return;
  }

  const hasSupport = isPlaylistOrEpisodeSupported();
  // 若房間建立時位於平台首頁/目錄頁 (尚未鎖定任何具體影片)，房主點入第一部具體影片時應自動鎖定為房間目標並帶領觀眾進入
  const isInitialVideoLock = isNonVideoBrowsePage(roomState.currentUrl) && !isNonVideoBrowsePage(currentHref);
  const isRecentAction = Date.now() - lastPlaylistActionTime < 15000 || isInitialVideoLock;
  if (!isRecentAction) {
    console.log(
      `[Syncine Playlist] 忽略自動跳轉 (${source})：未偵測到上下集按鈕或播放清單選集觸發 (hasSupport=${hasSupport})，需透過手動推送切換`
    );
    return;
  }

  lastPlaylistActionTime = 0;

  const cleanTarget = getCanonicalVideoUrl(currentHref);
  if (!cleanTarget || cleanTarget === lastAutoRedirectedUrl) return;
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

function handleUrlOrVideoChange(triggerSource: string): void {
  if (!roomState.isInRoom || !roomState.isHost) return;

  if (playlistCheckDebounceTimer) clearTimeout(playlistCheckDebounceTimer);
  playlistCheckDebounceTimer = setTimeout(() => {
    checkAndBroadcastPlaylistNavigation(triggerSource);
  }, 400);
}

// ----------------------------------------------------
// 7. MutationObserver、Watchdog 與生命週期啟動
// ----------------------------------------------------
function initObserver(): void {
  if (!hasDom) return;
  const v = findVideoElement();
  if (v) {
    attachVideoListeners(v);
  }

  if (!domObserver && document.body) {
    domObserver = new MutationObserver(() => {
      if (!isSiteActive) return;
      if (window.location.href !== lastObservedUrl) {
        lastObservedUrl = window.location.href;
        handleUrlOrVideoChange('MutationObserver URL Change');

        setTimeout(() => {
          if (!isSiteActive) return;
          const nextVideo = findVideoElement();
          if (nextVideo) attachVideoListeners(nextVideo);
          if (roomState.isInRoom) {
            if (roomState.isHost) {
              if (isCurrentActiveVideoTab()) {
                startHeartbeat();
              } else {
                stopHeartbeat();
              }
            } else {
              requestInitialSyncIfNeeded();
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

function queryInitialRoomState(): void {
  if (!hasDom || typeof chrome === 'undefined') return;
  if ((window.self !== window.top && !isAllowedPlayerFrame) || !isSiteActive) return;

  chrome.runtime.sendMessage({ type: 'GET_ROOM_STATE' }, (res) => {
    if (chrome.runtime.lastError) {
      console.warn('[Syncine ContentScript] queryInitialRoomState 異常:', chrome.runtime.lastError.message);
      return;
    }
    if (isAllowedPlayerFrame && res?.tabUrl) {
      parentTabUrl = res.tabUrl;
    }
    if (res?.roomState) {
      roomState = {
        isInRoom: true,
        isHost: res.roomState.isHost,
        allowGuestControl: res.roomState.allowGuestControl,
        currentUrl: res.roomState.currentUrl,
        guestAwaitingApproval: Boolean(res.roomState.guestAwaitingApproval)
      };
      if (roomState.isHost && isCurrentActiveVideoTab()) {
        startHeartbeat();
      } else {
        stopHeartbeat();
        requestInitialSyncIfNeeded();
      }
    } else {
      roomState = { isInRoom: false, isHost: false, allowGuestControl: false, guestAwaitingApproval: false };
      lastInitSyncKey = '';
      hasReceivedInitialSync = false;
      clearInitSyncRetries();
      contentionDetector.reset();
      stopHeartbeat();
    }
  });
}

function startSyncWatchdog(): void {
  if (!hasDom) return;
  if (syncWatchdogTimer) clearInterval(syncWatchdogTimer);
  syncWatchdogTimer = setInterval(() => {
    if (!isExtensionContextValid()) {
      deactivateContentScript();
      return;
    }
    if (!isSiteActive) return;

    if (isTopFrame && window.location.href !== lastObservedUrl) {
      lastObservedUrl = window.location.href;
      handleUrlOrVideoChange('Watchdog URL Change');
    }

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

function initPassiveInteractionListeners(): void {
  if (!hasDom || userInteractionListenerBound) return;
  userInteractionListenerBound = true;
  const markInput = () => {
    contentionDetector.markUserInteraction();
  };
  document.addEventListener('pointerdown', markInput, { capture: true, passive: true });
  document.addEventListener('keydown', markInput, { capture: true, passive: true });
}

function activateContentScript(): void {
  if (isInitialized || !isEligibleFrame) return;
  isInitialized = true;
  console.log('[Syncine ContentScript] 啟動同步服務');
  initPassiveInteractionListeners();
  if (isTopFrame) {
    setupKeepAlivePort();
    initPlaylistClickListeners();
  }
  initObserver();
  startSyncWatchdog();
  queryInitialRoomState();
}

function deactivateContentScript(): void {
  isSiteActive = false;
  isInitialized = false;
  lastInitSyncKey = '';
  hasReceivedInitialSync = false;
  clearInitSyncRetries();
  setUserSeekingState(false);
  contentionDetector.reset();
  stopHeartbeat();
  if (seekDebounceTimer) {
    clearTimeout(seekDebounceTimer);
    seekDebounceTimer = null;
  }
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
    try {
      keepAlivePort.disconnect();
    } catch {
      // 忽略 Port 斷開異常
    }
    keepAlivePort = null;
  }
  roomState = { isInRoom: false, isHost: false, allowGuestControl: false, guestAwaitingApproval: false };
}

export function bootstrapContentScript(): void {
  if (!hasDom || typeof chrome === 'undefined') return;

  window.addEventListener('pagehide', (event) => {
    if (event.persisted && keepAlivePort) {
      try {
        keepAlivePort.disconnect();
      } catch {
        // 忽略斷開異常
      }
      keepAlivePort = null;
    }
  });

  window.addEventListener('pageshow', (event) => {
    if (event.persisted && isEligibleFrame && isSiteActive) {
      if (isTopFrame) setupKeepAlivePort();
      queryInitialRoomState();
    }
  });

  window.addEventListener('yt-navigate-finish', () => {
    if (!isSiteActive) return;
    handleUrlOrVideoChange('YouTube yt-navigate-finish');
    if (isTopFrame) {
      setTimeout(() => {
        if (!isTopFrame || !isSiteActive) return;
        initObserver();
        if (roomState.isInRoom) {
          if (roomState.isHost) {
            if (isCurrentActiveVideoTab()) {
              startHeartbeat();
            } else {
              stopHeartbeat();
            }
          } else {
            requestInitialSyncIfNeeded();
          }
        }
      }, 1000);
    }
  });

  window.addEventListener('popstate', () => {
    if (!isSiteActive) return;
    handleUrlOrVideoChange('popstate');
  });

  window.addEventListener('hashchange', () => {
    if (!isSiteActive) return;
    handleUrlOrVideoChange('hashchange');
  });

  const currentAdapter = resolvePlatformAdapter(window.location.hostname);
  if (currentAdapter?.enablePlayCaptureLock) {
    document.addEventListener(
      'play',
      (e) => {
        const el = e.target;
        if (el instanceof HTMLVideoElement) {
          if (currentAdapter.shouldIgnoreCapturePlay?.(el, window.location)) {
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

  chrome.runtime?.onMessage?.addListener((request, _sender, sendResponse) => {
    const { type, payload } = request || {};
    if (isAllowedPlayerFrame && typeof request?.parentTabUrl === 'string' && request.parentTabUrl) {
      parentTabUrl = request.parentTabUrl;
    }

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

    if (!isSiteActive && type !== 'SHOW_SECURITY_ALERT') {
      return false;
    }

    if (type === 'CS_SYNC_RECEIVED') {
      applySyncState(payload.data);
    } else if (type === 'CS_ROOM_STATE_CHANGED') {
      if (payload) {
        const wasAwaitingApproval = Boolean(roomState.guestAwaitingApproval);
        roomState = {
          isInRoom: true,
          isHost: payload.isHost,
          allowGuestControl: payload.allowGuestControl,
          currentUrl: payload.currentUrl,
          guestAwaitingApproval: Boolean(payload.guestAwaitingApproval)
        };
        if (wasAwaitingApproval && !roomState.guestAwaitingApproval) {
          lastInitSyncKey = '';
        }
        if (!targetVideo || !targetVideo.isConnected) {
          const v = findVideoElement();
          if (v) attachVideoListeners(v);
        }
        if (roomState.isHost && isCurrentActiveVideoTab()) {
          startHeartbeat();
        } else {
          stopHeartbeat();
          requestInitialSyncIfNeeded();
        }
      } else {
        roomState = { isInRoom: false, isHost: false, allowGuestControl: false, guestAwaitingApproval: false };
        roomPlaybackState = 'IDLE';
        lastSyncedTime = 0;
        lastInitSyncKey = '';
        hasReceivedInitialSync = false;
        clearInitSyncRetries();
        hostStallActive = false;
        contentionDetector.reset();
        if (bufferingTimer) {
          clearTimeout(bufferingTimer);
          bufferingTimer = null;
        }
        stopHeartbeat();
      }
    } else if (type === 'CS_REQUEST_CURRENT_STATE') {
      if (!targetVideo || !targetVideo.isConnected) {
        const v = findVideoElement();
        if (v) attachVideoListeners(v);
      }
      if (targetVideo && roomState.isHost && isCurrentActiveVideoTab()) {
        chrome.runtime.sendMessage({
          type: 'BG_SYNC_STATE',
          targetGuestSocketId: payload?.targetGuestSocketId,
          data: {
            action: targetVideo.paused ? 'PAUSE' : 'PLAY',
            currentTime: targetVideo.currentTime,
            playbackRate: targetVideo.playbackRate,
            paused: targetVideo.paused,
            timestamp: Date.now(),
            videoUrl: getCurrentTabCanonicalUrl()
          }
        });
      }
    } else if (type === 'CS_PERMISSION_UPDATED') {
      roomState.allowGuestControl = payload.allowGuestControl;
    } else if (type === 'SHOW_SECURITY_ALERT') {
      if (!isTopFrame) return false;
      const targetUrl = payload?.url || '';
      const now = Date.now();
      if (isShowingSecurityAlert || (targetUrl === lastAlertedSecurityUrl && now - lastAlertedSecurityTime < 15000)) {
        console.warn('[Syncine ContentScript] 抑制重複彈出之資安警告視窗:', targetUrl);
        sendResponse?.({ received: true, suppressed: true });
        return true;
      }

      isShowingSecurityAlert = true;
      lastAlertedSecurityUrl = targetUrl;
      lastAlertedSecurityTime = now;

      try {
        const alertMsg = getStandaloneText('ERR_UNAUTHORIZED_URL');
        const rawVer = typeof payload?.version === 'string' ? payload.version.replace(/^v+/, '') : '';
        const ver = rawVer ? ` [Syncine v${rawVer}]` : '';
        alert(`${alertMsg}${ver}\n(${targetUrl})`);
      } finally {
        setTimeout(() => {
          isShowingSecurityAlert = false;
        }, 500);
      }
    }

    sendResponse?.({ received: true });
    return true;
  });

  if (isEligibleFrame) {
    if (isSiteActive) {
      activateContentScript();
    } else if (isTopFrame) {
      chrome.storage?.local?.get(['syncine_unlock_candidates'], (res) => {
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

    if (isTopFrame && chrome.storage?.onChanged) {
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
}
