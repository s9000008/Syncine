import { zhTW } from './zh-TW';

export type TranslationSchema = typeof zhTW;
export type SupportedLanguage = 'zh-TW' | 'en-US' | 'ja-JP' | 'zh-CN';

export const SUPPORTED_LANGUAGES: { code: SupportedLanguage; label: string; nativeName: string; flag: string }[] = [
  { code: 'zh-TW', label: '繁體中文', nativeName: '繁體中文', flag: '🇹🇼' },
  { code: 'en-US', label: 'English', nativeName: 'English', flag: '🇺🇸' },
  { code: 'ja-JP', label: '日本語', nativeName: '日本語', flag: '🇯🇵' },
  { code: 'zh-CN', label: '简体中文', nativeName: '简体中文', flag: '🇨🇳' },
];
