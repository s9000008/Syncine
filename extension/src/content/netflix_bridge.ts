/**
 * Syncine Netflix Main World Bridge
 * 運行於 Netflix 頁面原生 MAIN 執行環境，直接調用 Netflix 內部 VideoPlayer API
 * 徹底解決直接修改 HTML5 video.currentTime 觸發 Netflix "Whoops, something went wrong" 報錯之問題
 */

// 獲取 Netflix 當前活躍之 VideoPlayer 實例
function getNetflixPlayer(): any {
  try {
    const netflixObj = (window as any).netflix;
    const videoPlayer = netflixObj?.appContext?.state?.playerApp?.getAPI?.()?.videoPlayer;
    if (!videoPlayer) return null;
    const sessionIds = videoPlayer.getAllPlayerSessionIds?.();
    if (!sessionIds || sessionIds.length === 0) return null;
    return videoPlayer.getVideoPlayerBySessionId(sessionIds[0]) || null;
  } catch (err) {
    return null;
  }
}

// 監聽來自 Syncine Content Script (Isolated World) 之自訂事件
window.addEventListener('SYNCINE_NETFLIX_CMD', (event: any) => {
  try {
    const detail = event?.detail;
    if (!detail || !detail.action) return;

    const player = getNetflixPlayer();
    if (!player) {
      console.warn('[Syncine Netflix Bridge] 尚未取得 Netflix VideoPlayer 實例');
      return;
    }

    switch (detail.action) {
      case 'SEEK': {
        if (typeof detail.currentTime === 'number') {
          // Netflix seek API 單位為毫秒 (ms)
          const targetMs = Math.max(0, Math.floor(detail.currentTime * 1000));
          player.seek(targetMs);
          console.log(`[Syncine Netflix Bridge] 成功調用 player.seek(${targetMs}ms)`);
        }
        break;
      }
      case 'PLAY': {
        if (typeof player.play === 'function') {
          player.play();
          console.log('[Syncine Netflix Bridge] 成功調用 player.play()');
        }
        break;
      }
      case 'PAUSE': {
        if (typeof player.pause === 'function') {
          player.pause();
          console.log('[Syncine Netflix Bridge] 成功調用 player.pause()');
        }
        break;
      }
    }
  } catch (err) {
    console.error('[Syncine Netflix Bridge] 執行指令異常:', err);
  }
});

console.log('[Syncine] Netflix Main World Bridge 已成功載入');
