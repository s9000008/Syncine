/**
 * Syncine 伺服器端資安工具函式
 */

/**
 * 日誌清毒輔助函式 (Log Sanitization)
 * 防禦 CRLF 日誌注入攻擊 (Log Injection / Log Forging) 與控制字元終端機跳脫攻擊
 * 
 * @param input 待記錄的使用者傳入字串或任意型別
 * @param maxLength 最大限制長度，防止日誌被超長字串灌爆 (預設 200 字元)
 * @returns 清理後的安全單行字串
 */
export function sanitizeLog(input: unknown, maxLength = 200): string {
  if (input === null || input === undefined) return '';

  let str: string;
  if (typeof input === 'object') {
    try {
      str = JSON.stringify(input);
    } catch {
      str = String(input);
    }
  } else {
    str = String(input);
  }

  // 1. 消除換行符 (\r, \n) 與 ASCII 控制字元 (0x00-0x1F, 0x7F-0x9F)
  // 2. 避免 HTML 標籤可能造成日誌儀表板 XSS
  return str
    .replace(/[\r\n\x00-\x1F\x7F-\x9F]/g, ' ')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .trim()
    .slice(0, maxLength);
}
