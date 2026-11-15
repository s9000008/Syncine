/**
 * Syncine YouTube Main World Bridge
 * 運行於 YouTube 頁面原生 MAIN 執行環境，直接調用 YouTube 內部 #movie_player API
 * 徹底解決 Content Script (Isolated World) 直接操作 HTML5 <video> 元素時
 * 受限於 YouTube DASH/MSE 緩衝機制、Autoplay 政策與播放器狀態同步遲滯之問題
 */

function getYouTubePlayer(): any {
  try {
    return document.getElementById('movie_player') || null;
  } catch (_) {
    return null;
  }
}

function getYouTubeVideoElement(): HTMLVideoElement | null {
  try {
    return (
      (document.querySelector('#movie_player video.html5-main-video') as HTMLVideoElement) ||
      (document.querySelector('video.html5-main-video') as HTMLVideoElement) ||
      (document.querySelector('video') as HTMLVideoElement) ||
      null
    );
  } catch (_) {
    return null;
  }
}

function parseBridgeDetail(event: any): any {
  const fromEvent = event?.detail;
  if (fromEvent && typeof fromEvent === 'object' && fromEvent.action) {
    return fromEvent;
  }
  const rawCmd = document.documentElement?.dataset?.syncineBridgeCmd;
  if (rawCmd) {
    try {
      return JSON.parse(rawCmd);
    } catch (_) {
      return null;
    }
  }
  return null;
}

// 監聽來自 Syncine Content Script (Isolated World) 之自訂控制事件
// 若擴充套件更新重新注入，先卸載舊有監聽器避免重複觸發
const prevYtHandler = (window as any).__syncineYtBridgeHandler;
if (typeof prevYtHandler === 'function') {
  window.removeEventListener('SYNCINE_YOUTUBE_CMD', prevYtHandler);
}

const handleYouTubeBridgeCommand = (event: any) => {
  try {
    const detail = parseBridgeDetail(event);
    if (!detail || !detail.action) return;

    const player = getYouTubePlayer();
    const video = getYouTubeVideoElement();
    if (!player && !video) {
      document.documentElement.dataset.syncineYtHandled = '0';
      return;
    }

    switch (detail.action) {
      case 'SEEK': {
        if (typeof detail.currentTime === 'number') {
          let handled = false;
          if (player && typeof player.seekTo === 'function') {
            // 第二個參數 allowSeekAhead: true，強制 YouTube 向伺服器請求目標位置之影音分片並即時跳轉
            player.seekTo(detail.currentTime, true);
            handled = true;
          }
          if (video && Math.abs(video.currentTime - detail.currentTime) > 0.5) {
            try {
              video.currentTime = detail.currentTime;
              handled = true;
            } catch (_) {}
          }
          if (handled) {
            document.documentElement.dataset.syncineYtHandled = '1';
          }
        }
        break;
      }
      case 'PLAY': {
        let handled = false;
        if (player && typeof player.playVideo === 'function') {
          player.playVideo();
          handled = true;
        }
        if (video && video.paused) {
          try {
            const p = video.play();
            if (p && typeof p.catch === 'function') p.catch(() => {});
            handled = true;
          } catch (_) {}
        }
        if (handled) {
          document.documentElement.dataset.syncineYtHandled = '1';
        }
        break;
      }
      case 'PAUSE': {
        let handled = false;
        if (player && typeof player.pauseVideo === 'function') {
          player.pauseVideo();
          handled = true;
        }
        if (video && !video.paused) {
          try {
            video.pause();
            handled = true;
          } catch (_) {}
        }
        if (handled) {
          document.documentElement.dataset.syncineYtHandled = '1';
        }
        break;
      }
      case 'RATE': {
        if (typeof detail.playbackRate === 'number') {
          if (player && typeof player.setPlaybackRate === 'function') {
            player.setPlaybackRate(detail.playbackRate);
            document.documentElement.dataset.syncineYtHandled = '1';
          }
          if (video && Math.abs(video.playbackRate - detail.playbackRate) > 0.01) {
            try {
              video.playbackRate = detail.playbackRate;
            } catch (_) {}
          }
        }
        break;
      }
    }
  } catch (err) {
    document.documentElement.dataset.syncineYtHandled = '0';
    console.error('[Syncine YouTube Bridge] 執行指令異常:', err);
  }
};

(window as any).__syncineYtBridgeHandler = handleYouTubeBridgeCommand;
window.addEventListener('SYNCINE_YOUTUBE_CMD', handleYouTubeBridgeCommand);

console.log('[Syncine] YouTube Main World Bridge 已成功載入');
