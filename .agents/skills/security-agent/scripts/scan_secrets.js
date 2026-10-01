/**
 * Syncine 開源專案機敏與隱私資訊掃描工具 (Security & Privacy Scanner)
 * 專為開源專案防洩與資安審核設計，檢測 Hardcoded Secrets、真實 IP、敏感檔案與權限逾越。
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// 排除目錄
const IGNORE_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  '.git',
  '.pnpm-store',
  '.vite',
  'extension-build.zip'
]);

// 允許的安全 IP 範例（規格書或文件中的教學用範例）
const SAFE_EXAMPLE_IPS = new Set([
  '127.0.0.1',
  '0.0.0.0',
  '192.168.1.100', // 規格書教學範例
  '255.255.255.255'
]);

// 敏感關鍵字特徵
const SECRET_PATTERNS = [
  { name: '私鑰憑證 (Private Key)', regex: /-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  { name: '硬編碼 JWT Token', regex: /eyJ[A-Za-z0-9-_]{20,}\.[A-Za-z0-9-_]{20,}\.[A-Za-z0-9-_]{20,}/ },
  { name: '硬編碼密鑰賦值', regex: /(?:api_?key|secret_?key|auth_?token|password|passwd)\s*[:=]\s*['"][a-zA-Z0-9_\-+=]{12,}['"]/i },
  { name: 'GitHub Personal Token', regex: /gh[pousr]_[A-Za-z0-9_]{36,}/ },
  { name: 'AWS Access Key', regex: /AKIA[0-9A-Z]{16}/ },
  { name: 'Google API Key', regex: /AIza[0-9A-Za-z-_]{35}/ },
  { name: '過度授權萬用網址 (<all_urls>)', regex: /<all_urls>/ }
];

// IPv4 正則表達式
const IP_PATTERN = /\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/g;

let issueCount = 0;

function logWarning(msg) {
  console.warn(`\x1b[33m[警告] ${msg}\x1b[0m`);
}

function logError(msg) {
  console.error(`\x1b[31m[危險] ${msg}\x1b[0m`);
  issueCount++;
}

function logSuccess(msg) {
  console.log(`\x1b[32m[安全] ${msg}\x1b[0m`);
}

// 1. 檢查 Git 追蹤狀態中是否包含敏感檔案
function checkTrackedSensitiveFiles(rootDir) {
  console.log('\n🔍 [檢查項 1] 檢查 Git 是否追蹤了敏感檔案 (.env / 憑證 / 金鑰)...');
  try {
    const trackedFiles = execSync('git ls-files', { cwd: rootDir, encoding: 'utf-8' }).split('\n');
    const dangerousPatterns = [
      /^\.env(\..+)?$/,
      /\.pem$/,
      /\.key$/,
      /\.pfx$/,
      /\.p12$/,
      /id_rsa/,
      /id_ed25519/
    ];

    let hasTrackedLeak = false;
    for (const file of trackedFiles) {
      const trimmed = file.trim();
      if (!trimmed || trimmed.endsWith('.example')) continue;

      for (const pattern of dangerousPatterns) {
        if (pattern.test(path.basename(trimmed))) {
          logError(`Git 正在追蹤敏感檔案: ${trimmed}！請立即執行 git rm --cached 並加入 .gitignore`);
          hasTrackedLeak = true;
        }
      }
    }

    if (!hasTrackedLeak) {
      logSuccess('未發現任何被 Git 追蹤之敏感檔案 (.env, 私鑰憑證等)。');
    }
  } catch (err) {
    logWarning(`無法執行 git ls-files 檢查：${err.message}`);
  }
}

// 2. 遞迴掃描原始碼內容
function scanDirectory(dirPath, rootDir) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    const relPath = path.relative(rootDir, fullPath);

    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      scanDirectory(fullPath, rootDir);
    } else if (entry.isFile()) {
      // 僅掃描文字與程式碼檔案
      const ext = path.extname(entry.name).toLowerCase();
      const codeExtensions = ['.ts', '.tsx', '.js', '.jsx', '.json', '.html', '.md', '.env', '.example', '.yml', '.yaml'];
      if (!codeExtensions.includes(ext) && !entry.name.startsWith('.env')) continue;

      scanFile(fullPath, relPath);
    }
  }
}

function scanFile(filePath, relPath) {
  // 跳過部分預期出現範例的文件與此掃描腳本自身
  if (relPath.replace(/\\/g, '/').includes('.agents/skills/security-agent/scripts/scan_secrets.js')) return;

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  lines.forEach((line, idx) => {
    const lineNum = idx + 1;

    // 檢查敏感特徵
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.regex.test(line)) {
        // 如果是在 markdown 中的範例宣告可降為警告，否則為錯誤
        if (relPath.endsWith('.md')) {
          logWarning(`${relPath}:${lineNum} 偵測到疑似機敏模式 [${pattern.name}]，請確認是否為公開範例。`);
        } else {
          logError(`${relPath}:${lineNum} 發現可能之機敏洩漏: [${pattern.name}] -> "${line.trim().slice(0, 80)}"`);
        }
      }
    }

    // 檢查寫死 IP（特別是測試自架時意外推送真實 IP）
    if (!relPath.endsWith('.md') && !relPath.endsWith('.example')) {
      const ipMatches = line.match(IP_PATTERN);
      if (ipMatches) {
        for (const ip of ipMatches) {
          if (!SAFE_EXAMPLE_IPS.has(ip)) {
            logError(`${relPath}:${lineNum} 偵測到非標準真實 IP 地址: "${ip}"！請使用環境變數或自架分享碼，嚴禁硬編碼真實 IP！`);
          }
        }
      }
    }
  });
}

function main() {
  console.log('====================================================');
  console.log('🛡️  Syncine 資安與開源隱私防洩檢測工具 (Security Auditor)');
  console.log('====================================================');

  const rootDir = path.resolve(__dirname, '../../../../');
  
  checkTrackedSensitiveFiles(rootDir);

  console.log('\n🔍 [檢查項 2] 深度掃描原始碼內容 (Secrets & Hardcoded IPs)...');
  scanDirectory(rootDir, rootDir);

  console.log('\n====================================================');
  if (issueCount > 0) {
    console.error(`❌ 掃描完成：共發現 ${issueCount} 項潛在資安或隱私風險！請立即修正後再提交。`);
    process.exit(1);
  } else {
    console.log('✅ 掃描完成：未發現任何嚴重資安或敏感隱私洩漏風險，符合開源發布安全標準！');
    process.exit(0);
  }
}

main();
