import { SupportedLanguage } from './schema';
import { zhTW } from './zh-TW';
import { enUS } from './en-US';
import { jaJP } from './ja-JP';
import { zhCN } from './zh-CN';
import { detectBrowserLanguage } from './detector';
import { ReturnCode, LEGACY_STRING_TO_CODE } from './returnCodes';

const DICTIONARIES = {
  'zh-TW': zhTW,
  'en-US': enUS,
  'ja-JP': jaJP,
  'zh-CN': zhCN,
};

let cachedLanguage: SupportedLanguage = detectBrowserLanguage();

// 若在擴充套件環境，自動同步 chrome.storage.sync 變更
if (typeof chrome !== 'undefined' && chrome.storage?.sync) {
  chrome.storage.sync.get(['syncine_preferred_language'], (res) => {
    const val = res?.syncine_preferred_language as SupportedLanguage | undefined;
    if (val && DICTIONARIES[val]) {
      cachedLanguage = val;
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.syncine_preferred_language?.newValue) {
      const newLang = changes.syncine_preferred_language.newValue as SupportedLanguage;
      if (DICTIONARIES[newLang]) {
        cachedLanguage = newLang;
      }
    }
  });
}

/**
 * 適用於 Content Script、Offscreen 等非 React 元件層的獨立即時轉譯函式
 */
export function getStandaloneText(keyOrCode: ReturnCode | string, fallback?: string): string {
  const dict = DICTIONARIES[cachedLanguage] || DICTIONARIES['zh-TW'];

  if (dict.returnCodes[keyOrCode as keyof typeof dict.returnCodes]) {
    return dict.returnCodes[keyOrCode as keyof typeof dict.returnCodes];
  }

  const mapped = LEGACY_STRING_TO_CODE[keyOrCode];
  if (mapped && dict.returnCodes[mapped as keyof typeof dict.returnCodes]) {
    return dict.returnCodes[mapped as keyof typeof dict.returnCodes];
  }

  return fallback || keyOrCode;
}

export function getCurrentStandaloneLanguage(): SupportedLanguage {
  return cachedLanguage;
}
