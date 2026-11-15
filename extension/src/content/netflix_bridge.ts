/**
 * Syncine Netflix Main World Bridge
 * 運行於 Netflix 頁面原生 MAIN 執行環境，直接調用 Netflix 內部 VideoPlayer API
 * 徹底解決直接修改 HTML5 video.currentTime 觸發 Netflix "Whoops, something went wrong" 報錯之問題
 */

// 獲取 Netflix 當前活躍之 VideoPlayer 實例 (優先鎖定 watch* 觀看工作階段與最新建立之播放器，避免誤綁 /browse 預覽殘留 session)
function getNetflixPlayer(): any {
  try {
    const netflixObj = (window as any).netflix;
    const videoPlayer = netflixObj?.appContext?.state?.playerApp?.getAPI?.()?.videoPlayer;
    if (!videoPlayer) return null;
    const sessionIds: string[] = videoPlayer.getAllPlayerSessionIds?.();
    if (!sessionIds || sessionIds.length === 0) return null;
    const activeSessionId =
      sessionIds.filter((id) => typeof id === 'string' && id.startsWith('watch')).pop() ||
      sessionIds[sessionIds.length - 1];
    return videoPlayer.getVideoPlayerBySessionId(activeSessionId) || null;
  } catch (err) {
    return null;
  }
}

function parseNetflixBridgeDetail(event: any): any {
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

// 監聽來自 Syncine Content Script (Isolated World) 之自訂事件
// 若擴充套件更新重新注入，先卸載舊有監聽器避免重複觸發
const prevNfHandler = (window as any).__syncineNfBridgeHandler;
if (typeof prevNfHandler === 'function') {
  window.removeEventListener('SYNCINE_NETFLIX_CMD', prevNfHandler);
}

const handleNetflixBridgeCommand = (event: any) => {
  try {
    const detail = parseNetflixBridgeDetail(event);
    if (!detail || !detail.action) return;

    const player = getNetflixPlayer();
    if (!player) {
      document.documentElement.dataset.syncineNfHandled = '0';
      console.warn('[Syncine Netflix Bridge] 尚未取得 Netflix VideoPlayer 實例');
      return;
    }

    switch (detail.action) {
      case 'SEEK': {
        if (typeof detail.currentTime === 'number') {
          // Netflix seek API 單位為毫秒 (ms)
          const targetMs = Math.max(0, Math.floor(detail.currentTime * 1000));
          player.seek(targetMs);
          document.documentElement.dataset.syncineNfHandled = '1';
          console.log(`[Syncine Netflix Bridge] 成功調用 player.seek(${targetMs}ms)`);
        }
        break;
      }
      case 'PLAY': {
        if (typeof player.play === 'function') {
          player.play();
          document.documentElement.dataset.syncineNfHandled = '1';
          console.log('[Syncine Netflix Bridge] 成功調用 player.play()');
        }
        break;
      }
      case 'PAUSE': {
        if (typeof player.pause === 'function') {
          player.pause();
          document.documentElement.dataset.syncineNfHandled = '1';
          console.log('[Syncine Netflix Bridge] 成功調用 player.pause()');
        }
        break;
      }
    }
  } catch (err) {
    document.documentElement.dataset.syncineNfHandled = '0';
    console.error('[Syncine Netflix Bridge] 執行指令異常:', err);
  }
};

(window as any).__syncineNfBridgeHandler = handleNetflixBridgeCommand;
window.addEventListener('SYNCINE_NETFLIX_CMD', handleNetflixBridgeCommand);

console.log('[Syncine] Netflix Main World Bridge 已成功載入');
