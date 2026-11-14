/**
 * 判斷是否為串流平台前置/插播廣告之 <video> 元素 (如 Google IMA / Niconico / YouTube Ad)
 */
export function isAdVideoElement(v: HTMLVideoElement): boolean {
  try {
    return Boolean(
      v.closest(
        '.ima-ad-container, [id*="ad-container" i], [class*="ad-container" i], [class*="VideoAd"], #nv_watch_VideoAdContainer, .ytp-ad-player-overlay'
      )
    );
  } catch {
    return false;
  }
}

/**
 * 支援穿透開放式 Shadow DOM (Open ShadowRoot) 之深度 <video> 搜尋器
 */
export function queryAllVideosDeep(
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
  } catch {
    // 忽略跨來源或已卸載節點異常
  }
  return results;
}

export function pickBestNonAdVideo(candidates: HTMLVideoElement[]): HTMLVideoElement | null {
  const clean = candidates.filter((v) => v && !isAdVideoElement(v));
  if (clean.length === 0) return null;
  if (clean.length === 1) return clean[0];

  const playingVisible = clean.find((v) => !v.paused && v.offsetWidth > 0 && v.offsetHeight > 0);
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
    } catch {
      // 忽略計算樣式異常
    }
  }
  return bestVideo || clean[0];
}

/**
 * 標準影片的通用方案 (Generic HTML5 Video Fallback)
 */
export function findGenericVideoElement(): HTMLVideoElement | null {
  const videos = queryAllVideosDeep(document);
  if (videos.length === 0) return null;
  return pickBestNonAdVideo(videos);
}

/**
 * 瀏覽器自動播放政策 (Autoplay Policy) 彈性降級播放輔助函式
 */
export function safePlayVideo(video: HTMLVideoElement): void {
  if (!video.paused) return;
  video.play().catch((err) => {
    console.warn('[Syncine] video.play() 攔截 (受瀏覽器 Autoplay 政策限制):', err);
    video.muted = true;
    video
      .play()
      .then(() => {
        console.log('[Syncine] 由於瀏覽器 Autoplay 限制，已先自動靜音並開始播放，點擊頁面任意處即可開啟聲音');
        const unmute = () => {
          video.muted = false;
          window.removeEventListener('click', unmute);
          window.removeEventListener('keydown', unmute);
        };
        window.addEventListener('click', unmute, { once: true });
        window.addEventListener('keydown', unmute, { once: true });
      })
      .catch((e) => {
        console.error('[Syncine] 靜音播放仍然被攔截:', e);
      });
  });
}
