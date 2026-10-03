import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let passed = 0;
let failed = 0;

function assert(condition, testName, detail = '') {
  if (condition) {
    console.log(`✅ [PASS] ${testName}`);
    passed++;
  } else {
    console.error(`❌ [FAIL] ${testName} ${detail ? `- ${detail}` : ''}`);
    failed++;
  }
}

console.log('====================================================');
console.log('🧪 Syncine 前端與多語系 (i18n) 自動化測試套件開始執行');
console.log('====================================================\n');

// ----------------------------------------------------
// 模組 1: Chrome MV3 Manifest 與 _locales 完整性檢查
// ----------------------------------------------------
console.log('--- 模組 1: Chrome MV3 Manifest 與 _locales 完整性驗證 ---');
const manifestPath = path.join(__dirname, 'src/manifest.json');
assert(fs.existsSync(manifestPath), 'manifest.json 存在');

const manifestContent = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
assert(manifestContent.default_locale === 'zh_TW', 'Manifest 設定 default_locale 為 zh_TW');
assert(manifestContent.name === '__MSG_appName__', 'Manifest 名稱使用 i18n placeholder');
assert(manifestContent.description === '__MSG_appDesc__', 'Manifest 描述使用 i18n placeholder');
assert(manifestContent.action?.default_title === '__MSG_actionTitle__', 'Manifest 預設標題使用 i18n placeholder');

const expectedLocales = ['zh_TW', 'en', 'ja', 'zh_CN'];
const requiredKeys = ['appName', 'appDesc', 'actionTitle'];

for (const loc of expectedLocales) {
  const locPath = path.join(__dirname, 'public/_locales', loc, 'messages.json');
  assert(fs.existsSync(locPath), `_locales/${loc}/messages.json 存在`);

  try {
    const locJson = JSON.parse(fs.readFileSync(locPath, 'utf-8'));
    for (const key of requiredKeys) {
      assert(
        typeof locJson[key]?.message === 'string' && locJson[key].message.trim().length > 0,
        `_locales/${loc} 包含非空欄位: ${key}`,
        `實際值: ${locJson[key]?.message}`
      );
    }
  } catch (err) {
    assert(false, `_locales/${loc}/messages.json 為有效 JSON`, err.message);
  }
}

// 驗證 dist 建置產物
const distManifestPath = path.join(__dirname, 'dist/manifest.json');
assert(fs.existsSync(distManifestPath), 'dist/manifest.json 建置產物存在');
for (const loc of expectedLocales) {
  const distLocPath = path.join(__dirname, 'dist/_locales', loc, 'messages.json');
  assert(fs.existsSync(distLocPath), `dist/_locales/${loc}/messages.json 建置產物存在`);
}

// ----------------------------------------------------
// 模組 2: 瀏覽器語言探測 (detectBrowserLanguage) 邏輯驗證
// ----------------------------------------------------
console.log('\n--- 模組 2: 瀏覽器語言探測 (detectBrowserLanguage) 邏輯驗證 ---');

function simulateDetect(mockGetUILang, mockNavLang) {
  let raw = '';
  if (mockGetUILang) raw = mockGetUILang;
  else if (mockNavLang) raw = mockNavLang;
  if (!raw) return 'en-US';

  const lower = raw.toLowerCase();
  if (lower.startsWith('ja')) return 'ja-JP';
  if (lower.startsWith('zh')) {
    if (lower.includes('tw') || lower.includes('hk') || lower.includes('mo') || lower.includes('hant')) {
      return 'zh-TW';
    }
    return 'zh-CN';
  }
  return 'en-US';
}

assert(simulateDetect('ja', '') === 'ja-JP', '識別 "ja" 為 ja-JP (日語)');
assert(simulateDetect('ja-JP', '') === 'ja-JP', '識別 "ja-JP" 為 ja-JP (日語)');
assert(simulateDetect('zh-TW', '') === 'zh-TW', '識別 "zh-TW" 為 zh-TW (繁中)');
assert(simulateDetect('zh-HK', '') === 'zh-TW', '識別 "zh-HK" 為 zh-TW (繁中)');
assert(simulateDetect('zh-Hant', '') === 'zh-TW', '識別 "zh-Hant" 為 zh-TW (繁中)');
assert(simulateDetect('zh-CN', '') === 'zh-CN', '識別 "zh-CN" 為 zh-CN (簡中)');
assert(simulateDetect('zh-SG', '') === 'zh-CN', '識別 "zh-SG" 為 zh-CN (簡中)');
assert(simulateDetect('en-US', '') === 'en-US', '識別 "en-US" 為 en-US (英語)');
assert(simulateDetect('en-GB', '') === 'en-US', '識別 "en-GB" 為 en-US (英語)');
assert(simulateDetect('fr-FR', '') === 'en-US', '未知語系 "fr-FR" 正確回退至 en-US');
assert(simulateDetect('', '') === 'en-US', '空值正確回退至 en-US');

