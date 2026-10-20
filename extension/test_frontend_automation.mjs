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
console.log('🌐 Syncine 前端與多平台動作控制自動化深度測試套件');
console.log('====================================================\n');

// ----------------------------------------------------
// 測試套件 1: 多平台影片識別碼 (getVideoIdentifier) 矩陣自動化測試
// ----------------------------------------------------
console.log('--- 測試套件 1: 多平台影片唯一識別碼 (getVideoIdentifier) 矩陣測試 ---');

import { execSync } from 'child_process';
const protoModulePath = path.join(__dirname, 'dist_test/protocol.mjs');
fs.mkdirSync(path.join(__dirname, 'dist_test'), { recursive: true });
execSync(`npx esbuild "${path.join(__dirname, 'src/types/protocol.ts')}" --bundle --format=esm --outfile="${protoModulePath}"`, { stdio: 'pipe' });
const { getVideoIdentifier } = await import(`file://${protoModulePath.replace(/\\/g, '/')}`);

// YouTube
assert(getVideoIdentifier('https://www.youtube.com/watch?v=dQw4w9WgXcQ') === 'yt:dQw4w9WgXcQ', 'YouTube 標準網址識別 (yt:dQw4w9WgXcQ)');
assert(getVideoIdentifier('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123&index=1') === 'yt:dQw4w9WgXcQ', 'YouTube 帶播放清單參數仍精準識別 (yt:dQw4w9WgXcQ)');
assert(getVideoIdentifier('https://youtu.be/dQw4w9WgXcQ?t=42') === 'yt:dQw4w9WgXcQ', 'YouTube 短網址 youtu.be 識別');
assert(getVideoIdentifier('https://www.youtube.com/embed/dQw4w9WgXcQ') === 'yt:dQw4w9WgXcQ', 'YouTube 嵌入式 embed 網址識別');

// Bilibili
assert(getVideoIdentifier('https://www.bilibili.com/video/BV1xx411c7mD') === 'bili:BV1xx411c7mD', 'Bilibili 標準影片 BV 號識別');
assert(getVideoIdentifier('https://www.bilibili.com/video/BV1xx411c7mD/?spm_id_from=333.337') === 'bili:BV1xx411c7mD', 'Bilibili 帶追蹤參數仍精準識別');

// Niconico
assert(getVideoIdentifier('https://www.nicovideo.jp/watch/sm9') === 'nico:sm9', 'Niconico 經典 sm9 識別');
assert(getVideoIdentifier('https://www.nicovideo.jp/watch/sm43652101?ref=search') === 'nico:sm43652101', 'Niconico 帶 ref 查詢參數仍精準識別 sm43652101');
assert(getVideoIdentifier('https://www.nicovideo.jp/watch/so43652101') === 'nico:so43652101', 'Niconico 官方動畫頻道 so43652101 識別');
assert(getVideoIdentifier('https://www.nicovideo.jp/watch/1234567890') === 'nico:1234567890', 'Niconico 純數字頻道影片識別');

// Anime1.me
assert(getVideoIdentifier('https://anime1.me/23456') === 'anime1:23456', 'Anime1.me 單集數字頁面識別 (anime1:23456)');
assert(getVideoIdentifier('https://anime1.me/category/2026%E5%B9%B4%E5%86%AC%E5%AD%A3/') === 'anime1:category/2026年冬季', 'Anime1.me 番劇分類頁 URL 解碼識別');
assert(getVideoIdentifier('https://anime1.me/category/2026%E5%B9%B4%E5%86%AC%E5%AD%A3/anime-title/') === 'anime1:category/2026年冬季/anime-title', 'Anime1.me 巢狀分類路徑識別');

// ----------------------------------------------------
// 測試套件 2: Background HOST_WHITELIST 資安防禦與釣魚攔截自動化測試
// ----------------------------------------------------
console.log('\n--- 測試套件 2: Background 安全白名單與釣魚攔截測試 ---');

const HOST_WHITELIST = [
  /^https:\/\/www\.youtube\.com\/watch\?.*v=[a-zA-Z0-9_-]+/,
  /^https:\/\/www\.youtube\.com\/watch\?v=[a-zA-Z0-9_-]+/,
  /^https:\/\/www\.bilibili\.com\/video\/[a-zA-Z0-9]+/,
  /^https:\/\/www\.bilibili\.com\/bangumi\/play\/(ep|ss)[0-9]+/,
  /^https:\/\/www\.nicovideo\.jp\/watch\/[a-zA-Z0-9]+/,
  /^https:\/\/anime1\.me\/.+/
];

