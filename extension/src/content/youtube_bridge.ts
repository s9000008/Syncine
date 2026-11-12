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

// 監聽來自 Syncine Content Script (Isolated World) 之自訂控制事件
window.addEventListener('SYNCINE_YOUTUBE_CMD', (event: any) => {
  try {
    const detail = event?.detail;
    if (!detail || !detail.action) return;

    const player = getYouTubePlayer();
    if (!player) {
      document.documentElement.dataset.syncineYtHandled = '0';
      return;
    }

    switch (detail.action) {
      case 'SEEK': {
        if (typeof detail.currentTime === 'number' && typeof player.seekTo === 'function') {
          // 第二個參數 allowSeekAhead: true，強制 YouTube 向伺服器請求目標位置之影音分片並即時跳轉
          player.seekTo(detail.currentTime, true);
          document.documentElement.dataset.syncineYtHandled = '1';
        }
        break;
      }
      case 'PLAY': {
        if (typeof player.playVideo === 'function') {
          player.playVideo();
          document.documentElement.dataset.syncineYtHandled = '1';
        }
        break;
      }
      case 'PAUSE': {
        if (typeof player.pauseVideo === 'function') {
          player.pauseVideo();
          document.documentElement.dataset.syncineYtHandled = '1';
        }
        break;
      }
      case 'RATE': {
        if (typeof detail.playbackRate === 'number' && typeof player.setPlaybackRate === 'function') {
          player.setPlaybackRate(detail.playbackRate);
          document.documentElement.dataset.syncineYtHandled = '1';
        }
        break;
      }
    }
  } catch (err) {
    document.documentElement.dataset.syncineYtHandled = '0';
    console.error('[Syncine YouTube Bridge] 執行指令異常:', err);
  }
});

console.log('[Syncine] YouTube Main World Bridge 已成功載入');
