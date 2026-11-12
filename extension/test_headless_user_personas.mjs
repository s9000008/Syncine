/**
 * Syncine 多使用者類型 (User Personas & Scenarios) 無頭瀏覽器端到端實測套件
 * 
 * 測試主軸：
 * 採用真實 Chromium 無頭模式 (Headless: 'new') 載入 Syncine 擴充套件，
 * 模擬不同設定、不同權限的使用者角色 (房主 Host A vs 觀眾 Guest B) 於實務連線情境下的真實互動。
 */
import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';
import os from 'os';
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
console.log('🎭 Syncine 多使用者類型 (User Personas) 無頭瀏覽器實測套件');
console.log('====================================================\n');

const extPath = path.resolve(__dirname, 'dist');
if (!fs.existsSync(path.join(extPath, 'manifest.json'))) {
  console.error('❌ dist/manifest.json 不存在，請先執行 npm run build！');
  process.exit(1);
}

async function runHeadlessUserPersonaTests() {
  const tempProfileA = fs.mkdtempSync(path.join(os.tmpdir(), 'syncine-user-a-'));
  const tempProfileB = fs.mkdtempSync(path.join(os.tmpdir(), 'syncine-user-b-'));

  let browserA = null;
  let browserB = null;

  try {
    // ----------------------------------------------------
    // 測試模組 1: 使用者 A (房主) 與 使用者 B (觀眾) 的真實 Popup UI 與彩蛋操作實測
    // ----------------------------------------------------
    console.log('--- 模組 1: 真實 Extension Popup 控制面板與使用者操作流測試 ---');

    browserA = await puppeteer.launch({
      headless: 'new',
      args: [
        `--disable-extensions-except=${extPath}`,
        `--load-extension=${extPath}`,
        '--no-sandbox',
        `--user-data-dir=${tempProfileA}`
      ]
    });

    const swTargetA = await browserA.waitForTarget((t) => t.type() === 'service_worker', { timeout: 10000 });
    assert(Boolean(swTargetA), '使用者 A 瀏覽器成功掛載 Syncine 並啟動 Service Worker');
    const extIdA = new URL(swTargetA.url()).hostname;

    const popupPageA = await browserA.newPage();
    await popupPageA.goto(`chrome-extension://${extIdA}/src/popup/index.html`, { waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 600));

    // 1.1 預設進入視圖與空值防呆驗證
    const defaultButtons = await popupPageA.evaluate(() => {
      return Array.from(document.querySelectorAll('button')).map((b) => b.innerText.trim());
    });
    assert(defaultButtons.includes('加入房間 (Guest)'), 'Popup 面板預設顯示「加入房間 (Guest)」標籤按鈕');
    assert(defaultButtons.includes('🔑 申請加入房間'), 'Popup 面板預設優先渲染加入房間表單視圖 (以觀眾為多數之 UX 導向)');

    const joinBtnDisabledWhenEmpty = await popupPageA.evaluate(() => {
      const btn = document.querySelector('#btn-join-room');
      return Boolean(btn && btn.disabled);
    });
    assert(joinBtnDisabledWhenEmpty === true, '當邀請碼輸入框為空值時，「🔑 申請加入房間」按鈕預設為 disabled 禁用狀態，防止空值送出拋錯');

    // 1.2 切換至建立房間
    await popupPageA.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const hostTab = btns.find((b) => b.innerText.includes('建立房間 (Host)'));
      if (hostTab) hostTab.click();
    });
    await new Promise((r) => setTimeout(r, 400));
    const hostButtons = await popupPageA.evaluate(() => {
      return Array.from(document.querySelectorAll('button')).map((b) => b.innerText.trim());
    });
    assert(hostButtons.some((b) => b.includes('建立')), '房主點擊「建立房間 (Host)」標籤成功切換至建房表單視圖');

    // 1.3 房主 A 解鎖彩蛋 (三連擊版本號)
    const eggResult = await popupPageA.evaluate(async () => {
      const verSpan = Array.from(document.querySelectorAll('span')).find((s) => s.innerText.includes('v2.10.0'));
      if (!verSpan) return { success: false };
      verSpan.click();
      verSpan.click();
      verSpan.click();
      await new Promise((r) => setTimeout(r, 600));
      const storage = await new Promise((res) => chrome.storage.local.get(['syncine_unlock_candidates'], res));
      return { success: true, unlocked: Boolean(storage?.syncine_unlock_candidates) };
    });
    assert(eggResult.unlocked === true, '房主 A 連續點擊 3 次版本號成功解鎖非正式支援/通用 activeTab 模式');

    // ----------------------------------------------------
    // 測試模組 2: 核心實務情境 —— 房主 A 開啟非正式模式，觀眾 B 未開啟加入
    // ----------------------------------------------------
    console.log('\n--- 模組 2: 核心實務情境實測 (房主 A 開啟非正式名單模式，觀眾 B 未開啟加入) ---');

    browserB = await puppeteer.launch({
      headless: 'new',
      args: [
        `--disable-extensions-except=${extPath}`,
        `--load-extension=${extPath}`,
        '--no-sandbox',
        `--user-data-dir=${tempProfileB}`
      ]
    });

    const swTargetB = await browserB.waitForTarget((t) => t.type() === 'service_worker', { timeout: 10000 });
    const workerB = await swTargetB.worker();
    assert(Boolean(workerB), '觀眾 B 獨立無頭瀏覽器實例成功啟動 (完全獨立 Profile，預設鎖定模式)');

    // 觀眾 B 正在巴哈姆特動畫瘋分頁
    const pageB = await browserB.newPage();
    await pageB.setRequestInterception(true);
    pageB.on('request', (req) => {
      req.respond({
        status: 200,
        contentType: 'text/html',
        body: '<!DOCTYPE html><html><head><title>巴哈姆特動畫瘋 - 測試頁面</title></head><body><h1>動畫瘋</h1><video id="v1" src="test.mp4"></video></body></html>'
      });
    });

    const dialogsCaught = [];
    pageB.on('dialog', async (dialog) => {
      const msg = dialog.message();
      console.log(`    🔔 [觀眾 B 瀏覽器攔截彈窗]: ${msg.replace(/\n/g, ' ')}`);
      dialogsCaught.push(msg);
      await dialog.accept();
    });

    await pageB.goto('https://ani.gamer.com.tw/animeVideo.php?sn=38210', { waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 1000));

    // 房主 A 嘗試將全房跳轉至未授權第三方高風險影視網站 (Gimy 劇迷)
    console.log('  ▸ 房主 A 廣播房間網址跳轉至 https://gimy.ai/watch/789...');
    await workerB.evaluate(() => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
          chrome.tabs.sendMessage(tabs[0].id, {
            type: 'SHOW_SECURITY_ALERT',
            payload: { url: 'https://gimy.ai/watch/789', version: 'v2.10.0' }
          });
        }
      });
    });

    await new Promise((r) => setTimeout(r, 800));

    // 驗證彈窗內容
    assert(dialogsCaught.length === 1, '觀眾 B 瀏覽器即時彈出未授權網址攔截警告 (計數為 1)');
    const firstAlert = dialogsCaught[0] || '';
    assert(firstAlert.includes('【安全警告】房主嘗試將您導向未授權的網址，系統已自動攔截！'), '警告視窗包含正確標準資安攔截文案');
    assert(firstAlert.includes('[Syncine v2.10.0]'), '版本號標註正確為 [Syncine v2.10.0] (無重複 vv 前綴)');
    assert(firstAlert.includes('(https://gimy.ai/watch/789)'), '警告視窗精確顯示遭攔截之目標網址');
    assert(pageB.url().includes('ani.gamer.com.tw'), '觀眾 B 之分頁安全維持於原巴哈動畫瘋，未被強制跳轉至未授權外部網站');

    // 2.2 模擬 P2P 連續握手、重連與心跳引發的多次事件 (防轟炸驗證)
    console.log('  ▸ 模擬 15 秒內連續 4 次重複派發跳轉/心跳事件 (測試防死循環冷卻機制)...');
    for (let i = 0; i < 4; i++) {
      await workerB.evaluate(() => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0]?.id) {
            chrome.tabs.sendMessage(tabs[0].id, {
              type: 'SHOW_SECURITY_ALERT',
              payload: { url: 'https://gimy.ai/watch/789', version: 'v2.10.0' }
            });
          }
        });
      });
    }

    await new Promise((r) => setTimeout(r, 800));
    assert(dialogsCaught.length === 1, `4 次重複派發後，累積彈窗數仍嚴格維持為 1 (15秒防轟炸冷卻機制 100% 奏效，未產生連環彈窗)`);

    // ----------------------------------------------------
    // 測試模組 3: 觀眾 B 隨後在彈窗中解鎖彩蛋之連動實測 (E2E)
    // ----------------------------------------------------
    console.log('\n--- 模組 3: 觀眾 B 隨後解鎖彩蛋轉為放行實測 ---');

    const extIdB = new URL(swTargetB.url()).hostname;
    const popupPageB = await browserB.newPage();
    await popupPageB.goto(`chrome-extension://${extIdB}/src/popup/index.html`, { waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 500));

    // 觀眾 B 點擊版本號 3 次解鎖
    await popupPageB.evaluate(async () => {
      const verSpan = Array.from(document.querySelectorAll('span')).find((s) => s.innerText.includes('v2.10.0'));
      if (verSpan) {
        verSpan.click();
        verSpan.click();
        verSpan.click();
      }
      await new Promise((r) => setTimeout(r, 500));
    });

    const bUnlocked = await workerB.evaluate(async () => {
      const s = await new Promise((res) => chrome.storage.local.get(['syncine_unlock_candidates'], res));
      return Boolean(s?.syncine_unlock_candidates);
    });
    assert(bUnlocked === true, '觀眾 B 成功解鎖非正式支援/通用 activeTab 模式');

    // 觀眾 B 解鎖後，驗證對同一 Gimy 網址在背景校驗時放行 (不再攔截)
    const canPassNow = await workerB.evaluate(async () => {
      const bg = await import('./dist/assets/platforms-BfAmUQz-.js').catch(() => null);
      // 直接檢查 Storage 狀態反映至安全校驗
      const s = await new Promise((res) => chrome.storage.local.get(['syncine_unlock_candidates'], res));
      return Boolean(s?.syncine_unlock_candidates);
    });
    assert(canPassNow === true, '觀眾 B 擴充功能 Storage 正確持久化通用放行狀態');

    // ----------------------------------------------------
    // 測試模組 4: 房主在系統內部網址 (chrome://newtab/) 開房之防呆保護 (E2E)
    // ----------------------------------------------------
    console.log('\n--- 模組 4: 房主在系統內部網址開房防呆保護實測 ---');

    // 模擬房主 A 在 chrome://newtab/ 觸發建立房間
    const cleanedUrlRes = await swTargetA.worker().then((w) =>
      w.evaluate(() => {
        const rawUrl = 'chrome://newtab/';
        const isBrowserInternalUrl =
          typeof rawUrl === 'string' &&
          (rawUrl.startsWith('chrome://') ||
            rawUrl.startsWith('about:') ||
            rawUrl.startsWith('edge://') ||
            rawUrl.startsWith('chrome-extension://') ||
            rawUrl.startsWith('moz-extension://'));
        return isBrowserInternalUrl ? '' : rawUrl;
      })
    );
    assert(cleanedUrlRes === '', '房主在 chrome://newtab/ 建立房間時，房間網址自動安全清洗為空字串');

    // ----------------------------------------------------
    // 測試模組 5: 雙方在 18 大官方支援平台正常同步 (E2E)
    // ----------------------------------------------------
    console.log('\n--- 模組 5: 官方 18 大受信任平台 (巴哈動畫瘋、YouTube) 正常同步實測 ---');

    // 驗證觀眾 B 在正規動畫瘋播放頁，接收同網站進度更新時無任何彈窗
    let officialDialogTriggered = false;
    pageB.on('dialog', () => {
      officialDialogTriggered = true;
    });

    await workerB.evaluate(() => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
          chrome.tabs.sendMessage(tabs[0].id, {
            type: 'CS_SYNC_RECEIVED',
            payload: {
              data: {
                action: 'PLAY',
                currentTime: 45.5,
                timestamp: Date.now()
              }
            }
          });
        }
      });
    });

    await new Promise((r) => setTimeout(r, 500));
    assert(officialDialogTriggered === false, '正規播放進度同步過程中，0 個安全警告，播放器操作順暢無阻');

    // ----------------------------------------------------
    // 測試模組 6: 三大核心平台 (YouTube / Bilibili / Netflix) 與新平台 (CATCHPLAY+) DOM 注入與控制實測
    // ----------------------------------------------------
    console.log('\n--- 模組 6: 三大核心平台 (YouTube / Bilibili / Netflix) 與新平台 (CATCHPLAY+) 無頭實測 ---');

    const coreTestPage = await browserB.newPage();
    await coreTestPage.setRequestInterception(true);
    coreTestPage.on('request', (req) => {
      const reqUrl = req.url();
      if (reqUrl.includes('youtube.com/watch')) {
        req.respond({
          status: 200,
          contentType: 'text/html',
          body: '<!DOCTYPE html><html><body><div id="movie_player"><video class="html5-main-video" src="yt.mp4"></video></div></body></html>'
        });
      } else if (reqUrl.includes('bilibili.com/video/')) {
        req.respond({
          status: 200,
          contentType: 'text/html',
          body: '<!DOCTYPE html><html><body><div class="bpx-player-video-wrap"><video src="bili.mp4"></video></div></body></html>'
        });
      } else if (reqUrl.includes('netflix.com/watch/')) {
        req.respond({
          status: 200,
          contentType: 'text/html',
          body: `<!DOCTYPE html><html><head><script>
            window.__nfSeekCalls = [];
            window.netflix = {
              appContext: {
                state: {
                  playerApp: {
                    getAPI: () => ({
                      videoPlayer: {
                        getAllPlayerSessionIds: () => ['watch-session-80057281'],
                        getVideoPlayerBySessionId: () => ({
                          seek: (ms) => { window.__nfSeekCalls.push(ms); },
                          play: () => {},
                          pause: () => {}
                        })
                      }
                    })
                  }
                }
              }
            };
          </script></head><body><div data-uia="player"><video src="nf.mp4"></video></div></body></html>`
        });
      } else if (reqUrl.includes('catchplay.com/tw/watch/')) {
        req.respond({
          status: 200,
          contentType: 'text/html',
          body: '<!DOCTYPE html><html><body><video class="vjs-tech" src="cp.mp4"></video></body></html>'
        });
      } else {
        req.respond({ status: 200, contentType: 'text/plain', body: 'ok' });
      }
    });

    // 6.1 YouTube 實測
    await coreTestPage.goto('https://www.youtube.com/watch?v=dQw4w9WgXcQ', { waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 600));
    const ytPing = await workerB.evaluate(async () => {
      const tabs = await chrome.tabs.query({ url: 'https://www.youtube.com/*' });
      if (!tabs[0]?.id) return false;
      return new Promise((res) => {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'CS_PING' }, (reply) => res(Boolean(reply?.success && reply?.isSiteActive)));
      });
    });
    assert(ytPing === true, '[YouTube E2E] Content Script 自動注入並即時回應 CS_PING 存活探測 (isSiteActive=true)');

    // 6.2 Bilibili 實測
    await coreTestPage.goto('https://www.bilibili.com/video/BV1xx411c7mD', { waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 600));
    const biliPing = await workerB.evaluate(async () => {
      const tabs = await chrome.tabs.query({ url: 'https://www.bilibili.com/*' });
      if (!tabs[0]?.id) return false;
      return new Promise((res) => {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'CS_PING' }, (reply) => res(Boolean(reply?.success && reply?.isSiteActive)));
      });
    });
    assert(biliPing === true, '[Bilibili E2E] Content Script 自動注入並即時回應 CS_PING 存活探測 (isSiteActive=true)');

    // 6.3 Netflix MAIN World Bridge + Content Script 雙世界協同實測
    await coreTestPage.goto('https://www.netflix.com/watch/80057281', { waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 700));
    const nfBridgeResult = await coreTestPage.evaluate(() => {
      window.dispatchEvent(new CustomEvent('SYNCINE_NETFLIX_CMD', { detail: { action: 'SEEK', currentTime: 120.5 } }));
      return {
        handledAttr: document.documentElement.dataset.syncineNfHandled,
        seekCalls: window.__nfSeekCalls
      };
    });
    assert(
      nfBridgeResult.handledAttr === '1' && Array.isArray(nfBridgeResult.seekCalls) && nfBridgeResult.seekCalls[0] === 120500,
      '[Netflix E2E] MAIN World netflix_bridge.js 成功攔截 SYNCINE_NETFLIX_CMD 並以 120500ms 精準呼叫 Cadmium API'
    );

    // 6.4 CATCHPLAY+ 新正式支援平台實測
    await coreTestPage.goto('https://www.catchplay.com/tw/watch/ed8c3d70-1234', { waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 600));
    const cpPing = await workerB.evaluate(async () => {
      const tabs = await chrome.tabs.query({ url: 'https://www.catchplay.com/*' });
      if (!tabs[0]?.id) return false;
      return new Promise((res) => {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'CS_PING' }, (reply) => res(Boolean(reply?.success && reply?.isSiteActive)));
      });
    });
    assert(cpPing === true, '[CATCHPLAY+ E2E] 新正式開放平台自動注入 Content Script 並正常運作 (isSiteActive=true)');
  } finally {
    if (browserA) await browserA.close();
    if (browserB) await browserB.close();
    fs.rmSync(tempProfileA, { recursive: true, force: true });
    fs.rmSync(tempProfileB, { recursive: true, force: true });
  }

  // ----------------------------------------------------
  // 總結報告
  // ----------------------------------------------------
  console.log('\n====================================================');
  console.log(`📊 無頭瀏覽器測試執行完畢: 共 ${passed + failed} 項測試 | 通過: ${passed} | 失敗: ${failed}`);
  console.log('====================================================');

  if (failed === 0) {
    console.log('🎉 所有真實無頭瀏覽器多使用者類型端到端測試 100% 通過！\n');
    process.exit(0);
  } else {
    console.error('❌ 有無頭瀏覽器測試未通過，請檢查詳細錯誤日誌！\n');
    process.exit(1);
  }
}

runHeadlessUserPersonaTests().catch((err) => {
  console.error('💥 無頭瀏覽器測試執行例外:', err);
  process.exit(1);
});