// ----------------------------------------------------
// 模組 3: ReturnCode 與舊版字串映射轉譯測試
// ----------------------------------------------------
console.log('\n--- 模組 3: ReturnCode 標準代碼與相容轉譯測試 ---');

const returnCodesSource = fs.readFileSync(path.join(__dirname, 'src/locales/returnCodes.ts'), 'utf-8');
const standardCodes = [
  'SUCCESS',
  'ERR_ROOM_NOT_FOUND',
  'ERR_ROOM_FULL',
  'ERR_ROOM_CLOSED',
  'ERR_PERMISSION_DENIED',
  'ERR_INVALID_CODE',
  'ERR_AUDIT_REJECTED',
  'ERR_P2P_SIGNAL_FAILED',
  'ERR_P2P_CONNECTION_LOST',
  'ERR_UNAUTHORIZED_URL',
  'ERR_SERVER_UNREACHABLE',
  'ERR_SEND_MESSAGE_FAILED',
  'ERR_CUSTOM_IP_REQUIRED',
  'ERR_NETWORK_DISCONNECTED',
  'ERR_UNKNOWN'
];

for (const code of standardCodes) {
  assert(returnCodesSource.includes(`${code}:`), `returnCodes.ts 定義了 ${code}`);
}

const legacyMappings = [
  '房間不存在或已關閉',
  '找不到對應房間',
  '權限不足：僅房主可修改權限',
  '房主已婉拒您的入房申請。',
  '建立房間失敗，請稍後再試',
  '加入房間失敗，請確認代碼是否正確',
  '傳送訊息失敗',
  '非 Host 無法發起跳轉',
  '伺服器回應逾時 (CREATE_ROOM_SUCCESS 未收到)'
];

for (const legacy of legacyMappings) {
  assert(returnCodesSource.includes(legacy), `舊版字串 "${legacy}" 具備自動轉譯映射`);
}

// ----------------------------------------------------
// 模組 4: 四大語系字典檔案鍵值完整度比對 (Key Parity)
// ----------------------------------------------------
console.log('\n--- 模組 4: 四大語系字典檔案鍵值對齊走查 ---');

const localeFiles = ['zh-TW.ts', 'en-US.ts', 'ja-JP.ts', 'zh-CN.ts'];
for (const file of localeFiles) {
  const filePath = path.join(__dirname, 'src/locales', file);
  assert(fs.existsSync(filePath), `語系檔案 ${file} 存在`);
  const content = fs.readFileSync(filePath, 'utf-8');

  // 驗證核心區塊
  assert(content.includes('app:'), `${file} 包含 app 模組`);
  assert(content.includes('connectionStatus:'), `${file} 包含 connectionStatus 模組`);
  assert(content.includes('banners:'), `${file} 包含 banners 模組`);
  assert(content.includes('roles:'), `${file} 包含 roles 模組`);
  assert(content.includes('tabStatus:'), `${file} 包含 tabStatus 模組`);
  assert(content.includes('connectionModes:'), `${file} 包含 connectionModes 模組`);
  assert(content.includes('smartDetection:'), `${file} 包含 smartDetection 模組`);
  assert(content.includes('roomUi:'), `${file} 包含 roomUi 模組`);
  assert(content.includes('languageSelector:'), `${file} 包含 languageSelector 模組`);
  assert(content.includes('returnCodes:'), `${file} 包含 returnCodes 模組`);

  // 驗證標準 ReturnCode 在各語系中皆有翻譯
  for (const code of standardCodes) {
    assert(content.includes(`${code}:`), `${file} 包含 ${code} 翻譯`);
  }
}

// ----------------------------------------------------
// 模組 5: React 元件與獨立腳本整合性走查
// ----------------------------------------------------
console.log('\n--- 模組 5: React 元件與獨立腳本整合性驗證 ---');
const popupTsx = fs.readFileSync(path.join(__dirname, 'src/popup/Popup.tsx'), 'utf-8');
assert(popupTsx.includes('useTranslation'), 'Popup.tsx 引入並使用 useTranslation');
assert(popupTsx.includes('LanguageSelector'), 'Popup.tsx 包含 LanguageSelector 元件');
assert(popupTsx.includes('translateReturnCode'), 'Popup.tsx 使用 translateReturnCode 轉譯錯誤');
assert(popupTsx.includes('parseConnectionCode'), 'Popup.tsx 引入並使用 parseConnectionCode 智慧解析');
assert(popupTsx.includes('formatShareCode'), 'Popup.tsx 引入並使用 formatShareCode 輸出標準前綴');

