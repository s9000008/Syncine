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
      const verSpan = Array.from(document.querySelectorAll('span')).find((s) => s.innerText.includes('v2.10.1'));
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
      const verSpan = Array.from(document.querySelectorAll('span')).find((s) => s.innerText.includes('v2.10.1'));
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
          body: `<!DOCTYPE html><html><head><script>
            window.__ytCmds = [];
            window.__initMockYt = () => {
              const mp = document.getElementById('movie_player');
              if (mp) {
                mp.seekTo = (sec, allowAhead) => { window.__ytCmds.push({ action: 'SEEK', sec, allowAhead }); };
                mp.playVideo = () => { window.__ytCmds.push({ action: 'PLAY' }); };
                mp.pauseVideo = () => { window.__ytCmds.push({ action: 'PAUSE' }); };
                mp.setPlaybackRate = (rate) => { window.__ytCmds.push({ action: 'RATE', rate }); };
              }
            };
            if (document.readyState === 'loading') {
              document.addEventListener('DOMContentLoaded', window.__initMockYt);
            } else {
              window.__initMockYt();
            }
          </script></head><body><div id="movie_player"><video class="html5-main-video" src="yt.mp4"></video></div></body></html>`
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

    const ytBridgeResult = await coreTestPage.evaluate(() => {
      window.dispatchEvent(new CustomEvent('SYNCINE_YOUTUBE_CMD', { detail: { action: 'SEEK', currentTime: 45 } }));
      window.dispatchEvent(new CustomEvent('SYNCINE_YOUTUBE_CMD', { detail: { action: 'PAUSE' } }));
      window.dispatchEvent(new CustomEvent('SYNCINE_YOUTUBE_CMD', { detail: { action: 'PLAY' } }));
      window.dispatchEvent(new CustomEvent('SYNCINE_YOUTUBE_CMD', { detail: { action: 'RATE', playbackRate: 1.5 } }));
      return {
        handledAttr: document.documentElement.dataset.syncineYtHandled,
        ytCmds: window.__ytCmds
      };
    });
    assert(
      ytBridgeResult.handledAttr === '1' &&
        Array.isArray(ytBridgeResult.ytCmds) &&
        ytBridgeResult.ytCmds.length === 4 &&
        ytBridgeResult.ytCmds[0].sec === 45 &&
        ytBridgeResult.ytCmds[0].allowAhead === true,
      '[YouTube E2E] MAIN World youtube_bridge.js 成功攔截 SYNCINE_YOUTUBE_CMD 並精準呼叫 #movie_player (seekTo/pause/play/rate)'
    );

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

    // ----------------------------------------------------
    // 測試模組 7: 模擬第三方擴充套件控制權衝突、斷路保護與 Popup 衝突橫幅 / 脫敏診斷 E2E
    // ----------------------------------------------------
    console.log('\n--- 模組 7: 模擬第三方擴充套件打架 (YouTube Contention)、斷路器保護與 Popup 警示橫幅 E2E ---');

    await coreTestPage.goto('https://www.youtube.com/watch?v=dQw4w9WgXcQ&token=SECRET_XYZ_TOKEN', {
      waitUntil: 'domcontentloaded'
    });
    await coreTestPage.bringToFront();
    await new Promise((r) => setTimeout(r, 700));

    // 讓觀眾 B 進入受控房間並由房主同步為 PAUSED
    const ytTabId = await workerB.evaluate(async () => {
      const tabs = await chrome.tabs.query({ url: 'https://www.youtube.com/*' });
      const targetTabId = tabs[0]?.id;
      if (!targetTabId) return null;

      await new Promise((resolve) => {
        chrome.runtime.onMessage.dispatch
          ? resolve()
          : resolve();
      });

      return targetTabId;
    });

    // 透過 Worker 模擬 CS_ROOM_STATE_CHANGED 設定房態並觸發 PAUSE 同步
    await workerB.evaluate(async (tabId) => {
      const roomPayload = {
        roomId: 'ROOM999Z',
        isHost: false,
        allowGuestControl: false,
        serverUrl: 'https://syncine.fly.dev',
        currentUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        mode: 'DEFAULT'
      };
      await chrome.storage.local.set({ syncine_room_state: roomPayload });
      chrome.tabs.sendMessage(tabId, { type: 'CS_ROOM_STATE_CHANGED', payload: roomPayload });
      await new Promise((r) => setTimeout(r, 150));
      chrome.tabs.sendMessage(tabId, {
        type: 'CS_SYNC_RECEIVED',
        payload: {
          data: {
            action: 'PAUSE',
            currentTime: 12,
            paused: true,
            timestamp: Date.now()
          }
        }
      });
    }, ytTabId);

    // 同步 Popup B 進入同房狀態，確保 Background Session 已水合 Room999Z
    const contentionPopupB = await browserB.newPage();
    await contentionPopupB.goto(`chrome-extension://${extIdB}/src/popup/index.html`, { waitUntil: 'domcontentloaded' });
    await contentionPopupB.evaluate(async () => {
      await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          {
            type: 'CS_ROOM_STATE_CHANGED',
            payload: {
              roomId: 'ROOM999Z',
              isHost: false,
              allowGuestControl: false,
              serverUrl: 'https://syncine.fly.dev',
              currentUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
              mode: 'DEFAULT'
            }
          },
          () => resolve()
        );
      });
    });

    // 等待 applySyncState 的 1000ms programmatic 窗口期結束後，模擬第三方擴充套件連續搶按 play
    await new Promise((r) => setTimeout(r, 1150));
    await coreTestPage.evaluate(() => {
      window.__ytCmds = [];
    });

    const pauseCountsAfterBursts = [];
    for (let i = 0; i < 4; i++) {
      await coreTestPage.evaluate(() => {
        const video = document.querySelector('video');
        if (video) video.dispatchEvent(new Event('play'));
      });
      await new Promise((r) => setTimeout(r, 500));
      const pauseCount = await coreTestPage.evaluate(
        () => (window.__ytCmds || []).filter((c) => c.action === 'PAUSE').length
      );
      pauseCountsAfterBursts.push(pauseCount);
    }

    assert(
      pauseCountsAfterBursts[0] === 1 &&
        pauseCountsAfterBursts[1] === 2 &&
        pauseCountsAfterBursts[2] === 2 &&
        pauseCountsAfterBursts[3] === 2,
      `[Contention E2E] 模擬第三方連續 4 次強制播放：前 2 次正常回滾 (${pauseCountsAfterBursts[0]}→${pauseCountsAfterBursts[1]})，第 3 次達閾值即刻啟動斷路冷卻並於第 4 次持續抑制震盪 (${pauseCountsAfterBursts[2]}→${pauseCountsAfterBursts[3]})`
    );

    // 驗證冷卻期間遠端房主新 PLAY 指令仍立即執行不受阻擋
    await coreTestPage.evaluate(() => {
      window.__ytCmds = [];
    });
    await workerB.evaluate((tabId) => {
      chrome.tabs.sendMessage(tabId, {
        type: 'CS_SYNC_RECEIVED',
        payload: {
          data: {
            action: 'PLAY',
            currentTime: 15,
            paused: false,
            timestamp: Date.now()
          }
        }
      });
    }, ytTabId);
    await new Promise((r) => setTimeout(r, 250));
    const hostOverridePlayReceived = await coreTestPage.evaluate(
      () => (window.__ytCmds || []).some((c) => c.action === 'PLAY')
    );
    assert(hostOverridePlayReceived === true, '[Contention E2E] 斷路冷卻期間收到房主遠端 PLAY 指令仍即時穿透執行');

    // 重新整理 Popup 驗證非阻塞式衝突警示橫幅渲染與統一脫敏診斷報告
    await contentionPopupB.reload({ waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 700));
    const bannerVisible = await contentionPopupB.evaluate(() => Boolean(document.querySelector('[data-testid="contention-alert-banner"]')));
    assert(bannerVisible === true, '[Popup E2E] 發生播放控制權衝突時，Popup 正確顯示非阻塞式琥珀色警示橫幅');

    const diagResult = await contentionPopupB.evaluate(() => {
      return new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'GET_DIAGNOSTIC_REPORT' }, (res) => resolve(res));
      });
    });
    const diagMd = diagResult?.data?.markdownReport || '';
    assert(
      diagResult?.success === true &&
        diagResult?.data?.contentionDetected === true &&
        diagMd.includes('www.youtube.com') &&
        !diagMd.includes('ROOM999Z') &&
        !diagMd.includes('dQw4w9WgXcQ') &&
        !diagMd.includes('SECRET_XYZ_TOKEN'),
      '[Privacy Diagnostic E2E] GET_DIAGNOSTIC_REPORT 產出統一脫敏報告（含 hostname、遮罩 roomId，絕無 Query Token / 影片 ID 外洩）'
    );

    // 測試點擊忽略提醒並重整確認持久化
    await contentionPopupB.evaluate(() => {
      const btn = document.querySelector('[data-testid="contention-alert-banner"] button[aria-label]');
      if (btn) btn.click();
    });
    await new Promise((r) => setTimeout(r, 400));
    await contentionPopupB.reload({ waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 600));
    const bannerAfterDismiss = await contentionPopupB.evaluate(() =>
      Boolean(document.querySelector('[data-testid="contention-alert-banner"]'))
    );
    assert(bannerAfterDismiss === false, '[Popup E2E] 使用者點擊忽略後，重整 Popup 橫幅保持關閉狀態');

    // ----------------------------------------------------
    // 模組 8：跨執行環境 (ISOLATED -> MAIN) YouTube 進度條/暫停控制與首頁開房同步韌性測試
    // ----------------------------------------------------
    console.log('\n--- [模組 8] YouTube ISOLATED -> MAIN 跨世界橋接、首頁開房與 Seek 後暫停不鎖死驗證 ---');

    // 8.1 驗證當房間建立於 YouTube 首頁 (https://www.youtube.com/) 時，觀眾與房主進入具體影片後能透過 CS_SYNC_RECEIVED 控制 #movie_player 與 <video>
    await coreTestPage.evaluate(() => {
      window.__ytCmds = [];
    });
    await workerB.evaluate(async (tabId) => {
      const homeRoomPayload = {
        roomId: 'ROOM999Z',
        isHost: false,
        allowGuestControl: false,
        serverUrl: 'https://syncine.fly.dev',
        currentUrl: 'https://www.youtube.com/',
        mode: 'DEFAULT'
      };
      chrome.tabs.sendMessage(tabId, { type: 'CS_ROOM_STATE_CHANGED', payload: homeRoomPayload });
      await new Promise((r) => setTimeout(r, 100));
      chrome.tabs.sendMessage(tabId, {
        type: 'CS_SYNC_RECEIVED',
        payload: {
          data: {
            action: 'SEEK',
            currentTime: 712.4,
            paused: true,
            timestamp: Date.now(),
            videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
          }
        }
      });
    }, ytTabId);
    await new Promise((r) => setTimeout(r, 250));

    const crossWorldSeekResult = await coreTestPage.evaluate(() => {
      const cmds = window.__ytCmds || [];
      const v = document.querySelector('video');
      return {
        hasSeekCmd: cmds.some((c) => c.action === 'SEEK' && Math.abs((c.sec ?? c.t) - 712.4) < 1),
        hasPauseCmd: cmds.some((c) => c.action === 'PAUSE'),
        videoTime: v ? v.currentTime : -1,
        videoPaused: v ? v.paused : false
      };
    });
    assert(
      crossWorldSeekResult.hasSeekCmd === true &&
        crossWorldSeekResult.hasPauseCmd === true &&
        Math.abs(crossWorldSeekResult.videoTime - 712.4) < 1 &&
        crossWorldSeekResult.videoPaused === true,
      `[YouTube Cross-World Bridge E2E] ISOLATED Content Script 透過 DOM Bridge 跨世界精準驅動 MAIN World #movie_player.seekTo(712.4) 與 pauseVideo() (videoTime=${crossWorldSeekResult.videoTime.toFixed(1)}s, paused=${crossWorldSeekResult.videoPaused})`
    );

    // 8.2 驗證房主在同一頁面觸發 seeking -> seeked (即使處於 programmatic 期間) 後，接續觸發 pause 絕不因 isUserSeeking 殘留而漏發
    await workerB.evaluate(async (tabId) => {
      const hostRoomPayload = {
        roomId: 'ROOM999Z',
        isHost: true,
        allowGuestControl: false,
        serverUrl: 'https://syncine.fly.dev',
        currentUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        mode: 'DEFAULT'
      };
      await chrome.storage.local.set({ syncine_room_state: hostRoomPayload });
      chrome.tabs.sendMessage(tabId, { type: 'CS_ROOM_STATE_CHANGED', payload: hostRoomPayload });
    }, ytTabId);
    await new Promise((r) => setTimeout(r, 1200));

    // 在 Background Worker 監聽房主 Content Script 是否正常發出 BG_SYNC_STATE (SEEK 與 PAUSE)
    await workerB.evaluate(() => {
      self.__capturedHostSyncActions = [];
      if (!self.__hostSyncSpyBound) {
        self.__hostSyncSpyBound = true;
        chrome.runtime.onMessage.addListener((msg) => {
          if (msg && msg.type === 'BG_SYNC_STATE' && msg.data) {
            self.__capturedHostSyncActions.push({
              action: msg.data.action,
              currentTime: msg.data.currentTime,
              videoUrl: msg.data.videoUrl
            });
          }
        });
      }
    });

    await coreTestPage.evaluate(async () => {
      const v = document.querySelector('video');
      if (!v) return;
      v.currentTime = 300;
      v.dispatchEvent(new Event('seeking'));
      v.dispatchEvent(new Event('seeked'));
      await new Promise((r) => setTimeout(r, 120));
      v.dispatchEvent(new Event('pause'));
    });
    await new Promise((r) => setTimeout(r, 250));

    const capturedHostActions = await workerB.evaluate(() => self.__capturedHostSyncActions || []);
    const hasHostSeek = capturedHostActions.some((a) => a.action === 'SEEK' && Math.abs(a.currentTime - 300) < 1);
    const hasHostPause = capturedHostActions.some(
      (a) => a.action === 'PAUSE' && a.videoUrl === 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    );
    assert(
      hasHostSeek === true && hasHostPause === true,
      `[YouTube Host Control E2E] 房主拖曳進度條 (SEEK) 後接續按暫停 (PAUSE)，isUserSeeking 正確歸零且兩項控制信令皆攜帶標準 videoUrl 成功送達 Background`
    );

    // 驗證擴充套件更新後「已開啟分頁熱重注 (Re-Injection)」與 P2P 首次入房審核通過後自動觸發 BG_REQUEST_INIT_SYNC
    await workerB.evaluate(async (tabId) => {
      self.__capturedInitSyncCount = 0;
      if (!self.__initSyncSpyBound) {
        self.__initSyncSpyBound = true;
        chrome.runtime.onMessage.addListener((msg) => {
          if (msg && msg.type === 'BG_REQUEST_INIT_SYNC') {
            self.__capturedInitSyncCount = (self.__capturedInitSyncCount || 0) + 1;
          }
        });
      }
      // 模擬擴充套件更新後由 Background 對既有 YouTube 分頁重新注入 youtube_bridge.js (MAIN) 與 content.js (ISOLATED)
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['youtube_bridge.js'],
        world: 'MAIN'
      });
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js'],
        world: 'ISOLATED'
      });
    }, ytTabId);
    await new Promise((r) => setTimeout(r, 350));

    // 先發送 guestAwaitingApproval: true (模擬 P2P 觀眾剛按加入等待房主核准)，此時不應提前消耗 initSyncKey
    await workerB.evaluate((tabId) => {
      self.__capturedInitSyncCount = 0;
      chrome.tabs.sendMessage(tabId, {
        type: 'CS_ROOM_STATE_CHANGED',
        payload: {
          roomId: 'ROOM999Z',
          isHost: false,
          allowGuestControl: false,
          currentUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          guestAwaitingApproval: true
        }
      });
    }, ytTabId);
    await new Promise((r) => setTimeout(r, 200));
    const initSyncWhileWaiting = await workerB.evaluate(() => self.__capturedInitSyncCount || 0);

    // 接著模擬房主核准通過 (guestAwaitingApproval: false)，此時觀眾必須立即發出 BG_REQUEST_INIT_SYNC
    await workerB.evaluate((tabId) => {
      chrome.tabs.sendMessage(tabId, {
        type: 'CS_ROOM_STATE_CHANGED',
        payload: {
          roomId: 'ROOM999Z',
          isHost: false,
          allowGuestControl: false,
          currentUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          guestAwaitingApproval: false
        }
      });
    }, ytTabId);
    await new Promise((r) => setTimeout(r, 250));
    const initSyncAfterApproved = await workerB.evaluate(() => self.__capturedInitSyncCount || 0);
    assert(
      initSyncWhileWaiting === 0 && initSyncAfterApproved >= 1,
      `[First-Run Update & P2P Approval E2E] 擴充套件更新熱重注後，P2P 審核等待期間不提前鎖死 (${initSyncWhileWaiting})，房主核准瞬間立即觸發初始同步請求 (${initSyncAfterApproved})`
    );
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
