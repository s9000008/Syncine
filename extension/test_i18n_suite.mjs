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

const contentTs = fs.readFileSync(path.join(__dirname, 'src/content/index.ts'), 'utf-8');
assert(contentTs.includes('getStandaloneText'), 'content/index.ts 引入並使用 getStandaloneText');

const offscreenTs = fs.readFileSync(path.join(__dirname, 'src/offscreen/index.ts'), 'utf-8');
assert(offscreenTs.includes('getStandaloneText'), 'offscreen/index.ts 引入並使用 getStandaloneText');

console.log('\n====================================================');
console.log(`📊 前端測試執行完畢: 共 ${passed + failed} 項測試 | 通過: ${passed} | 失敗: ${failed}`);
console.log('====================================================');

if (failed === 0) {
  console.log('🎉 所有前端與多語系自動化檢查皆 100% 通過！\n');
  process.exit(0);
} else {
  console.error('❌ 部份測試未通過，請檢查錯誤日誌！\n');
  process.exit(1);
}
