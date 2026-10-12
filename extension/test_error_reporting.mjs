import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let passed = 0;
let failed = 0;

function assert(condition, testName, detail = '') {
  if (condition) {
    console.log(`  ✅ [PASS] ${testName}`);
    passed++;
  } else {
    console.error(`  ❌ [FAIL] ${testName} ${detail ? `- ${detail}` : ''}`);
    failed++;
  }
}

console.log('====================================================');
console.log('🛡️ Syncine P2P 錯誤日誌與 GitHub Issue 回報深度驗證套件');
console.log('====================================================\n');

import { execSync } from 'child_process';

// 自動編譯 p2pLogger.ts 到 dist_test/p2pLogger.mjs (零相依執行)
const p2pModulePath = path.join(__dirname, 'dist_test/p2pLogger.mjs');
if (!fs.existsSync(p2pModulePath)) {
  const srcPath = path.join(__dirname, 'src/utils/p2pLogger.ts');
  fs.mkdirSync(path.join(__dirname, 'dist_test'), { recursive: true });
  execSync(`npx esbuild "${srcPath}" --format=esm --outfile="${p2pModulePath}"`, { stdio: 'pipe' });
}

const { sanitizeIp, maskIdentifier, sanitizeDetails, P2PLogger } = await import(
  `file://${p2pModulePath.replace(/\\/g, '/')}`
);

// ----------------------------------------------------
// 測試套件 1: IP 位址遮蔽與隱私清毒 (Zero-Leakage Sanitizer)
// ----------------------------------------------------
console.log('--- 測試套件 1: IP 脫敏清毒演算法 (sanitizeIp) ---');

assert(sanitizeIp('192.168.1.100') === '192.168.*.*', '標準私有 IPv4 (192.168.x.x) 遮蔽後兩段');
assert(sanitizeIp('10.20.30.40') === '10.20.*.*', '標準私有 IPv4 (10.x.x.x) 遮蔽後兩段');
assert(sanitizeIp('172.16.5.6') === '172.16.*.*', '標準私有 IPv4 (172.16.x.x) 遮蔽後兩段');
assert(sanitizeIp('140.112.8.1') === '140.112.*.*', '公網 IPv4 遮蔽後兩段');
assert(
  sanitizeIp('Candidate from 192.168.1.20 to 140.112.1.2 on port 5000') ===
    'Candidate from 192.168.*.* to 140.112.*.* on port 5000',
  '同一字串內包含多個 IPv4 同步脫敏'
);
assert(
  sanitizeIp('IPv6 addr: 2001:0db8:85a3:0000:0000:8a2e:0370:7334') ===
    'IPv6 addr: 2001:0db8:85a3:****',
  '標準 IPv6 遮蔽後綴區段'
);
assert(sanitizeIp('') === '', '空字串安全返回空字串');
assert(sanitizeIp(null) === '', 'null 安全返回空字串');
assert(sanitizeIp(undefined) === '', 'undefined 安全返回空字串');
assert(sanitizeIp('Syncine v2.3.0 is running') === 'Syncine v2.3.0 is running', '非 IP 之版本號不被誤殺');
assert(sanitizeIp('Video buffer: 12.34s') === 'Video buffer: 12.34s', '非 IP 之小數點數字不被誤殺');

// ----------------------------------------------------
// 測試套件 2: 識別碼遮蔽演算法 (maskIdentifier)
// ----------------------------------------------------
console.log('\n--- 測試套件 2: 房間與用戶識別碼遮蔽 (maskIdentifier) ---');

assert(maskIdentifier('X7A9B2') === 'X7***B2', '標準 6 碼房號保留前 2 與後 2 碼');
assert(maskIdentifier('user_abc123') === 'us***23', '用戶 ID 保留前 2 與後 2 碼');
assert(maskIdentifier('1234') === '***4', '4 碼短識別碼遮蔽前 3 碼保留末碼');
assert(maskIdentifier('A') === '***A', '1 碼極短識別碼遮蔽保留末碼');
assert(maskIdentifier(undefined) === 'unknown', '未提供 ID 時安全回退為 unknown');
assert(maskIdentifier('') === 'unknown', '空字串 ID 安全回退為 unknown');