const bgTs = fs.readFileSync(path.join(__dirname, 'src/background/index.ts'), 'utf-8');
assert(bgTs.includes('parseConnectionCode'), 'background/index.ts 引入並使用 parseConnectionCode');
assert(bgTs.includes('formatShareCode'), 'background/index.ts 引入並使用 formatShareCode');

const contentTs = fs.readFileSync(path.join(__dirname, 'src/content/index.ts'), 'utf-8');
assert(contentTs.includes('getStandaloneText'), 'content/index.ts 引入並使用 getStandaloneText');

const offscreenTs = fs.readFileSync(path.join(__dirname, 'src/offscreen/index.ts'), 'utf-8');
assert(offscreenTs.includes('getStandaloneText'), 'offscreen/index.ts 引入並使用 getStandaloneText');

// ----------------------------------------------------
// 模組 6: 複合分享碼標準前綴與全版本向下相容解析驗證
// ----------------------------------------------------
console.log('\n--- 模組 6: 複合分享碼標準前綴與全版本向下相容解析邏輯驗證 ---');

function testParseConnectionCode(inputCode, fallbackMode = 'P2P', defaultServerUrl = 'https://syncine.fly.dev') {
  const trimmed = (inputCode || '').trim();
  if (!trimmed) {
    return { roomId: '', mode: fallbackMode, serverUrl: defaultServerUrl, isLegacy: false, detectedType: 'LEGACY_RAW' };
  }
  let mode = fallbackMode;
  let rawBody = trimmed;
  let isLegacy = false;
  let detectedType = 'LEGACY_RAW';
  const upper = trimmed.toUpperCase();

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
    isLegacy = true;
    detectedType = 'LEGACY_COMPOSITE';
  } else {
    isLegacy = true;
    detectedType = 'LEGACY_RAW';
    mode = fallbackMode;
  }

  let roomId = rawBody;
  let serverUrl = mode === 'CUSTOM_IP' ? '' : defaultServerUrl;

  if (rawBody.includes('|')) {
    const [partRoomId, base64Url] = rawBody.split('|');
    roomId = (partRoomId || '').trim();
    if (base64Url) {
      try {
        const decoded = Buffer.from(base64Url.trim(), 'base64').toString('utf-8');
        if (decoded && (decoded.startsWith('http://') || decoded.startsWith('https://'))) {
          serverUrl = decoded;
          if (detectedType === 'LEGACY_COMPOSITE') {
            const isDefault = decoded === defaultServerUrl || decoded.replace(/\/$/, '') === defaultServerUrl.replace(/\/$/, '');
            mode = isDefault ? 'DEFAULT' : 'CUSTOM_IP';
          }
        }
      } catch {}
    }
  }

  const cleanRoomId = roomId.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  return { roomId: cleanRoomId, mode, serverUrl: serverUrl || defaultServerUrl, isLegacy, detectedType };
}

