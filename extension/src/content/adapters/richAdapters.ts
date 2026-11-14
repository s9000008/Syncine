import { PlaybackStateProvider, VideoPlatformAdapter } from './types';
import { findGenericVideoElement, pickBestNonAdVideo } from './videoDomUtils';

export function findNiconicoVideo(): HTMLVideoElement | null {
  const allVideos = Array.from(
    document.querySelectorAll(
      '[data-name="VideoPlayer"] video, [data-name="MainVideoPlayer"] video, #MainVideoPlayer video, .MainVideoPlayer video, video'
    )
  ) as HTMLVideoElement[];

  const candidates = allVideos.filter(
    (v) => !v.closest('[class*="VideoAd"], #nv_watch_VideoAdContainer, [class*="AdContainer"]')
  );
  if (candidates.length === 0) return null;

  const playing = candidates.find((v) => !v.paused && v.readyState > 0);
  if (playing) return playing;

  const activeMain = candidates.find((v) => Boolean(v.currentSrc || v.getAttribute('src')) && v.offsetWidth > 0);
  if (activeMain) return activeMain;

  const withSrc = candidates.find((v) => Boolean(v.currentSrc || v.getAttribute('src')) || v.readyState > 0);
  if (withSrc) return withSrc;

  return candidates[0];
}