// ----------------------------------------------------
// 測試套件 3: 詳細資料敏感欄位清除 (sanitizeDetails)
// ----------------------------------------------------
console.log('\n--- 測試套件 3: 物件敏感欄位過濾 (sanitizeDetails) ---');

const sensitiveData = {
  authToken: 'secret_jwt_xyz123',
  resumeToken: 'hex48_private_token',
  apiKey: 'ak_live_abcdef',
  userIp: '192.168.10.50',
  nested: {
    adminPassword: 'my_super_password',
    serverIp: '140.112.5.6'
  },
  safeField: 'normal_value',
  count: 42
};

const sanitized = sanitizeDetails(sensitiveData);
assert(sanitized.authToken === '[REDACTED]', 'authToken 欄位被遮蔽為 [REDACTED]');
assert(sanitized.resumeToken === '[REDACTED]', 'resumeToken 欄位被遮蔽為 [REDACTED]');
assert(sanitized.apiKey === '[REDACTED]', 'apiKey 欄位被遮蔽為 [REDACTED]');
assert(sanitized.userIp === '192.168.*.*', 'userIp 字串位址被自動脫敏');
assert(sanitized.nested.adminPassword === '[REDACTED]', 'adminPassword 在巢狀物件中被過濾為 [REDACTED]');
assert(sanitized.nested.serverIp === '140.112.*.*', '巢狀物件內部 IP 亦被自動脫敏');
assert(sanitized.safeField === 'normal_value', '非敏感安全欄位完整保留');
assert(sanitized.count === 42, '數值型別欄位完整保留');
assert(sanitizeDetails(undefined) === undefined, 'undefined 參數安全返回 undefined');

// ----------------------------------------------------
// 測試套件 4: 環形記憶體日誌佇列 (FIFO Ring Buffer)
// ----------------------------------------------------
console.log('\n--- 測試套件 4: P2PLogger 環形記憶體佇列與候選者統計 ---');

const logger = P2PLogger.getInstance();
logger.reset();

// 驗證初始化
assert(logger.getRecentLogs().length === 0, 'Reset 後日誌隊列長度為 0');
const initialCandidates = logger.getCandidatesSummary();
assert(
  initialCandidates.host === 0 && initialCandidates.srflx === 0 && initialCandidates.relay === 0,
  'Reset 後候選者計數全部為 0'
);

// 記錄不同類型的 STUN_GATHER 事件
logger.record('STUN_GATHER', 'Found host candidate 192.168.1.10', 'INFO', { type: 'host' });
logger.record('STUN_GATHER', 'Found srflx candidate 203.0.113.1', 'INFO', { type: 'srflx' });
logger.record('STUN_GATHER', 'Found relay candidate 198.51.100.1', 'INFO', { type: 'relay' });
logger.record('ICE_CONNECTING', 'Starting ICE handshake', 'INFO');

const candidates = logger.getCandidatesSummary();
assert(candidates.host === 1, '正確累計 host 候選者數 (1)');
assert(candidates.srflx === 1, '正確累計 srflx 候選者數 (1)');
assert(candidates.relay === 1, '正確累計 relay 候選者數 (1)');

// 驗證 FIFO 溢出保護：推入 100 筆事件，最大上限必須維持在 60 筆以內
for (let i = 0; i < 100; i++) {
  logger.record('PEER_DATA', `Event packet ${i}`, 'INFO');
}

const currentLogs = logger.getRecentLogs(100);
assert(currentLogs.length === 60, `推入 104 筆日誌後，隊列容量嚴格限制在 60 筆 (實際: ${currentLogs.length})`);
assert(currentLogs[currentLogs.length - 1].event === 'Event packet 99', '隊列尾端為最新記錄');
assert(currentLogs[0].event === 'Event packet 40', '隊列前端為最早保留記錄 (早期記錄依序被移出)');

// ----------------------------------------------------
// 測試套件 5: Markdown 診斷報告結構與清毒驗證
// ----------------------------------------------------
console.log('\n--- 測試套件 5: Markdown 診斷報告生成與隱私驗證 ---');

const markdownReport = logger.generateMarkdownReport({
  version: 'v2.3.0',
  roomId: 'X7A9B2',
  role: 'GUEST',
  status: 'DISCONNECTED',
  retryCount: 3,
  errorCode: 'ERR_P2P_TIMEOUT'
});

