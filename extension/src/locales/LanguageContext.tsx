import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { SupportedLanguage, TranslationSchema, SUPPORTED_LANGUAGES } from './schema';
import { zhTW } from './zh-TW';
import { enUS } from './en-US';
import { jaJP } from './ja-JP';
import { zhCN } from './zh-CN';
import { detectBrowserLanguage } from './detector';
import { LEGACY_STRING_TO_CODE, ReturnCode } from './returnCodes';

const DICTIONARIES: Record<SupportedLanguage, TranslationSchema> = {
  'zh-TW': zhTW,
  'en-US': enUS,
  'ja-JP': jaJP,
  'zh-CN': zhCN,
};

interface LanguageContextType {
  language: SupportedLanguage;
  t: TranslationSchema;
  setLanguage: (lang: SupportedLanguage) => void;
  translateReturnCode: (codeOrError?: string | null, fallback?: string) => string;
  isReady: boolean;
}

const LanguageContext = createContext<LanguageContextType | null>(null);

const STORAGE_KEY = 'syncine_preferred_language';

export const LanguageProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<SupportedLanguage>(() => {
    try {
      const local = localStorage.getItem(STORAGE_KEY) as SupportedLanguage | null;
      if (local && DICTIONARIES[local]) {
        return local;
      }
    } catch {}
    return detectBrowserLanguage();
  });
  const [isReady, setIsReady] = useState<boolean>(false);

  useEffect(() => {
    // 優先從 chrome.storage.local 讀取本機偏好，並回退至 chrome.storage.sync 跨裝置同步
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.get([STORAGE_KEY], (res) => {
        const stored = res?.[STORAGE_KEY] as SupportedLanguage | undefined;
        if (stored && DICTIONARIES[stored]) {
          setLanguageState(stored);
          try {
            localStorage.setItem(STORAGE_KEY, stored);
          } catch {}
          setIsReady(true);
          return;
        }

        // 若 local 尚未有紀錄，嘗試從 sync 讀取
        if (chrome.storage?.sync) {
          chrome.storage.sync.get([STORAGE_KEY], (syncRes) => {
            const storedSync = syncRes?.[STORAGE_KEY] as SupportedLanguage | undefined;
            if (storedSync && DICTIONARIES[storedSync]) {
              setLanguageState(storedSync);
              chrome.storage.local.set({ [STORAGE_KEY]: storedSync });
              try {
                localStorage.setItem(STORAGE_KEY, storedSync);
              } catch {}
            }
            setIsReady(true);
          });
        } else {
          setIsReady(true);
        }
      });
    } else {
      setIsReady(true);
    }
  }, []);

  const setLanguage = (newLang: SupportedLanguage) => {
    if (!DICTIONARIES[newLang]) return;
    setLanguageState(newLang);

    // 三重持久化防線：同步 localStorage (0延遲) + chrome.storage.local + chrome.storage.sync
    try {
      localStorage.setItem(STORAGE_KEY, newLang);
    } catch {}

    if (typeof chrome !== 'undefined') {
      chrome.storage?.local?.set({ [STORAGE_KEY]: newLang });
      chrome.storage?.sync?.set({ [STORAGE_KEY]: newLang });
    }
  };

  const currentDict = DICTIONARIES[language] || DICTIONARIES['zh-TW'];

  /**
   * 根據後端回傳的 ReturnCode 或舊版相容字串轉譯成當前語系文案
   */
  const translateReturnCode = (codeOrError?: string | null, fallback?: string): string => {
    if (!codeOrError) {
      return fallback || currentDict.returnCodes.ERR_UNKNOWN;
    }

    // 1. 若本身即為標準 ReturnCode
    const codeKey = codeOrError as keyof typeof currentDict.returnCodes;
    if (currentDict.returnCodes[codeKey]) {
      return currentDict.returnCodes[codeKey];
    }

    // 2. 若為舊版中文字串，查表轉換為標準代碼再進行轉譯
    const mappedCode = LEGACY_STRING_TO_CODE[codeOrError];
    if (mappedCode && currentDict.returnCodes[mappedCode as keyof typeof currentDict.returnCodes]) {
      return currentDict.returnCodes[mappedCode as keyof typeof currentDict.returnCodes];
    }

    // 3. 若提供 fallback 或原字串回退
    return fallback || codeOrError;
  };

  return (
    <LanguageContext.Provider
      value={{
        language,
        t: currentDict,
        setLanguage,
        translateReturnCode,
        isReady,
      }}
    >
      {children}
    </LanguageContext.Provider>
  );
};

export function useTranslation(): LanguageContextType {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useTranslation must be used within a LanguageProvider');
  }
  return context;
}
