/**
 * Syncine 介面文字與參數設定檔
 * 集中管理面板 (Popup) 顯示之所有標題、提示、狀態文字與按鈕標籤
 * 未來若需調整文案或支援多語系 (i18n)，直接在此檔案修改即可
 */

export const APP_INFO = {
  NAME: 'Syncine (同映)',
  TAGLINE: '遠端影片同步播放 (Watch Party)',
  DEFAULT_VERSION: 'v2.1.1',
  /**
   * 自動取得當前 Chrome 擴充套件版本號，若無環境則回退至預設版本
   */
  getVersion(): string {
    if (typeof chrome !== 'undefined' && chrome?.runtime?.getManifest) {
      const manifestVersion = chrome.runtime.getManifest()?.version;
      if (manifestVersion) return `v${manifestVersion}`;
    }
    return this.DEFAULT_VERSION;
  },
  SUPPORTED_PLATFORMS: 'YouTube / Bilibili',
  ENGINE_LABEL: 'Syncine Engine • 支援 YouTube / Bilibili',
};

export const STATUS_TEXTS = {
  // 連線狀態文案
  CONNECTION: {
    RECONNECTING: '重新連線回魂中...',
    DISCONNECTED: '連線中斷等待中',
    READY: '同步服務已就緒',
  },
  // 橫幅警示訊息
  BANNERS: {
    RECONNECTING: '⚡ 偵測到網路波動，系統正持續嘗試自動重連回魂中...',
    DISCONNECTED: '⚠️ 與伺服器連線已中斷，正在等待網路恢復...',
  },
  // 使用者角色
  ROLES: {
    HOST: '👑 房主 (Host)',
    GUEST: '👀 觀眾 (Guest)',
  },
};

export const TAB_STATUS_TEXTS = {
  YOUTUBE_CONNECTED: '🎬 YouTube 影片分頁已連線',
  BILIBILI_CONNECTED: '📺 Bilibili 影片分頁已連線',
  NOT_SUPPORTED: '💡 請開啟 YouTube 或 Bilibili 網頁以進行同步觀影',
  SUPPORT_BADGE: '支援',
  SINGLE_TAB_HINT: '建議瀏覽器同時僅開啟一個支援的影片分頁，以避免同步干擾。',
  HINT_PREFIX: '💡 提示',
};

export const CONNECTION_MODE_TEXTS = {
  P2P: {
    SELECT_OPTION_CREATE: '⚡ 1. 純端對端直連 (WebRTC P2P - 不限人數)',
    SELECT_OPTION_JOIN: '⚡ 1. 純端對端直連 (WebRTC P2P)',
    CARD_TITLE: 'WebRTC P2P 統一邀請碼直連',
    CARD_BADGE: '不設人數上限',
    DESCRIPTION: '同一組邀請碼可發送給多位好友直接申請加入，房主收到通知後一鍵審核，全房即可透過加密星狀拓撲低延遲直連！',
    FALLBACK_HINT: '提示：若因嚴格防火牆或網路限制導致 P2P 連線失敗，可切換為「預設中繼伺服器」模式。',
    JOIN_FEEDBACK: '已選定 P2P 直連：貼入房主邀請碼，送出申請由房主審核直連。',
    PLACEHOLDER: '輸入房主提供的 P2P 邀請碼 (例如: 892301)',
    INPUT_HINT: '輸入房主分享的 6 碼代碼，送出申請後房主批准即可自動直連同步。',
    BTN_CREATE: '⚡ 建立 P2P 房間 (生成統一邀請碼)',
    FOOTER_LABEL: '⚡ WebRTC P2P 直連',
    ROOM_STATUS: 'P2P 直連中',
  },
  DEFAULT: {
    SELECT_OPTION: '2. 預設中繼伺服器 (官方中繼)',
    SERVER_STATUS_LABEL: '官方伺服器狀態:',
    SERVER_ONLINE: '線上就緒 (Fly.io)',
    SERVER_OFFLINE: '連線異常 (請檢查網路)',
    SERVER_PROBING: '連線探測中...',
    DESCRIPTION: '連線至官方中繼伺服器，提供穩定開箱即用的房間同步服務，適用於任何網路環境。',
    JOIN_FEEDBACK: '已選定官方中繼：透過官方中繼伺服器快速同步。',
    PLACEHOLDER: '輸入房主提供的 6 碼代碼 (例如: 892301)',
    INPUT_HINT: '輸入 6 碼代碼連線至官方中繼伺服器同步觀影。',
    BTN_CREATE: '🚀 立即建立房間',
    FOOTER_LABEL: '🏢 官方中繼',
    ROOM_STATUS: '中繼連線中',
  },
  CUSTOM_IP: {
    SELECT_OPTION: '3. 自行輸入 IP (自架主機 / LAN)',
    INPUT_LABEL: '自訂伺服器網址 / IP 位址:',
    INPUT_PLACEHOLDER: '例如: https://syncine.fly.dev 或 http://192.168.1.100:3000',
    JOIN_FEEDBACK: '已選定自架主機：貼入複合分享碼（如 IP:代碼|Base64）將自動對接。',
    PLACEHOLDER: '輸入房主自架複合碼 (例如: IP:892301|aHR0...)',
    INPUT_HINT: '支援複合分享碼，若房主使用自架伺服器，套件將自動切換對應 IP。',
    FOOTER_LABEL: '🌐 自架主機',
  },
};

export const ROOM_UI_TEXTS = {
  CREATE_TAB: '建立房間 (Host)',
  JOIN_TAB: '加入房間 (Guest)',
  CONNECTION_MODE_LABEL: '連線方式 (Connection Mode)',
  SWITCHABLE_HINT: '可即時切換',
  PASTE_CODE_LABEL: '貼入房間代碼 / 邀請碼',
  CREATING_ROOM: '正在建立房間...',
  JOINING_ROOM: '正在連線申請中...',
  BTN_JOIN: '🔑 申請加入房間 (Join Room)',
  ROOM_CODE_LABEL: '房間代碼 (邀請碼)',
  COPY_CODE: '複製邀請碼',
  COPIED_CODE: '已複製代碼！',
  MEMBERS_PREFIX: '房內成員:',
  AUTO_CALIBRATE_HINT: '(每30秒自動校準)',
  AUDIT_REQUEST_TITLE: '入房審核申請',
  AUDIT_WAITING_SUFFIX: '位等待中',
  APPROVE_ALL: '全部允許',
  APPROVE: '允許',
  REJECT: '拒絕',
  HOST_PERMISSION_TITLE: '房主權限管理',
  ALLOW_GUEST_CONTROL: '允許觀眾控制播放/暫停',
  FORCE_SYNC_TAB: '將全房觀眾跳轉至當前網頁',
  NEW_ROOM: '建立新房間',
  LEAVE_ROOM: '離開房間',
  AWAITING_TITLE: '入房申請已送出',
  AWAITING_DESC: '正在等待房主確認同意，房主批准後雙方將自動無縫連線開播！',
  CANCEL_AND_BACK: '✕ 取消申請並返回',
};