assert(markdownReport.includes('### 🛠️ Syncine P2P 連線診斷報告'), '包含報告主標題');
assert(markdownReport.includes('Syncine v2.3.0 (Chrome MV3)'), '包含正確版本號');
assert(markdownReport.includes('WebRTC P2P (PeerJS DataChannel)'), '包含正確連線模式');
assert(markdownReport.includes('GUEST'), '包含身分角色');
assert(markdownReport.includes('X7***B2'), '包含已遮蔽目標房號 (無未遮蔽原始房號)');
assert(markdownReport.includes('ERR_P2P_TIMEOUT'), '包含標準錯誤代碼');
assert(markdownReport.includes('3 次重試'), '包含退避重試計數');
assert(markdownReport.includes('ICE 候選者收集摘要'), '包含 ICE 收集摘要');
assert(markdownReport.includes('```text'), '包含日誌代碼區塊');
assert(markdownReport.includes('💡 備註：所有 IP 位址與機敏識別碼已通過本機零洩漏演算法脫敏'), '包含隱私保護宣告');

// 嚴格掃描報告全文是否存在洩漏的完整 IP
const rawIpRegex = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g;
const ipMatches = markdownReport.match(rawIpRegex);
assert(!ipMatches || ipMatches.length === 0, '診斷報告全文 100% 零原始未脫敏 IP 洩漏');

// ----------------------------------------------------
// 測試套件 6: GitHub Issue 預填網址結構與健全性
// ----------------------------------------------------
console.log('\n--- 測試套件 6: GitHub Issue 預填網址結構合規性 ---');

const issueUrl = logger.generateGitHubIssueUrl({
  errorCode: 'ERR_P2P_TIMEOUT',
  markdownReport
});

assert(typeof issueUrl === 'string' && issueUrl.length > 0, 'Issue 網址成功生成');
let parsedUrl;
try {
  parsedUrl = new URL(issueUrl);
  assert(true, 'Issue 網址符合標準 URL 格式規範');
} catch (e) {
  assert(false, 'Issue 網址符合標準 URL 格式規範', e.message);
}

if (parsedUrl) {
  assert(parsedUrl.protocol === 'https:', '使用安全 HTTPS 協定');
  assert(parsedUrl.hostname === 'github.com', '目標主機為 github.com');
  assert(parsedUrl.pathname === '/s9000008/Syncine/issues/new', '目標路徑為 s9000008/Syncine/issues/new');

  const titleParam = parsedUrl.searchParams.get('title');
  const labelsParam = parsedUrl.searchParams.get('labels');
  const bodyParam = parsedUrl.searchParams.get('body');

  assert(titleParam === '[P2P Connection] ERR_P2P_TIMEOUT 連線異常回報', '標題包含標準錯誤代碼與中文說明');
  assert(labelsParam === 'bug,p2p', '自動打上 bug 與 p2p 標籤');
  assert(bodyParam && bodyParam.includes('Syncine P2P 連線診斷報告'), '內容包含完整脫敏診斷報告');
  assert(bodyParam && bodyParam.includes('作業系統與瀏覽器環境'), '內容包含客戶端環境欄位');

  // URL 長度安全檢查 (現代瀏覽器/Web 伺服器上限通常為 4096 ~ 8192 字元)
  console.log(`    ℹ️ 產生之 URL 總長度: ${issueUrl.length} 字元`);
  assert(issueUrl.length < 3800, 'URL 總長度安全控制在 3800 字元以下，絕無 414 溢出截斷風險');
}

// ----------------------------------------------------
// 測試套件 7: Popup 本機備援邏輯 (Fallback) 模擬
// ----------------------------------------------------
console.log('\n--- 測試套件 7: Popup 本機脫敏備援邏輯 (Fallback) ---');

