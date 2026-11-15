import { ExtensionMessage } from '../../types/protocol';

let creatingOffscreen: Promise<void> | null = null;

export async function ensureOffscreenDocument(): Promise<void> {
  if (typeof chrome === 'undefined' || !(chrome as any).offscreen) return;

  const offscreenUrl = 'src/offscreen/index.html';
  if ((chrome as any).offscreen.hasDocument) {
    const hasDoc = await (chrome as any).offscreen.hasDocument();
    if (hasDoc) return;
  }

  if (creatingOffscreen) {
    await creatingOffscreen;
    return;
  }

  try {
    creatingOffscreen = (chrome as any).offscreen.createDocument({
      url: offscreenUrl,
      reasons: [(chrome as any).offscreen.Reason.WEB_RTC],
      justification: 'WebRTC P2P DataChannel connection for Syncine sync'
    });
    await creatingOffscreen;
    creatingOffscreen = null;
    // 首次建立 Offscreen Document 時，預留模組腳本解析與註冊 onMessage 監聽器之緩衝時間
    await new Promise((resolve) => setTimeout(resolve, 60));
    console.log('[Background] 成功建立 Offscreen Document');
  } catch (err: any) {
    creatingOffscreen = null;
    if (!err?.message?.includes('Only a single offscreen document may be created')) {
      console.warn('[Background] 建立 Offscreen Document 警告:', err);
    }
  }
}

/**
 * 安全向 Offscreen Document 發送訊息並處理冷啟動重試，徹底消除首次執行時 Unchecked runtime.lastError 異常
 */
export async function sendOffscreenMessage(
  message: ExtensionMessage,
  maxRetries = 6,
  retryDelayMs = 80
): Promise<any> {
  await ensureOffscreenDocument();
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
    return undefined;
  }

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await new Promise<{ ok: boolean; response?: any; error?: string }>((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (res) => {
          const lastErr = chrome.runtime.lastError;
          if (lastErr) {
            resolve({ ok: false, error: lastErr.message });
          } else {
            resolve({ ok: true, response: res });
          }
        });
      } catch (err: any) {
        resolve({ ok: false, error: err?.message || 'SEND_FAILED' });
      }
    });

    if (result.ok && result.response !== undefined) {
      return result.response;
    }

    if (attempt < maxRetries) {
      await new Promise((r) => setTimeout(r, retryDelayMs));
    } else if (result.ok) {
      return result.response;
    }
  }
  return undefined;
}

export async function closeOffscreenDocument(): Promise<void> {
  if (typeof chrome === 'undefined' || !(chrome as any).offscreen) return;

  try {
    if ((chrome as any).offscreen.hasDocument) {
      const hasDoc = await (chrome as any).offscreen.hasDocument();
      if (!hasDoc) return;
    }
    await (chrome as any).offscreen.closeDocument();
    console.log('[Background] Offscreen Document 已關閉');
  } catch {
    // 忽略關閉錯誤
  }
}
