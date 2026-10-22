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

/**
 * 檢查當前 Node.js 執行期版本是否符合 CVE-2026-111497 (Brotli Out-of-bounds Write) 修復標準
 * 官方修復基準版本:
 * - Node 22.x: >= 22.23.4
 * - Node 24.x: >= 24.22.1
 * - Node 26.x: >= 26.12.1
 * 
 * @param versionString 例如 "26.4.0" 或 "22.23.4"
 * @returns { isVulnerable: boolean, currentVersion: string, recommendation: string }
 */
export function checkNodeSecurityVersion(versionString: string = process.versions.node): {
  isVulnerable: boolean;
  currentVersion: string;
  recommendation: string;
} {
  const cleanVer = versionString.startsWith('v') ? versionString.slice(1) : versionString;
  const parts = cleanVer.split('.').map(p => parseInt(p, 10));
  const major = parts[0] || 0;
  const minor = parts[1] || 0;
  const patch = parts[2] || 0;

  let isVulnerable = false;
  let recommendation = '';

  if (major === 22) {
    if (minor < 23 || (minor === 23 && patch < 4)) {
      isVulnerable = true;
      recommendation = '建議升級至 Node.js >= 22.23.4';
    }
  } else if (major === 24) {
    if (minor < 22 || (minor === 22 && patch < 1)) {
      isVulnerable = true;
      recommendation = '建議升級至 Node.js >= 24.22.1';
    }
  } else if (major === 26) {
    if (minor < 12 || (minor === 12 && patch < 1)) {
      isVulnerable = true;
      recommendation = '建議升級至 Node.js >= 26.12.1';
    }
  } else if (major < 22) {
    isVulnerable = true;
    recommendation = '建議升級至維護中之修復版本 (>= 22.23.4, >= 24.22.1 或 >= 26.12.1)';
  }

  return {
    isVulnerable,
    currentVersion: cleanVer,
    recommendation
  };
}
