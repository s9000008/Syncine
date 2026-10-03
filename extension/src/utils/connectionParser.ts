import { ConnectionMode, ParsedConnectionInfo, DetectedShareCodeType } from '../types/protocol';
import { DEFAULT_SERVER_URL } from '../config';

/**
 * 安全 Base64 編碼，支援 Browser 與 Node.js 執行環境
 */
export function safeBase64Encode(text: string): string {
  try {
    if (typeof btoa === 'function') {
      return btoa(encodeURIComponent(text).replace(/%([0-9A-F]{2})/g, (_, p1) => String.fromCharCode(parseInt(p1, 16))));
    }
    const gBuffer = (globalThis as any)?.Buffer;
    if (gBuffer) {
      return gBuffer.from(text, 'utf-8').toString('base64');
    }
  } catch (err) {
    console.error('[ConnectionParser] Base64 編碼失敗:', err);
  }
  return text;
}

/**
 * 安全 Base64 解碼，支援 Browser 與 Node.js 執行環境
 */
export function safeBase64Decode(base64Text: string): string {
  try {
    if (typeof atob === 'function') {
      return decodeURIComponent(
        Array.prototype.map
          .call(atob(base64Text), (c: string) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
          .join('')
      );
    }
    const gBuffer = (globalThis as any)?.Buffer;
    if (gBuffer) {
      return gBuffer.from(base64Text, 'base64').toString('utf-8');
    }
  } catch (err) {
    console.warn('[ConnectionParser] Base64 解碼失敗:', err);
  }
  return '';
}

/**
 * 解析任意版本之房間代碼或複合分享碼 (全版本向下相容)
 * 
 * 支援格式：
 * 1. 新版 P2P 直連: P2P:X7A9B2
 * 2. 新版 預設伺服器: DEF:X7A9B2|Base64(URL) 或 DEF:X7A9B2
 * 3. 新版/自架主機: IP:X7A9B2|Base64(URL)
 * 4. 舊版 複合分享碼: X7A9B2|Base64(URL) (自動依網址判定 DEFAULT 或 CUSTOM_IP)
 * 5. 舊版 純 6 碼英數: X7A9B2 (尊重當前 UI 選擇之 fallbackMode)
 */
export function parseConnectionCode(
  inputCode: string,
  fallbackMode: ConnectionMode = 'P2P',
  defaultServerUrl: string = DEFAULT_SERVER_URL
): ParsedConnectionInfo {
  const trimmed = (inputCode || '').trim();
  if (!trimmed) {
    return {
      roomId: '',
      mode: fallbackMode,
      serverUrl: defaultServerUrl,
      isLegacy: false,
      detectedType: 'LEGACY_RAW'
    };
  }

  let mode: ConnectionMode = fallbackMode;
  let rawBody = trimmed;
  let isLegacy = false;
  let detectedType: DetectedShareCodeType = 'LEGACY_RAW';

  const upper = trimmed.toUpperCase();

  // 1. 權威前綴優先檢查 (大小寫不拘)
  if (upper.startsWith('P2P:')) {
    mode = 'P2P';
    rawBody = trimmed.substring(4).trim();
    isLegacy = false;
    detectedType = 'P2P';
  } else if (upper.startsWith('DEF:')) {
    mode = 'DEFAULT';
    rawBody = trimmed.substring(4).trim();
    isLegacy = false;
    detectedType = 'DEFAULT';
  } else if (upper.startsWith('IP:')) {
    mode = 'CUSTOM_IP';
    rawBody = trimmed.substring(3).trim();
    isLegacy = false;
    detectedType = 'CUSTOM_IP';
  } else if (trimmed.includes('|')) {
    // 2. 舊版複合分享碼 (無前綴但包含管道符號 |)
    isLegacy = true;
    detectedType = 'LEGACY_COMPOSITE';
  } else {
    // 3. 舊版純代碼 (無前綴亦無管道符號)
    isLegacy = true;
    detectedType = 'LEGACY_RAW';
    mode = fallbackMode;
  }

  // 4. 解析管道符號與 Base64 伺服器網址
  let roomId = rawBody;
  let serverUrl = mode === 'CUSTOM_IP' ? '' : defaultServerUrl;

  if (rawBody.includes('|')) {
    const [partRoomId, base64Url] = rawBody.split('|');
    roomId = (partRoomId || '').trim();
    if (base64Url) {
      const decoded = safeBase64Decode(base64Url.trim());
      if (decoded && (decoded.startsWith('http://') || decoded.startsWith('https://'))) {
        serverUrl = decoded;
        // 若為舊版無前綴複合碼，動態比對目標網址是否為預設伺服器
        if (detectedType === 'LEGACY_COMPOSITE') {
          const isDefault = 
            decoded === defaultServerUrl || 
            decoded.replace(/\/$/, '') === defaultServerUrl.replace(/\/$/, '');
          mode = isDefault ? 'DEFAULT' : 'CUSTOM_IP';
        }
      }
    }
  }

  // 乾淨 6 碼大寫 Room ID，防止冒號或不規則字元滲入
  const cleanRoomId = roomId.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

  return {
    roomId: cleanRoomId,
    mode,
    serverUrl: serverUrl || defaultServerUrl,
    isLegacy,
    detectedType
  };
}

/**
 * 依照指定連線模式格式化出權威自描述分享碼
 */
export function formatShareCode(
  mode: ConnectionMode,
  roomId: string,
  serverUrl?: string,
  defaultServerUrl: string = DEFAULT_SERVER_URL
): string {
  const cleanRoomId = (roomId || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  const targetServerUrl = serverUrl || defaultServerUrl;

  switch (mode) {
    case 'P2P':
      return `P2P:${cleanRoomId}`;
    case 'CUSTOM_IP': {
      const b64 = safeBase64Encode(targetServerUrl);
      return `IP:${cleanRoomId}|${b64}`;
    }
    case 'DEFAULT':
    default: {
      const b64 = safeBase64Encode(targetServerUrl);
      return `DEF:${cleanRoomId}|${b64}`;
    }
  }
}
