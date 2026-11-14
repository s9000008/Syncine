export const CHROME_STORE_URL =
  'https://chromewebstore.google.com/detail/syncine-%E5%90%8C%E6%98%A0-%E9%81%A0%E7%AB%AF%E5%BD%B1%E7%89%87%E5%90%8C%E6%AD%A5%E6%92%AD%E6%94%BE-watch/filebpdgpniidghnnepdndpfgbcgnkip';

// 屬於使用者輸入校驗或正常房間業務邏輯狀態之提示碼（非系統/網路故障，不顯示 GitHub Issue 回報與診斷複製按鈕）
export const NON_REPORTABLE_ERROR_CODES = new Set<string>([
  'ERR_AUDIT_REJECTED',
  'ERR_INVALID_CODE',
  'ERR_CUSTOM_IP_REQUIRED',
  'ERR_ROOM_NOT_FOUND',
  'ERR_ROOM_FULL',
  'ERR_ROOM_CLOSED',
  'ERR_PERMISSION_DENIED',
  'ERR_HOST_ONLY',
  'ERR_UNAUTHORIZED_URL'
]);

export type PlatformStatusKey =
  | 'youtubeConnected'
  | 'bilibiliConnected'
  | 'niconicoConnected'
  | 'anime1Connected'
  | 'netflixConnected'
  | 'vimeoConnected'
  | 'gamerConnected'
  | 'twitchConnected'
  | 'disneyConnected'
  | 'primeConnected'
  | 'myVideoConnected'
  | 'lineTvConnected'
  | 'kktvConnected'
  | 'crunchyrollConnected'
  | 'fridayConnected'
  | 'maxConnected'
  | 'iqiyiConnected'
  | 'appleTvConnected'
  | 'catchplayConnected';

export const PLATFORM_TAB_STATUS_KEY_MAP: Record<string, PlatformStatusKey> = {
  youtube: 'youtubeConnected',
  bilibili: 'bilibiliConnected',
  niconico: 'niconicoConnected',
  anime1: 'anime1Connected',
  netflix: 'netflixConnected',
  vimeo: 'vimeoConnected',
  gamer: 'gamerConnected',
  twitch: 'twitchConnected',
  disney: 'disneyConnected',
  prime: 'primeConnected',
  myvideo: 'myVideoConnected',
  linetv: 'lineTvConnected',
  kktv: 'kktvConnected',
  crunchyroll: 'crunchyrollConnected',
  friday: 'fridayConnected',
  max: 'maxConnected',
  iqiyi: 'iqiyiConnected',
  appletv: 'appleTvConnected',
  catchplay: 'catchplayConnected'
};
