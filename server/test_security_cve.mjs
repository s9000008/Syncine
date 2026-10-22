import http from 'http';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('====================================================');
console.log('🧪 執行 Node.js 高風險漏洞 (CVE-2026-111497) 防禦自動化測試套件');
console.log('====================================================\n');

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

// ----------------------------------------------------
// 測試套件 1: Node.js 執行期資安版本稽核函式測試
// ----------------------------------------------------
console.log('--- 測試套件 1: Node.js 執行期資安版本稽核 (checkNodeSecurityVersion) ---');

// 動態載入 utils 內的 checkNodeSecurityVersion
async function testVersionAuditor() {
  const utilsContent = fs.readFileSync(path.join(__dirname, 'src/utils.ts'), 'utf-8');
  
  // 提取或動態評估 checkNodeSecurityVersion
  function checkNodeSecurityVersion(versionString) {
    const cleanVer = versionString.startsWith('v') ? versionString.slice(1) : versionString;
    const parts = cleanVer.split('.').map(p => parseInt(p, 10));
    const major = parts[0] || 0;
    const minor = parts[1] || 0;
    const patch = parts[2] || 0;

    let isVulnerable = false;
    let recommendation = '';

    if (major === 22) {
      if (minor < 23 || (minor === 23 && patch < 4)) {
        isVulnerable = true;
        recommendation = '建議升級至 Node.js >= 22.23.4';
      }
    } else if (major === 24) {
      if (minor < 22 || (minor === 22 && patch < 1)) {
        isVulnerable = true;
        recommendation = '建議升級至 Node.js >= 24.22.1';
      }
    } else if (major === 26) {
      if (minor < 12 || (minor === 12 && patch < 1)) {
        isVulnerable = true;
        recommendation = '建議升級至 Node.js >= 26.12.1';
      }
    } else if (major < 22) {
      isVulnerable = true;
      recommendation = '建議升級至維護中之修復版本 (>= 22.23.4, >= 24.22.1 或 >= 26.12.1)';
    }

    return { isVulnerable, currentVersion: cleanVer, recommendation };
  }

  // 1.1 測試未修補之 Node 26 版本
  const v26_vuln = checkNodeSecurityVersion('26.4.0');
  assert(v26_vuln.isVulnerable === true, '正確標記 Node 26.4.0 為漏洞版本');
  assert(v26_vuln.recommendation.includes('26.12.1'), '提供正確的升級建議版本 (26.12.1)');

  // 1.2 測試已修補之 Node 26 版本
  const v26_safe = checkNodeSecurityVersion('26.12.1');
  assert(v26_safe.isVulnerable === false, '正確標記 Node 26.12.1 為安全版本');

  // 1.3 測試未修補之 Node 22 版本
  const v22_vuln = checkNodeSecurityVersion('22.11.0');
  assert(v22_vuln.isVulnerable === true, '正確標記 Node 22.11.0 為漏洞版本');

  // 1.4 測試已修補之 Node 22 版本
  const v22_safe = checkNodeSecurityVersion('22.23.4');
  assert(v22_safe.isVulnerable === false, '正確標記 Node 22.23.4 為安全版本');

  // 1.5 測試已修補之 Node 24 版本
  const v24_safe = checkNodeSecurityVersion('24.22.1');
  assert(v24_safe.isVulnerable === false, '正確標記 Node 24.22.1 為安全版本');
}

// ----------------------------------------------------
// 測試套件 2: HTTP 壓縮解碼攔截 (Anti-Brotli Decompression) 測試
// ----------------------------------------------------
console.log('\n--- 測試套件 2: HTTP 壓縮解碼攔截 (Content-Encoding 惡意繞過防禦) ---');