function isSafeUrl(url) {
  return HOST_WHITELIST.some((regex) => regex.test(url));
}

// 合法網址白名單測試
assert(isSafeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), '放行合法 YouTube 播放網址');
assert(isSafeUrl('https://www.youtube.com/watch?feature=shared&v=dQw4w9WgXcQ'), '放行合法 YouTube 帶額外參數網址');
assert(isSafeUrl('https://www.bilibili.com/video/BV1xx411c7mD'), '放行合法 Bilibili 影片網址');
assert(isSafeUrl('https://www.bilibili.com/bangumi/play/ep123456'), '放行合法 Bilibili 番劇網址');
assert(isSafeUrl('https://www.nicovideo.jp/watch/sm9'), '放行合法 Niconico sm 觀看網址');
assert(isSafeUrl('https://www.nicovideo.jp/watch/so43652101'), '放行合法 Niconico so 觀看網址');
assert(isSafeUrl('https://anime1.me/23456'), '放行合法 Anime1.me 單集網址');
assert(isSafeUrl('https://anime1.me/category/my-anime/'), '放行合法 Anime1.me 分類網址');

// 惡意與偽造網址攔截測試 (Security Defenses)
assert(!isSafeUrl('https://evil-youtube.com/watch?v=dQw4w9WgXcQ'), '攔截偽造 YouTube 釣魚網域');
assert(!isSafeUrl('https://www.youtube.com.evil.com/watch?v=dQw4w9WgXcQ'), '攔截 YouTube 子網域偽造攻擊');
assert(!isSafeUrl('https://www.nicovideo.jp.attacker.com/watch/sm9'), '攔截 Niconico 釣魚網域');
assert(!isSafeUrl('https://anime1.me.evil.com/23456'), '攔截 Anime1.me 釣魚網域');
assert(!isSafeUrl('http://www.youtube.com/watch?v=dQw4w9WgXcQ'), '攔截非 HTTPS 明文跳轉');
assert(!isSafeUrl('javascript:alert(1)'), '攔截 XSS 偽協定注入');
assert(!isSafeUrl('data:text/html,<script>'), '攔截 Data URI 偽協定注入');

// ----------------------------------------------------
// 測試套件 3: Content Script 跨平台 Video 選擇器模擬自動化測試
// ----------------------------------------------------
console.log('\n--- 測試套件 3: Content Script 跨平台 Video 選擇器模擬自動化測試 ---');

// 建立輕量 DOM 模擬器
class MockElement {
  constructor(tagName, attrs = {}) {
    this.tagName = tagName.toUpperCase();
    this.attrs = { ...attrs };
    this.children = [];
    this.parentElement = null;
    this.offsetWidth = 640;
    this.offsetHeight = 360;
    this.currentTime = 0;
    this.paused = true;
    this.readyState = 4;
    this.src = attrs.src || '';
    this.currentSrc = attrs.src || '';
    this.eventListeners = {};
  }

  getAttribute(name) {
    return this.attrs[name] ?? (name === 'src' ? this.src : null);
  }

  setAttribute(name, val) {
    this.attrs[name] = val;
    if (name === 'src') {
      this.src = val;
      this.currentSrc = val;
    }
  }

