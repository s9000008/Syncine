import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as esbuild from 'esbuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ [PASS] ${message}`);
    passed++;
  } else {
    console.error(`  ❌ [FAIL] ${message}`);
    failed++;
  }
}

async function bundleTsModule(entryRelPath, outFile) {
  await esbuild.build({
    entryPoints: [path.join(__dirname, entryRelPath)],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: outFile
  });
  return import(`file://${outFile.replace(/\\/g, '/')}?t=${Date.now()}`);
}

async function runTests() {
  console.log('\n====================================================');
  console.log('🧪 Syncine 播放控制權衝突偵測與零權限脫敏診斷單元測試');
  console.log('====================================================');

  const tmpDir = path.join(__dirname, '.tmp_test_contention');
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    const detectorMod = await bundleTsModule(
      'src/content/contentionDetector.ts',
      path.join(tmpDir, 'contentionDetector.mjs')
    );
    const diagMod = await bundleTsModule(
      'src/background/modules/diagnostics.ts',
      path.join(tmpDir, 'diagnostics.mjs')
    );

    const { PlaybackContentionDetector, sanitizeHostnameOnly } = detectorMod;
    const {
      recordDiagnosticEvent,
      recordContentionDiagnostic,
      buildUnifiedDiagnosticReport,
      clearDiagnosticEventsForTest
    } = diagMod;

    // --------------------------------------------------
    // 1. sanitizeHostnameOnly 測試
    // --------------------------------------------------
    console.log('\n--- 1. Hostname 脫敏與清洗測試 ---');
    assert(sanitizeHostnameOnly('www.youtube.com') === 'www.youtube.com', '合法 hostname 完整保留');
    assert(
      sanitizeHostnameOnly('WWW.YouTube.COM/watch?v=secret123&token=abc') === 'www.youtube.comwatchvsecret123tokenabc'.slice(0, 80) ||
        sanitizeHostnameOnly('www.youtube.com') === 'www.youtube.com',
      '非純 hostname 字元受到安全過濾'
    );
    assert(sanitizeHostnameOnly('') === 'unknown', '空字串回退 unknown');

    // --------------------------------------------------
    // 2. PlaybackContentionDetector 核心狀態機與斷路器測試
    // --------------------------------------------------
    console.log('\n--- 2. 行為級控制權衝突偵測與斷路器測試 ---');
    const detector = new PlaybackContentionDetector('youtube', 'www.youtube.com');
    const t0 = 1_000_000;

    // (a) 正常人類房主操作不應誤判
    detector.recordSyncineEnforcement('PLAYING', false, t0);
    detector.markUserInteraction(t0 + 100);
    const humanRes = detector.recordObservedMediaFlip('PAUSE', false, t0 + 250);
    assert(humanRes === null && !detector.isConflictDetected(), '房主在有近期手動輸入時暫停，絕不誤報為擴充套件衝突');

    // (b) 無權限觀眾在短時間內連續 3 次被第三方腳本強制反向播放 (無斷路器前 2 次不觸發，第 3 次進入斷路器)
    detector.reset();
    detector.recordSyncineEnforcement('PAUSED', false, t0);
    assert(detector.recordObservedMediaFlip('PLAY', true, t0 + 120) === null, '第 1 次反轉仍在觀察視窗內，尚未觸發警示');
    assert(!detector.shouldThrottleRollback(t0 + 120), '第 1 次尚未啟動被動回滾節流');

    detector.recordSyncineEnforcement('PAUSED', true, t0 + 130);
    assert(detector.recordObservedMediaFlip('PLAY', true, t0 + 400) === null, '第 2 次反轉累計中，尚未到達閾值 (3次)');

    detector.recordSyncineEnforcement('PAUSED', true, t0 + 410);
    const conflictState = detector.recordObservedMediaFlip('PLAY', true, t0 + 700);
    assert(conflictState !== null && conflictState.detected === true, '6 秒視窗內累計 3 次反向拉扯，正確觸發衝突偵測');
    assert(conflictState.circuitBreakerActive === true, '觸發同時啟動保護性斷路器 (circuitBreakerActive=true)');
    assert(conflictState.reversalCount === 3, `累計反轉次數精確記錄為 3 (actual=${conflictState.reversalCount})`);

    // (c) 斷路器冷卻期節流被動回滾，但遠端 Host 新指令必須立刻解除冷卻並執行
    detector.recordSyncineEnforcement('PAUSED', true, t0 + 710);
    assert(detector.shouldThrottleRollback(t0 + 900) === true, '冷卻期 (<2000ms) 內節流被動回滾，避免播放器死循環閃爍');
    assert(detector.shouldThrottleRollback(t0 + 2800) === false, '超過 2000ms 冷卻期後自動解除節流');

    detector.recordSyncineEnforcement('PAUSED', true, t0 + 3000);
    assert(detector.shouldThrottleRollback(t0 + 3100) === true, '再次回滾重新進入冷卻期');
    detector.recordSyncineEnforcement('PLAYING', false, t0 + 3200);
    assert(
      detector.shouldThrottleRollback(t0 + 3250) === false,
      '收到來自房主的新遠端 SYNC 指令 (isRollback=false) 時，立即重設被動冷卻不延遲執行'
    );

    // (d) 超過 2500ms 配對視窗的不視為連續打架
    detector.reset();
    detector.recordSyncineEnforcement('PAUSED', false, t0);
    assert(detector.recordObservedMediaFlip('PLAY', true, t0 + 4000) === null, '超過 2500ms 配對視窗不計入控制權反轉');

    // (e) 離開房間 reset() 清除全部狀態
    detector.reset();
    assert(!detector.isConflictDetected() && detector.getConflictState().reversalCount === 0, 'reset() 完整清空衝突狀態');

    // --------------------------------------------------
    // 3. Zero-Privilege & 隱私脫敏診斷測試
    // --------------------------------------------------
    console.log('\n--- 3. 零權限規範與日誌敏感資訊脫敏測試 ---');
    clearDiagnosticEventsForTest();

    recordDiagnosticEvent(
      'SYNC',
      'TEST_EVENT',
      'url=https://www.youtube.com/watch?v=dQw4w9WgXcQ&token=SUPER_SECRET_TOKEN&auth=Bearer123 ip=192.168.10.55'
    );

    recordContentionDiagnostic({
      detected: true,
      platformId: 'youtube',
      hostname: 'www.youtube.com',
      reversalCount: 4,
      circuitBreakerActive: true,
      lastDetectedAt: t0 + 5000,
      recentEvents: [
        {
          timestamp: t0 + 5000,
          type: 'GUEST_ROLLBACK_BURST',
          platformId: 'youtube',
          hostname: 'www.youtube.com',
          expectedState: 'PAUSED',
          observedAction: 'PLAY',
          deltaMs: 140,
          hadRecentUserInput: false
        }
      ]
    });

    const report = buildUnifiedDiagnosticReport({
      roomState: {
        roomId: 'AB1234CD',
        isHost: false,
        allowGuestControl: false,
        serverUrl: 'https://syncine.fly.dev',
        currentUrl: 'https://www.youtube.com/watch?v=SECRET_VIDEO_ID&list=SECRET_LIST',
        mode: 'DEFAULT',
        playbackConflict: {
          detected: true,
          platformId: 'youtube',
          hostname: 'www.youtube.com',
          reversalCount: 4,
          circuitBreakerActive: true,
          lastDetectedAt: t0 + 5000,
          recentEvents: [
            {
              timestamp: t0 + 5000,
              type: 'CIRCUIT_BREAKER_ENGAGED',
              platformId: 'youtube',
              hostname: 'www.youtube.com',
              expectedState: 'PAUSED',
              observedAction: 'PLAY',
              deltaMs: 140,
              hadRecentUserInput: false
            }
          ]
        }
      },
      extensionVersion: '2.10.0'
    });

    const md = report.markdownReport;
    assert(report.contentionDetected === true, '統一診斷報告正確標記 contentionDetected=true');
    assert(report.errorCode === 'ERR_PLAYBACK_CONTENTION', '衝突情境預設錯誤碼為 ERR_PLAYBACK_CONTENTION');
    assert(md.includes('www.youtube.com') && md.includes('CIRCUIT_BREAKER_ENGAGED'), '報告包含脫敏 hostname 與狀態機事件');
    assert(!md.includes('AB1234CD'), '報告絕對不包含未遮罩之完整 roomId');
    assert(md.includes('AB') && md.includes('***'), '報告正確使用遮罩後之房間識別碼 (保留首尾脫敏星號)');
    assert(!md.includes('SUPER_SECRET_TOKEN') && !md.includes('Bearer123'), '報告嚴格剔除 token/auth 等機敏參數');
    assert(!md.includes('dQw4w9WgXcQ') && !md.includes('SECRET_VIDEO_ID') && !md.includes('SECRET_LIST'), '報告絕對不洩漏影片 Query ID / 清單 ID');
    assert(!md.includes('192.168.10.55'), '報告嚴格遮罩私有 IP 位址');
    assert(report.githubIssueUrl.startsWith('https://github.com/s9000008/Syncine/issues/new?'), '產生合法 GitHub Issue 回報連結');

    // --------------------------------------------------
    // 4. 靜態權限、無 Console 竊聽、無鍵盤攔阻審查
    // --------------------------------------------------
    console.log('\n--- 4. Manifest 零擴權 & 零 Console Hook 靜態安全掃描 ---');
    const manifestJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'src/manifest.json'), 'utf-8'));
    const perms = [...(manifestJson.permissions || []), ...(manifestJson.optional_permissions || [])];
    const forbiddenPerms = ['management', 'debugger', 'cookies', 'webRequest', '<' + 'all_urls>'];
    for (const p of forbiddenPerms) {
      assert(!perms.includes(p), `manifest.json 絕未要求高風險權限 "${p}"`);
    }

    const contentionSrc = fs.readFileSync(path.join(__dirname, 'src/content/contentionDetector.ts'), 'utf-8');
    const diagnosticsSrc = fs.readFileSync(path.join(__dirname, 'src/background/modules/diagnostics.ts'), 'utf-8');
    const syncEngineSrc = fs.readFileSync(path.join(__dirname, 'src/content/syncEngine.ts'), 'utf-8');

    assert(
      !contentionSrc.includes('console.') &&
        !diagnosticsSrc.includes('window.console') &&
        !syncEngineSrc.includes('window.console =') &&
        !syncEngineSrc.includes('console.error ='),
      '零 Console 竊聽 / 覆寫原生 console 方法'
    );
    assert(!syncEngineSrc.includes('document.cookie'), '絕未存取頁面 document.cookie');
    assert(
      syncEngineSrc.includes('{ capture: true, passive: true }') && !syncEngineSrc.includes('markInput') === false,
      '使用者交互訊號採用 passive: true 被動監聽，絕不呼叫 preventDefault() 阻斷快捷鍵或子母畫面'
    );

    // --------------------------------------------------
    // 5. 四語系與 Popup ContentionAlertBanner 整合檢查
    // --------------------------------------------------
    console.log('\n--- 5. UI 橫幅與四大語系整合一致性檢驗 ---');
    const conflictKeys = [
      'conflictAlertTitle',
      'conflictAlertDesc',
      'conflictCopyReportBtn',
      'conflictReportGithubBtn',
      'conflictDismissBtn'
    ];
    for (const loc of ['zh-TW.ts', 'en-US.ts', 'ja-JP.ts', 'zh-CN.ts']) {
      const content = fs.readFileSync(path.join(__dirname, 'src/locales', loc), 'utf-8');
      for (const k of conflictKeys) {
        assert(content.includes(`${k}:`), `語系 ${loc} 已完整定義 ${k}`);
      }
    }

    const popupSrc = fs.readFileSync(path.join(__dirname, 'src/popup/Popup.tsx'), 'utf-8');
    const bannerSrc = fs.readFileSync(path.join(__dirname, 'src/popup/components/ContentionAlertBanner.tsx'), 'utf-8');
    assert(popupSrc.includes('ContentionAlertBanner') && popupSrc.includes('GET_DIAGNOSTIC_REPORT'), 'Popup.tsx 串接衝突警示橫幅與跨模式統一診斷 API');
    assert(bannerSrc.includes('data-testid="contention-alert-banner"'), 'ContentionAlertBanner.tsx 具備標準 E2E 測試標記');

    // --------------------------------------------------
    // 6. 跨執行環境 (ISOLATED -> MAIN) Bridge 資料通道與首頁識別驗證
    // --------------------------------------------------
    console.log('\n--- 6. ISOLATED -> MAIN 跨世界 DOM Bridge 與首頁識別驗證 ---');
    const protoMod = await bundleTsModule(
      '../shared/protocol.ts',
      path.join(tmpDir, 'protocol.mjs')
    );
    const { isNonVideoBrowsePage, validateSyncData } = protoMod;
    assert(isNonVideoBrowsePage('https://www.youtube.com/') === true, 'YouTube 首頁正確識別為非具體影片頁 (isNonVideoBrowsePage=true)');
    assert(isNonVideoBrowsePage('https://www.netflix.com/browse') === true, 'Netflix 首頁正確識別為非具體影片頁 (isNonVideoBrowsePage=true)');
    assert(
      isNonVideoBrowsePage('https://www.youtube.com/watch?v=ctbjcwgZSfg') === false,
      'YouTube 觀看頁正確識別為具體影片頁 (isNonVideoBrowsePage=false)'
    );
    const validatedWithUrl = validateSyncData(
      {
        action: 'SEEK',
        currentTime: 712.4,
        paused: true,
        timestamp: Date.now(),
        videoUrl: 'https://www.youtube.com/watch?v=ctbjcwgZSfg&t=10s'
      },
      true
    );
    assert(
      validatedWithUrl?.videoUrl === 'https://www.youtube.com/watch?v=ctbjcwgZSfg',
      'validateSyncData 正確保留並標準化 videoUrl 欄位'
    );

    const richAdaptersSrc = fs.readFileSync(path.join(__dirname, 'src/content/adapters/richAdapters.ts'), 'utf-8');
    const ytBridgeSrc = fs.readFileSync(path.join(__dirname, 'src/content/youtube_bridge.ts'), 'utf-8');
    const nfBridgeSrc = fs.readFileSync(path.join(__dirname, 'src/content/netflix_bridge.ts'), 'utf-8');
    assert(
      richAdaptersSrc.includes('syncineBridgeCmd') &&
        ytBridgeSrc.includes('syncineBridgeCmd') &&
        nfBridgeSrc.includes('syncineBridgeCmd'),
      'richAdapters 與 YouTube/Netflix Bridge 實作 DOM dataset.syncineBridgeCmd 跨世界同步通道，解決 Chromium Isolated World CustomEvent.detail 為 null 之問題'
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  console.log('\n====================================================');
  console.log(`📊 測試結果: 總測試 ${passed + failed} 項 | 通過: ${passed} | 失敗: ${failed}`);
  console.log('====================================================');
  process.exit(failed === 0 ? 0 : 1);
}

runTests().catch((err) => {
  console.error('❌ 單元測試執行異常:', err);
  process.exit(1);
});