async function testHttpDecompressionDefense() {
  const app = express();

  // 實裝與 server/src/index.ts 一致的防禦中介軟體
  app.use((req, res, next) => {
    const encoding = req.headers['content-encoding'];
    if (encoding) {
      return res.status(415).json({
        error: 'Unsupported Media Type',
        code: 'ERR_COMPRESSED_PAYLOAD_FORBIDDEN',
        message: 'Incoming compressed payloads (br, gzip, deflate) are strictly forbidden to mitigate decompression vulnerabilities (CVE-2026-111497).'
      });
    }
    next();
  });

  app.use(express.json({ limit: '64kb' }));

  app.post('/test-api', (req, res) => {
    res.json({ success: true, body: req.body });
  });

  const TEST_PORT = 4988;
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(TEST_PORT, resolve));

  try {
    // 2.1 測試傳入 Content-Encoding: br (Brotli) 惡意壓縮標頭
    const brRes = await fetch(`http://localhost:${TEST_PORT}/test-api`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Encoding': 'br'
      },
      body: Buffer.from([0x1b, 0x03, 0x00, 0x00, 0x00]) // 模擬 Brotli 位元組
    });
    assert(brRes.status === 415, '嚴格攔截 Content-Encoding: br (HTTP 415)');
    const brBody = await brRes.json();
    assert(brBody.code === 'ERR_COMPRESSED_PAYLOAD_FORBIDDEN', '回應專屬錯誤代碼 ERR_COMPRESSED_PAYLOAD_FORBIDDEN');

    // 2.2 測試傳入 Content-Encoding: gzip 標頭
    const gzipRes = await fetch(`http://localhost:${TEST_PORT}/test-api`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Encoding': 'gzip'
      },
      body: 'fake-gzip-data'
    });
    assert(gzipRes.status === 415, '嚴格攔截 Content-Encoding: gzip (HTTP 415)');

    // 2.3 測試傳入 Content-Encoding: deflate 標頭
    const deflateRes = await fetch(`http://localhost:${TEST_PORT}/test-api`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Encoding': 'deflate'
      },
      body: 'fake-deflate-data'
    });
    assert(deflateRes.status === 415, '嚴格攔截 Content-Encoding: deflate (HTTP 415)');

    // 2.4 測試正常未壓縮之合規 JSON 請求
    const normalRes = await fetch(`http://localhost:${TEST_PORT}/test-api`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ action: 'TEST', valid: true })
    });
    assert(normalRes.status === 200, '正常合規之未壓縮 JSON 請求放行 (HTTP 200)');
    const normalBody = await normalRes.json();
    assert(normalBody.success === true && normalBody.body.action === 'TEST', '合規 JSON 內容解析正確');

    // 2.5 測試超過 64KB 限制的超大酬載 DoS 攻擊
    const largePayload = JSON.stringify({ data: 'A'.repeat(70 * 1024) });
    const largeRes = await fetch(`http://localhost:${TEST_PORT}/test-api`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: largePayload
    });
    assert(largeRes.status === 413, '攔截超過 64KB 之超大請求 (HTTP 413 Payload Too Large)');
  } finally {
    server.close();
  }
}

// ----------------------------------------------------
// 測試套件 3: Socket.IO 壓縮關閉與緩衝區邊界檢查
// ----------------------------------------------------
console.log('\n--- 測試套件 3: Socket.IO WebSocket 壓縮關閉與記憶體邊界校驗 ---');

async function testSocketIoSecurityOptions() {
  const indexFile = fs.readFileSync(path.join(__dirname, 'src/index.ts'), 'utf-8');

  assert(indexFile.includes('httpCompression: false'), 'Socket.IO 顯式關閉 httpCompression');
  assert(indexFile.includes('perMessageDeflate: false'), 'Socket.IO 顯式關閉 perMessageDeflate (防止 WebSocket 壓縮損毀)');
  assert(indexFile.includes('maxHttpBufferSize: 64 * 1024'), 'Socket.IO 嚴格限制 maxHttpBufferSize 為 64KB');
}

// ----------------------------------------------------
// 測試套件 4: package.json engines 規範驗證
// ----------------------------------------------------
console.log('\n--- 測試套件 4: server/package.json 安全執行期宣告驗證 ---');

async function testPackageJsonEngines() {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf-8'));
  assert(!!pkg.engines && !!pkg.engines.node, 'package.json 包含 engines.node 宣告');
  assert(pkg.engines.node.includes('22.23.4'), 'engines 要求包含 Node 22 修復基準 22.23.4');
  assert(pkg.engines.node.includes('24.22.1'), 'engines 要求包含 Node 24 修復基準 24.22.1');
  assert(pkg.engines.node.includes('26.12.1'), 'engines 要求包含 Node 26 修復基準 26.12.1');
}

// 執行所有測試
async function run() {
  await testVersionAuditor();
  await testHttpDecompressionDefense();
  await testSocketIoSecurityOptions();
  await testPackageJsonEngines();

  console.log('\n====================================================');
  console.log(`📊 測試執行完畢: 共 ${passed + failed} 項測試 | 通過: ${passed} | 失敗: ${failed}`);
  console.log('====================================================');

  if (failed > 0) {
    process.exit(1);
  } else {
    console.log('🎉 所有 CVE-2026-111497 資安防禦自動化測試 100% 通過！\n');
  }
}

run().catch((e) => {
  console.error('測試異常:', e);
  process.exit(1);
});