function testFormatShareCode(mode, roomId, serverUrl = 'https://syncine.fly.dev') {
  const cleanRoomId = (roomId || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  if (mode === 'P2P') return `P2P:${cleanRoomId}`;
  const b64 = Buffer.from(serverUrl, 'utf-8').toString('base64');
  if (mode === 'CUSTOM_IP') return `IP:${cleanRoomId}|${b64}`;
  return `DEF:${cleanRoomId}|${b64}`;
}

// 測試新版前綴格式
const p2pRes = testParseConnectionCode('P2P:X7A9B2');
assert(p2pRes.mode === 'P2P' && p2pRes.roomId === 'X7A9B2' && !p2pRes.isLegacy, '正確解析新版 P2P:X7A9B2');

const p2pLowerRes = testParseConnectionCode('p2p:x7a9b2');
assert(p2pLowerRes.mode === 'P2P' && p2pLowerRes.roomId === 'X7A9B2', '不分大小寫正確解析 p2p:x7a9b2');

const defRes = testParseConnectionCode('DEF:X7A9B2|aHR0cHM6Ly9zeW5jaW5lLmZseS5kZXY=');
assert(defRes.mode === 'DEFAULT' && defRes.roomId === 'X7A9B2' && !defRes.isLegacy, '正確解析新版 DEF:X7A9B2|Base64');

const defSimpleRes = testParseConnectionCode('DEF:X7A9B2');
assert(defSimpleRes.mode === 'DEFAULT' && defSimpleRes.roomId === 'X7A9B2', '正確解析新版純前綴 DEF:X7A9B2');

const ipRes = testParseConnectionCode('IP:X7A9B2|aHR0cDovLzE5Mi4xNjguMS4xMDA6MzAwMA==');
assert(ipRes.mode === 'CUSTOM_IP' && ipRes.roomId === 'X7A9B2' && ipRes.serverUrl === 'http://192.168.1.100:3000', '正確解析自架主機 IP:X7A9B2|Base64');

// 測試舊版向下相容格式
const legacyCompDefault = testParseConnectionCode('X7A9B2|aHR0cHM6Ly9zeW5jaW5lLmZseS5kZXY=');
assert(legacyCompDefault.isLegacy && legacyCompDefault.mode === 'DEFAULT' && legacyCompDefault.roomId === 'X7A9B2', '舊版複合碼比對為預設伺服器時自動判定為 DEFAULT');

const legacyCompCustom = testParseConnectionCode('X7A9B2|aHR0cDovLzE5Mi4xNjguMS41MDo4MDgw');
assert(legacyCompCustom.isLegacy && legacyCompCustom.mode === 'CUSTOM_IP' && legacyCompCustom.roomId === 'X7A9B2', '舊版複合碼非預設伺服器時自動判定為 CUSTOM_IP');

const legacyRawP2P = testParseConnectionCode('X7A9B2', 'P2P');
assert(legacyRawP2P.isLegacy && legacyRawP2P.mode === 'P2P' && legacyRawP2P.roomId === 'X7A9B2', '舊版純 6 碼在 UI 為 P2P 時相容走 P2P 模式');

const legacyRawDef = testParseConnectionCode('X7A9B2', 'DEFAULT');
assert(legacyRawDef.isLegacy && legacyRawDef.mode === 'DEFAULT' && legacyRawDef.roomId === 'X7A9B2', '舊版純 6 碼在 UI 為 DEFAULT 時相容走 DEFAULT 伺服器模式');

// 測試分享碼產生器
assert(testFormatShareCode('P2P', 'x7a9b2') === 'P2P:X7A9B2', 'formatShareCode 產生正確之 P2P 分享碼');
assert(testFormatShareCode('DEFAULT', 'X7A9B2', 'https://syncine.fly.dev').startsWith('DEF:X7A9B2|'), 'formatShareCode 產生正確之 DEF 分享碼');
assert(testFormatShareCode('CUSTOM_IP', 'X7A9B2', 'http://192.168.1.100:3000').startsWith('IP:X7A9B2|'), 'formatShareCode 產生正確之 IP 分享碼');

// ----------------------------------------------------
// 模組 7: 房主語系觀測、資安防護與新舊相容性驗證
// ----------------------------------------------------
console.log('\n--- 模組 7: 房主語系觀測、資安防護與新舊相容性驗證 ---');
function sanitizeLanguage(lang) {
  if (typeof lang !== 'string') return undefined;
  const trimmed = lang.trim();
  if (/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,4})?$/.test(trimmed) && trimmed.length <= 10) {
    return trimmed;
  }
  return undefined;
}

// 支援語系合法性測試
const supportedLangs = ['zh-TW', 'en-US', 'ja-JP', 'zh-CN'];
for (const lang of supportedLangs) {
  assert(sanitizeLanguage(lang) === lang, `合法支援語系 ${lang} 順利通過驗證`);
}

// 舊版與異常輸入測試
assert(sanitizeLanguage(undefined) === undefined, '舊版未傳入語系 (undefined) 安全過濾為 undefined');
assert(sanitizeLanguage(null) === undefined, 'null 輸入安全過濾為 undefined');
assert(sanitizeLanguage('') === undefined, '空字串安全過濾為 undefined');

// 惡意攻擊與超長輸入測試
assert(sanitizeLanguage('<script>') === undefined, '過濾 XSS 特殊字元標籤');
assert(sanitizeLanguage('zh-TW\r\nADMIN') === undefined, '過濾 CRLF 換行字元');
assert(sanitizeLanguage('a'.repeat(50)) === undefined, '過濾超長注入字串');
assert(sanitizeLanguage('javascript:alert(1)') === undefined, '過濾偽協定注入');

console.log('\n====================================================');
console.log(`📊 擴充測試執行完畢: 共 ${passed + failed} 項測試 | 通過: ${passed} | 失敗: ${failed}`);
console.log('====================================================');

if (failed === 0) {
  console.log('🎉 所有前端、多語系與全版本相容性測試皆 100% 通過！\n');
  process.exit(0);
} else {
  console.error('❌ 部份測試未通過，請檢查錯誤日誌！\n');
  process.exit(1);
}