export function findNetflixVideo(): HTMLVideoElement | null {
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

export function findAnime1Video(targetVideo: HTMLVideoElement | null): HTMLVideoElement | null {
  const videos = Array.from(
    document.querySelectorAll('video.vjs-tech, .video-js video, .vjscontainer video, video')
  ) as HTMLVideoElement[];
  if (videos.length === 0) return null;

  const playing = videos.find((v) => !v.paused);
  if (playing) return playing;

  if (
    targetVideo &&
    targetVideo.isConnected &&
    (Boolean(targetVideo.currentSrc || targetVideo.getAttribute('src')) || targetVideo.readyState > 0)
  ) {
    return targetVideo;
  }

  const loaded = videos.find((v) => Boolean(v.currentSrc || v.getAttribute('src')) || v.readyState > 0);
  if (loaded) return loaded;

  return videos.find((v) => v.offsetWidth > 0) || videos[0];
}

export function ensureAnime1SourceReady(
  video: HTMLVideoElement,
  targetTime: number,
  shouldPlay: boolean,
  ctx?: PlaybackStateProvider
): boolean {
  if (!window.location.hostname.includes('anime1.me')) return true;
  if (Boolean(video.currentSrc || video.getAttribute('src')) || video.readyState > 0) {
    return true;
  }

  (video as any).__syncinePendingTarget = { targetTime, shouldPlay };

  if (!(video as any).__syncineWakingUp) {
    (video as any).__syncineWakingUp = true;
    const container = video.closest('.video-js, .vjscontainer, .ap-video-wrapper') || document;
    const bigPlayBtn = container.querySelector('.vjs-big-play-button') as HTMLElement | null;

    video.addEventListener(
      'loadedmetadata',
      () => {
        (video as any).__syncineWakingUp = false;
        const pending = (video as any).__syncinePendingTarget;
        if (!pending) return;
        ctx?.().markProgrammatic(1000);
        if (pending.targetTime > 0.5) {
          video.currentTime = pending.targetTime;
        }
        ctx?.().setLastSyncedTime(video.currentTime);
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
      ctx?.().markProgrammatic(1500);
      bigPlayBtn.click();
    }
  }

  return false;
}

function dispatchBridgeCommand(
  eventName: string,
  datasetFlag: 'syncineNfHandled' | 'syncineYtHandled',
  payload: Record<string, unknown>
): boolean {
  document.documentElement.dataset[datasetFlag] = '0';
  document.documentElement.dataset.syncineBridgeCmd = JSON.stringify(payload);
  try {
    window.dispatchEvent(new CustomEvent(eventName, { detail: payload }));
  } finally {
    delete document.documentElement.dataset.syncineBridgeCmd;
  }
  return document.documentElement.dataset[datasetFlag] === '1';
}

function dispatchBridgePlay(
  eventName: string,
  datasetFlag: 'syncineNfHandled' | 'syncineYtHandled',
  video: HTMLVideoElement,
  ctx: PlaybackStateProvider
): boolean {
  const handled = dispatchBridgeCommand(eventName, datasetFlag, { action: 'PLAY' });
  if (handled) {
    setTimeout(() => {
      const state = ctx();
      if (video.paused && state.isInRoom && state.roomPlaybackState === 'PLAYING') {
        state.safePlayVideo(video);
      }
    }, 250);
    return true;
  }
  return false;
}

function dispatchBridgePause(eventName: string, datasetFlag: 'syncineNfHandled' | 'syncineYtHandled'): boolean {
  return dispatchBridgeCommand(eventName, datasetFlag, { action: 'PAUSE' });
}

export const youtubeAdapter: VideoPlatformAdapter = {
  id: 'youtube',
  hostnames: ['youtube.com'],
  findVideo: () => {
    const ytVideos = Array.from(document.querySelectorAll('video.html5-main-video')) as HTMLVideoElement[];
    const visibleYt = ytVideos.find((v) => v.offsetWidth > 0 && v.offsetHeight > 0);
    return (
      visibleYt ||
      (document.querySelector('video.html5-main-video') as HTMLVideoElement) ||
      findGenericVideoElement()
    );
  },
  isAdPlaying: () => {
    const player = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
    const isAdClassPresent = Boolean(
      player && (player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting'))
    );
    if (!isAdClassPresent) return false;

    const adElement = document.querySelector(
      '.ytp-ad-text, .ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button, .ytp-ad-preview-container, .ytp-ad-duration-remaining'
    ) as HTMLElement | null;

    if (adElement && adElement.offsetWidth > 0 && adElement.offsetHeight > 0) {
      try {
        const style = window.getComputedStyle(adElement);
        return style.display !== 'none' && style.visibility !== 'hidden';
      } catch {
        return false;
      }
    }
    return false;
  },
  applySeek: (video, targetTime) => {
    const handled = dispatchBridgeCommand('SYNCINE_YOUTUBE_CMD', 'syncineYtHandled', {
      action: 'SEEK',
      currentTime: targetTime
    });
    if (!handled || Math.abs(video.currentTime - targetTime) > 0.5) {
      try {
        video.currentTime = targetTime;
      } catch {}
    }
    return true;
  },
  applyPlay: (video, ctx) => {
    const handled = dispatchBridgePlay('SYNCINE_YOUTUBE_CMD', 'syncineYtHandled', video, ctx);
    if (video.paused) {
      ctx().safePlayVideo(video);
    }
    return handled || !video.paused;
  },
  applyPause: (video) => {
    const handled = dispatchBridgePause('SYNCINE_YOUTUBE_CMD', 'syncineYtHandled');
    if (!video.paused) {
      try {
        video.pause();
      } catch {}
    }
    return handled || video.paused;
  },
  applyPlaybackRate: (_video, rate) => {
    dispatchBridgeCommand('SYNCINE_YOUTUBE_CMD', 'syncineYtHandled', { action: 'RATE', playbackRate: rate });
  },
  isPlaylistSupported: (loc) => {
    if (loc.search.includes('list=')) return true;
    if (document.querySelector('ytd-playlist-panel-renderer, #playlist, .ytd-playlist-panel-renderer, #playlist-items')) {
      return true;
    }
    const nextBtn = document.querySelector('.ytp-next-button') as HTMLElement | null;
    return Boolean(nextBtn && nextBtn.style.display !== 'none' && !nextBtn.getAttribute('aria-disabled'));
  },
  playlistClickSelector:
    '.ytp-next-button, .ytp-prev-button, ytd-playlist-panel-video-renderer, #playlist-items ytd-playlist-panel-video-renderer, .ytp-autonav-endscreen-upnext-button',
  playlistIgnoreSelector:
    'ytd-compact-video-renderer, ytd-video-renderer, ytd-rich-item-renderer, ytd-grid-video-renderer, ytd-reel-item-renderer, .ytp-ce-element, .ytp-videowall-still',
  playlistClickLabel: 'YouTube Next/Prev/Playlist Click'
};

export const netflixAdapter: VideoPlatformAdapter = {
  id: 'netflix',
  hostnames: ['netflix.com'],
  findVideo: () => findNetflixVideo(),
  applySeek: (_video, targetTime) => {
    dispatchBridgeCommand('SYNCINE_NETFLIX_CMD', 'syncineNfHandled', { action: 'SEEK', currentTime: targetTime });
    return true;
  },
  applyPlay: (video, ctx) => dispatchBridgePlay('SYNCINE_NETFLIX_CMD', 'syncineNfHandled', video, ctx),
  applyPause: () => dispatchBridgePause('SYNCINE_NETFLIX_CMD', 'syncineNfHandled'),
  isPlaylistSupported: (loc) => {
    if (!loc.pathname.toLowerCase().includes('/watch/')) return false;
    return Boolean(
      document.querySelector(
        '[data-uia="control-episodes"], [data-uia="control-next"], [data-uia*="next-episode"], .button-nfVideos-next, [data-uia*="next-episode-seamless"], [data-uia*="postplay"]'
      )
    );
  },
  playlistClickSelector:
    '[data-uia="control-next"], [data-uia*="next-episode"], [data-uia*="postplay"], [data-uia="control-episodes"], .button-nfVideos-next, [aria-label="Next Episode"], [aria-label="下一集"], [data-uia="next-episode-seamless-button"]',
  playlistClickLabel: 'Netflix Next Episode Click',
  enablePlayCaptureLock: true,
  shouldIgnoreCapturePlay: (_video, loc) => !loc.pathname.includes('/watch/')
};

export const niconicoAdapter: VideoPlatformAdapter = {
  id: 'niconico',
  hostnames: ['nicovideo.jp'],
  findVideo: () => findNiconicoVideo(),
  isAdPlaying: () => {
    const adContainer =
      document.querySelector('#nv_watch_VideoAdContainer') || document.querySelector('[class*="VideoAdContainer"]');
    if (!adContainer || (adContainer as HTMLElement).offsetWidth === 0) return false;
    const adVideo = adContainer.querySelector('video') as HTMLVideoElement | null;
    return Boolean(adVideo && !adVideo.paused && (adVideo.currentSrc || adVideo.getAttribute('src')));
  },
  isPlaylistSupported: (loc) => {
    if (loc.search.includes('playlist=')) return true;
    return Boolean(
      document.querySelector(
        '[data-anchor-area="next_video"], [aria-label*="次の動画"], [aria-label*="Next"], [class*="Series"] a, [class*="Playlist"] a'
      )
    );
  },
  playlistClickSelector:
    '[data-anchor-area="next_video"], [data-anchor-area="prev_video"], [aria-label*="次の動画"], [class*="Series"] a, [class*="Playlist"] a',
  playlistClickLabel: 'Niconico Next/Series Click',
  enablePlayCaptureLock: true,
  shouldIgnoreCapturePlay: (video) =>
    Boolean(video.closest('[class*="VideoAd"], #nv_watch_VideoAdContainer, [class*="AdContainer"]'))
};

export const anime1Adapter: VideoPlatformAdapter = {
  id: 'anime1',
  hostnames: ['anime1.me'],
  findVideo: (currentTargetVideo) => findAnime1Video(currentTargetVideo),
  prepareSourceForSync: (video, targetTime, shouldPlay, ctx) =>
    ensureAnime1SourceReady(video, targetTime, shouldPlay, ctx),
  isPlaylistSupported: (loc) => {
    if (loc.search.includes('cat=')) return true;
    return Boolean(
      document.querySelector('.nav-previous a, .nav-next a, a[rel="prev"], a[rel="next"], .cat-links a')
    );
  },
  playlistClickSelector: '.nav-previous a, .nav-next a, a[rel="prev"], a[rel="next"], .cat-links a',
  playlistClickLabel: 'Anime1 Prev/Next Episode Click',
  enablePlayCaptureLock: true
};

export const bahamutAdapter: VideoPlatformAdapter = {
  id: 'bahamut',
  hostnames: ['gamer.com.tw'],
  findVideo: () =>
    pickBestNonAdVideo(
      Array.from(document.querySelectorAll('#ani_video_html5_api, #ani_video video.vjs-tech, video.vjs-tech')) as HTMLVideoElement[]
    ) || findGenericVideoElement(),
  isAdPlaying: () => {
    const aniRoot = document.getElementById('ani_video');
    if (aniRoot && aniRoot.classList.contains('vjs-ad-playing')) return true;
    const imaAdVideo = document.querySelector('.ima-ad-container video') as HTMLVideoElement | null;
    return Boolean(imaAdVideo && !imaAdVideo.paused && imaAdVideo.offsetWidth > 0);
  },
  isPlaylistSupported: () =>
    Boolean(
      document.querySelector('section.season, .ani-tabs, .season ul li, .ani-episode__item, .ani-control__btn--next')
    ),
  playlistClickSelector: 'section.season a, .ani-tabs a, .season ul li a, .ani-episode__item a, .ani-control__btn--next',
  playlistClickLabel: 'Bahamut Episode/Next Click'
};