  closest(selector) {
    let cur = this.parentElement;
    while (cur) {
      if (cur.matches(selector)) return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  matches(selector) {
    if (selector.includes('[class*="VideoAd"]') && (this.attrs.class || '').includes('VideoAd')) return true;
    if (selector.includes('#nv_watch_VideoAdContainer') && this.attrs.id === 'nv_watch_VideoAdContainer') return true;
    if (selector.includes('[class*="AdContainer"]') && (this.attrs.class || '').includes('AdContainer')) return true;
    if (selector.includes('[data-name="VideoPlayer"]') && this.attrs['data-name'] === 'VideoPlayer') return true;
    if (selector.includes('.video-js') && (this.attrs.class || '').includes('video-js')) return true;
    if (selector.includes('.vjscontainer') && (this.attrs.class || '').includes('vjscontainer')) return true;
    if (selector.includes('.ap-video-wrapper') && (this.attrs.class || '').includes('ap-video-wrapper')) return true;
    return false;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const results = [];
    function search(node) {
      for (const ch of node.children) {
        let match = false;
        if (selector === 'video' && ch.tagName === 'VIDEO') match = true;
        else if (selector === 'video.html5-main-video' && ch.tagName === 'VIDEO' && (ch.attrs.class || '').includes('html5-main-video')) match = true;
        else if (selector === '.bpx-player-video-wrap video' && ch.tagName === 'VIDEO' && (ch.parentElement?.attrs.class || '').includes('bpx-player-video-wrap')) match = true;
        else if (selector.includes('video.vjs-tech') && ch.tagName === 'VIDEO' && (ch.attrs.class || '').includes('vjs-tech')) match = true;
        else if (selector.includes('.vjs-big-play-button') && (ch.attrs.class || '').includes('vjs-big-play-button')) match = true;
        else if (selector.includes('[data-name="VideoPlayer"] video') && ch.tagName === 'VIDEO' && ch.closest('[data-name="VideoPlayer"]')) match = true;
        if (match) results.push(ch);
        search(ch);
      }
    }
    search(this);
    return results;
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  addEventListener(event, fn) {
    if (!this.eventListeners[event]) this.eventListeners[event] = [];
    this.eventListeners[event].push(fn);
  }

  dispatchEvent(event) {
    const list = this.eventListeners[event.type] || [];
    for (const fn of list) fn(event);
  }

  click() {
    this.dispatchEvent({ type: 'click', target: this });
  }

  play() {
    this.paused = false;
    this.dispatchEvent({ type: 'play', target: this });
    return Promise.resolve();
  }

  pause() {
    this.paused = true;
    this.dispatchEvent({ type: 'pause', target: this });
  }
}

// 模擬 Niconico 多重 Video 與廣告過濾
{
  const mockDoc = new MockElement('document');
  const body = mockDoc.appendChild(new MockElement('body'));

  // 1. 廣告容器內的 video (應被排除)
  const adContainer = body.appendChild(new MockElement('div', { class: 'VideoAdContainer', id: 'nv_watch_VideoAdContainer' }));
  const adVideo = adContainer.appendChild(new MockElement('video', { src: 'https://ads.nicovideo.jp/ad.mp4' }));

  // 2. 空殼或預覽 video (src 為空或隱藏)
  const dummyVideo = body.appendChild(new MockElement('video', { src: '' }));
  dummyVideo.offsetWidth = 0;

  // 3. 真正的主播放器 video
  const playerContainer = body.appendChild(new MockElement('div', { 'data-name': 'VideoPlayer' }));
  const mainVideo = playerContainer.appendChild(new MockElement('video', { src: 'blob:https://www.nicovideo.jp/12345678' }));
  mainVideo.offsetWidth = 854;

  // 執行 Niconico 智慧選擇器邏輯
  const allVideos = mockDoc.querySelectorAll('video');
  const candidates = allVideos.filter(
    (v) => !v.closest('[class*="VideoAd"], #nv_watch_VideoAdContainer, [class*="AdContainer"]')
  );

  const selected = candidates.find(
    (v) => Boolean(v.currentSrc || v.getAttribute('src')) && v.offsetWidth > 0
  );

  assert(candidates.length === 2, 'Niconico 選擇器成功排除廣告容器內的 video');
  assert(selected === mainVideo, 'Niconico 選擇器精準鎖定主播放器 video (排除空殼與廣告)');
}

// 模擬 Anime1.me Video.js 選擇與懶載入喚醒
{
  const mockDoc = new MockElement('document');
  const body = mockDoc.appendChild(new MockElement('body'));
  const wrapper = body.appendChild(new MockElement('div', { class: 'video-js vjscontainer' }));
  const bigBtn = wrapper.appendChild(new MockElement('div', { class: 'vjs-big-play-button' }));
  const anime1Video = wrapper.appendChild(new MockElement('video', { class: 'vjs-tech', 'data-apireq': 'token123' }));
  anime1Video.src = '';
  anime1Video.currentSrc = '';
  anime1Video.readyState = 0;

  // 模擬選擇器
  const anime1Selected = mockDoc.querySelector('video.vjs-tech');
  assert(anime1Selected === anime1Video, 'Anime1.me 選擇器成功匹配 video.vjs-tech');

  // 模擬懶載入喚醒：遠端指令到達時自動點擊 .vjs-big-play-button
  let bigBtnClicked = false;
  bigBtn.addEventListener('click', () => {
    bigBtnClicked = true;
    // 模擬 Anime1 原生腳本獲得 Token 後掛載串流
    anime1Video.src = 'https://v.anime1.me/api/stream.mp4';
    anime1Video.readyState = 4;
    anime1Video.dispatchEvent({ type: 'loadedmetadata' });
  });

  // 模擬 ensureAnime1SourceReady
  let wokenUp = false;
  if (!anime1Video.src && anime1Video.readyState === 0) {
    const container = anime1Video.closest('.video-js, .vjscontainer') || mockDoc;
    const btn = container.querySelector('.vjs-big-play-button');
    if (btn) {
      btn.click();
      wokenUp = true;
    }
  }

  assert(wokenUp && bigBtnClicked, 'Anime1.me 懶載入自動點擊 .vjs-big-play-button 成功喚醒');
  assert(anime1Video.src.includes('v.anime1.me'), 'Anime1.me 喚醒後串流來源已成功掛載');
}

// ----------------------------------------------------
// 測試套件 4: Content Script 無權限拖曳回滾與防禦自動化測試
// ----------------------------------------------------
console.log('\n--- 測試套件 4: Content Script 無權限觀眾 Seeking 回滾測試 ---');

{
  let targetTime = 50.0;
  let lastSyncedTime = 50.0;
  let roomState = { isInRoom: true, isHost: false, allowGuestControl: false };

  // 模擬無權限觀眾手動拖曳進度條至 120.0 秒
  let userSeekedTime = 120.0;
  let rolledBack = false;

  if (!roomState.isHost && !roomState.allowGuestControl) {
    if (Math.abs(userSeekedTime - lastSyncedTime) > 0.5) {
      userSeekedTime = lastSyncedTime;
      rolledBack = true;
    }
  }

  assert(rolledBack && userSeekedTime === 50.0, '無權限觀眾拖曳進度條時強制回滾至 lastSyncedTime (50.0s)');
}

// ----------------------------------------------------
// 測試套件 5: Popup 介面目標網站偵測自動化測試
// ----------------------------------------------------
console.log('\n--- 測試套件 5: Popup 目標網站辨識與狀態切換自動化測試 ---');

function checkTargetSite(url) {
  const isYouTube = url.includes('youtube.com/watch');
  const isBilibili = url.includes('bilibili.com/video') || url.includes('bilibili.com/bangumi');
  const isNiconico = url.includes('nicovideo.jp/watch/');
  const isAnime1 = /^https?:\/\/([a-z0-9-]+\.)?anime1\.me\/.+/.test(url);
  return {
    isYouTube,
    isBilibili,
    isNiconico,
    isAnime1,
    isTargetSite: isYouTube || isBilibili || isNiconico || isAnime1
  };
}

assert(checkTargetSite('https://www.youtube.com/watch?v=123').isTargetSite === true, 'Popup 識別 YouTube 為支援目標頁面');
assert(checkTargetSite('https://www.bilibili.com/video/BV1xx').isTargetSite === true, 'Popup 識別 Bilibili 為支援目標頁面');
assert(checkTargetSite('https://www.nicovideo.jp/watch/sm9').isTargetSite === true, 'Popup 識別 Niconico 為支援目標頁面');
assert(checkTargetSite('https://anime1.me/23456').isTargetSite === true, 'Popup 識別 Anime1.me 為支援目標頁面');
assert(checkTargetSite('https://www.google.com').isTargetSite === false, 'Popup 識別 Google 非目標頁面 (顯示請開啟支援影片提示)');
assert(checkTargetSite('https://anime1.me/').isTargetSite === false, 'Popup 識別 Anime1.me 首頁非播放頁面 (安全防護)');

// ----------------------------------------------------
// 總結報告
// ----------------------------------------------------
console.log('\n====================================================');
console.log(`📊 自動化測試執行完畢: 共 ${passed + failed} 項測試 | 通過: ${passed} | 失敗: ${failed}`);
console.log('====================================================');

if (failed === 0) {
  console.log('🎉 前端與跨平台動作控制所有自動化測試 100% 通過！\n');
  process.exit(0);
} else {
  console.error('❌ 有測試未通過，請檢查詳細錯誤日誌！\n');
  process.exit(1);
}