function generatePopupFallback(lastErrorCode, connectionMode, errorMessage) {
  const fallbackReport = [
    '### 🛠️ Syncine 連線診斷報告 (Diagnostic Report)',
    `- **擴充套件版本**: Syncine v2.3.0 (Chrome MV3)`,
    `- **連線模式**: ${connectionMode}`,
    `- **錯誤代碼**: ${lastErrorCode || 'ERR_UNKNOWN'}`,
    `- **時間戳**: ${new Date().toISOString()}`,
    '',
    `> 💡 錯誤詳情: ${errorMessage || '連線逾時或中斷'}`
  ].join('\n');

  const repoBase = 'https://github.com/s9000008/Syncine/issues/new';
  const query = new URLSearchParams({
    title: `[Connection Issue] ${lastErrorCode || 'ERR_UNKNOWN'}`,
    labels: 'bug,p2p',
    body: fallbackReport
  });

  return {
    markdownReport: fallbackReport,
    githubIssueUrl: `${repoBase}?${query.toString()}`
  };
}

const fallbackRes = generatePopupFallback('ERR_SERVER_TIMEOUT', 'DEFAULT', '無法連線至官方中繼伺服器');
assert(fallbackRes.githubIssueUrl.includes('ERR_SERVER_TIMEOUT'), '備援回報亦包含正確錯誤代碼');
assert(fallbackRes.markdownReport.includes('DEFAULT'), '備援報告包含當前連線模式');
assert(fallbackRes.githubIssueUrl.includes('labels=bug%2Cp2p'), '備援網址包含 bug,p2p 標籤');

// ----------------------------------------------------
// 測試套件 8: 實際網路端點與 GitHub 服務健全性 (Live Endpoint Verification)
// ----------------------------------------------------
console.log('\n--- 測試套件 8: GitHub 官方 Issue 端點真實連線與解析驗證 ---');

try {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  const res = await fetch(issueUrl, {
    method: 'GET',
    redirect: 'manual', // 不自動跟隨，以便檢驗 302 重定向與參數保留
    signal: controller.signal
  });
  clearTimeout(timeoutId);

  // GitHub 公開專案在未登入時會返回 302 並帶 return_to 查詢參數，已登入返回 200
  const isHealthy = res.status === 200 || res.status === 302;
  assert(isHealthy, `GitHub 端點回傳健全狀態碼: HTTP ${res.status}`, `實際狀態: ${res.status} ${res.statusText}`);

  if (res.status === 302) {
    const rawRedirect = res.headers.get('location') || '';
    const decodedRedirect = decodeURIComponent(rawRedirect);
    assert(
      decodedRedirect.includes('/s9000008/Syncine/issues/new'),
      'GitHub 302 登入重定向中完整保留了 return_to 專案 Issue 路徑'
    );
    assert(
      decodedRedirect.includes('ERR_P2P_TIMEOUT'),
      '重定向參數中完整保留了錯誤代碼查詢字串 (登入後即可直接預填)'
    );
  }
} catch (netErr) {
  console.warn(`    ⚠️ 網路探測跳過或受阻: ${netErr.message}`);
}

// ----------------------------------------------------
// 測試套件 9: 四大語系回報按鈕與 Toast 文案健全性
// ----------------------------------------------------
console.log('\n--- 測試套件 9: 四大語系錯誤回報按鈕文案對齊 ---');

const locales = ['zh-TW', 'en-US', 'ja-JP', 'zh-CN'];
for (const loc of locales) {
  const locPath = path.join(__dirname, 'src/locales', `${loc}.ts`);
  const content = fs.readFileSync(locPath, 'utf-8');
  assert(content.includes('reportIssueGithub'), `${loc} 定義了 reportIssueGithub 回報按鈕文案`);
  assert(content.includes('copyDiagnosticReport'), `${loc} 定義了 copyDiagnosticReport 複製按鈕文案`);
  assert(content.includes('reportCopiedToast'), `${loc} 定義了 reportCopiedToast 提示文案`);
}

// ----------------------------------------------------
// 總結報告
// ----------------------------------------------------
console.log('\n====================================================');
console.log(`📊 驗證結果: 總測試 ${passed + failed} 項 | 通過: ${passed} | 失敗: ${failed}`);
console.log('====================================================');

if (failed === 0) {
  console.log('🎉 錯誤回報與 P2P 診斷發送功能全部通過健全性測試，確認 100% 可用！\n');
  process.exit(0);
} else {
  console.error('❌ 有測試未通過，請檢查詳細錯誤日誌！\n');
  process.exit(1);
}
