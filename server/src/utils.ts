/**
 * Syncine 伺服器端資安工具函式
 */
export { sanitizeLog } from './shared/sanitize';

/**
 * 檢查當前 Node.js 執行期版本是否符合 CVE-2026-111497 (Brotli Out-of-bounds Write) 修復標準
 * 官方修復基準版本:
 * - Node 22.x: >= 22.23.4
 * - Node 24.x: >= 24.22.1
 * - Node 26.x: >= 26.12.1
 */
export function checkNodeSecurityVersion(versionString: string = process.versions.node): {
  isVulnerable: boolean;
  currentVersion: string;
  recommendation: string;
} {
  const cleanVer = versionString.startsWith('v') ? versionString.slice(1) : versionString;
  const parts = cleanVer.split('.').map((p) => parseInt(p, 10));
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

/**
 * 從 Socket 握手標頭安全提取客戶端來源 IP（優先採用 Fly/Reverse Proxy 單層前置 X-Forwarded-For）
 */
export function extractClientIp(
  forwardedHeader: string | string[] | undefined,
  remoteAddress: string | undefined
): string {
  const rawForwarded = Array.isArray(forwardedHeader) ? forwardedHeader[0] : forwardedHeader;
  const firstHop = rawForwarded ? rawForwarded.split(',')[0].trim() : '';
  const candidate = firstHop || (remoteAddress || '').trim();
  return candidate.replace(/^::ffff:/i, '') || 'unknown';
}
