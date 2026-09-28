import { SupportedLanguage } from './schema';

/**
 * 識別瀏覽器語系，預設使用瀏覽器預設
 * 優先序：
 * 1. chrome.i18n.getUILanguage()
 * 2. navigator.language
 * 規則：
 * - 包含 ja -> ja-JP (日本語)
 * - 包含 tw, hk, mo, hant -> zh-TW (繁體中文)
 * - 包含 zh (cn, sg, hans) -> zh-CN (简体中文)
 * - 其他/英文 -> en-US (English)
 */
export function detectBrowserLanguage(): SupportedLanguage {
  let raw = '';
  try {
    if (typeof chrome !== 'undefined' && chrome.i18n && typeof chrome.i18n.getUILanguage === 'function') {
      raw = chrome.i18n.getUILanguage();
    }
  } catch (e) {
    // 忽略在非 Extension 隔離環境時的錯誤
  }

  if (!raw && typeof navigator !== 'undefined' && navigator.language) {
    raw = navigator.language;
  }

  if (!raw) return 'en-US';

  const lower = raw.toLowerCase();

  // 1. 日語識別
  if (lower.startsWith('ja')) {
    return 'ja-JP';
  }

  // 2. 中文體系區分繁中與簡中
  if (lower.startsWith('zh')) {
    if (
      lower.includes('tw') ||
      lower.includes('hk') ||
      lower.includes('mo') ||
      lower.includes('hant')
    ) {
      return 'zh-TW';
    }
    return 'zh-CN';
  }

  // 3. 其他語系預設英文
  return 'en-US';
}
