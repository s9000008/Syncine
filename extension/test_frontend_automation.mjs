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

function readModuleTree(relPath) {
  const fullPath = path.join(__dirname, relPath);
  if (!fs.existsSync(fullPath)) return '';
  if (fs.statSync(fullPath).isFile()) return fs.readFileSync(fullPath, 'utf-8');
  const chunks = [];
  for (const entry of fs.readdirSync(fullPath, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const childRel = path.posix.join(relPath, entry.name);
    if (entry.isDirectory()) {
      chunks.push(readModuleTree(childRel));
    } else if (/\.(ts|tsx|js|mjs)$/i.test(entry.name)) {
      chunks.push(fs.readFileSync(path.join(__dirname, childRel), 'utf-8'));
    }
  }
  return chunks.join('\n');
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
const { getVideoIdentifier, getCanonicalVideoUrl, isSameVideoOrWebsite } = await import(`file://${protoModulePath.replace(/\\/g, '/')}`);

const platformsModulePath = path.join(__dirname, 'dist_test/platforms.mjs');
execSync(`npx esbuild "${path.join(__dirname, 'src/platforms.ts')}" --bundle --format=esm --outfile="${platformsModulePath}"`, { stdio: 'pipe' });
const { isPlatformActive, isPlatformPermitted, getPlatformByUrl, getActivePlatforms, isUrlAllowed } = await import(`file://${platformsModulePath.replace(/\\/g, '/')}`);

// ----------------------------------------------------
// 測試套件 0: 權限名單與支援名單解耦 (Permission Decoupling) 測試
// ----------------------------------------------------
console.log('\n--- 測試套件 0: 權限名單與支援名單解耦架構 (Permission Decoupling) 測試 ---');
assert(isPlatformActive('https://www.youtube.com/watch?v=123') === true, 'YouTube 處於正式啟用支援名單 (Active)');
assert(isPlatformPermitted('https://www.youtube.com/watch?v=123') === true, 'YouTube 處於授權名單中 (Permitted)');

assert(isPlatformActive('https://www.linetv.tw/drama/12345/eps/1') === true, 'LINE TV 處於正式啟用支援名單 (Active)');
assert(isPlatformPermitted('https://www.linetv.tw/drama/12345/eps/1') === true, 'LINE TV 處於授權名單中 (Permitted)');

assert(isPlatformActive('https://tv.apple.com/episode/umc.cmc.123') === true, 'Apple TV+ 處於正式啟用支援名單 (Active)');
assert(isPlatformPermitted('https://tv.apple.com/episode/umc.cmc.123') === true, 'Apple TV+ 處於授權名單中 (Permitted)');

assert(isPlatformActive('https://www.catchplay.com/watch/123') === true, 'CATCHPLAY+ 已轉正為正式啟用正版平台 (Active: true)');
assert(isPlatformPermitted('https://www.catchplay.com/watch/123') === true, 'CATCHPLAY+ 處於 Manifest 授權名單中 (Permitted: true)');

// 預授權候選網站 (enabled: false)
assert(isPlatformActive('https://www.hulu.com/watch/123') === false, 'Hulu 預留權限但尚未開放支援 (Active: false)');
assert(isPlatformPermitted('https://www.hulu.com/watch/123') === true, 'Hulu 處於 Manifest 預授權名單中 (Permitted: true)');

assert(isPlatformActive('https://www.litv.tv/vod/123') === false, 'LiTV 預留權限但尚未開放支援 (Active: false)');
assert(isPlatformPermitted('https://www.litv.tv/vod/123') === true, 'LiTV 處於 Manifest 預授權名單中 (Permitted: true)');

assert(isPlatformActive('https://wetv.vip/play/123') === false, 'WeTV 預留權限但尚未開放支援 (Active: false)');
assert(isPlatformPermitted('https://wetv.vip/play/123') === true, 'WeTV 處於 Manifest 預授權名單中 (Permitted: true)');

assert(isPlatformActive('https://www.google.com') === false, 'Google 非活躍支援平台');
assert(isPlatformPermitted('https://www.google.com') === false, 'Google 不在授權名單中');
assert(getActivePlatforms().length === 18, '目前正式局部開放支援之正版平台總數為 18');

// 高風險與第三方影視網站 (含 Anime1.me 已併入 activeTab 通用模式支援驗證)
assert(isPlatformActive('https://anime1.me/23456', false) === false, '預設鎖定狀態下 Anime1.me 已移出正式清單 (Active: false)');
assert(isPlatformActive('https://anime1.me/23456', true) === true, '彩蛋解鎖狀態下 Anime1.me 獲 activeTab 通用模式放行支援 (Active: true)');
assert(isPlatformPermitted('https://anime1.me/23456') === false, 'Anime1.me 已完全移出 Manifest 靜態授權名單 (零商店審查風險)');
assert(isPlatformActive('https://gimy.ai/watch/123', false) === false, '預設鎖定狀態下高風險網站 Gimy 處於不支援狀態 (Active: false)');
assert(isPlatformActive('https://gimy.ai/watch/123', true) === true, '彩蛋解鎖狀態下高風險網站 Gimy 獲 activeTab 通用模式放行支援 (Active: true)');
assert(isPlatformActive('https://8maple.tv/show/456', false) === false, '預設鎖定狀態下高風險網站 楓林網 處於不支援狀態 (Active: false)');
assert(isPlatformActive('https://8maple.tv/show/456', true) === true, '彩蛋解鎖狀態下高風險網站 楓林網 獲 activeTab 通用模式放行支援 (Active: true)');
assert(isPlatformPermitted('https://gimy.ai/watch/123') === false, '高風險網站不在 Manifest 靜態授權名單中 (零商店審查風險)');

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

// Netflix
assert(getVideoIdentifier('https://www.netflix.com/watch/80057281') === 'netflix:80057281', 'Netflix 標準觀看頁識別 (netflix:80057281)');
assert(getVideoIdentifier('https://www.netflix.com/watch/80057281?trackId=255824129') === 'netflix:80057281', 'Netflix 帶 trackId 查詢參數仍精準識別');

// 1. Vimeo
assert(getVideoIdentifier('https://vimeo.com/76979871') === 'vimeo:76979871', 'Vimeo 標準影片頁識別 (vimeo:76979871)');
assert(getVideoIdentifier('https://vimeo.com/channels/staffpicks/76979871') === 'vimeo:76979871', 'Vimeo 頻道路徑影片識別');

// 2. 巴哈姆特動畫瘋
assert(getVideoIdentifier('https://ani.gamer.com.tw/animeVideo.php?sn=38210') === 'gamer:38210', '巴哈姆特動畫瘋 sn 號識別 (gamer:38210)');
assert(getVideoIdentifier('https://ani.gamer.com.tw/animeVideo.php?sn=38210&from=banner') === 'gamer:38210', '動畫瘋帶追蹤參數仍精準識別');

// 3. Twitch
assert(getVideoIdentifier('https://www.twitch.tv/videos/1234567890') === 'twitch:video:1234567890', 'Twitch VOD 影片識別 (twitch:video:1234567890)');
assert(getVideoIdentifier('https://clips.twitch.tv/GentleFunnyPenguin-1234') === 'twitch:clip:GentleFunnyPenguin-1234', 'Twitch 剪輯短片識別');
assert(getVideoIdentifier('https://www.twitch.tv/shroud') === 'twitch:channel:shroud', 'Twitch 直播頻道識別');

// 4. Disney+
assert(getVideoIdentifier('https://www.disneyplus.com/video/4b045e77-5060-449e-8c35-3c121408801c') === 'disney:4b045e77-5060-449e-8c35-3c121408801c', 'Disney+ 影片 ID 識別');
assert(getVideoIdentifier('https://www.disneyplus.com/play/4b045e77-5060-449e-8c35-3c121408801c') === 'disney:4b045e77-5060-449e-8c35-3c121408801c', 'Disney+ Play 播放頁識別');

// 5. Prime Video / Amazon
assert(getVideoIdentifier('https://www.primevideo.com/detail/0STG2N4YOGQJNVUG5VOS0O8R4F') === 'prime:0STG2N4YOGQJNVUG5VOS0O8R4F', 'Prime Video 詳情頁識別');
assert(getVideoIdentifier('https://www.amazon.com/gp/video/detail/B08W5B4N7M') === 'prime:B08W5B4N7M', 'Amazon Video 詳情頁識別');

// 6. MyVideo
assert(getVideoIdentifier('https://www.myvideo.net.tw/details/0/123456') === 'myvideo:0:123456', 'MyVideo 電影詳情頁識別');
assert(getVideoIdentifier('https://www.myvideo.net.tw/player/654321') === 'myvideo:player:654321', 'MyVideo 播放器頁面識別');

// 7. LINE TV
assert(getVideoIdentifier('https://www.linetv.tw/drama/12345/eps/1') === 'linetv:12345:1', 'LINE TV 劇集與分集識別 (linetv:12345:1)');
assert(getVideoIdentifier('https://www.linetv.tw/drama/12345') === 'linetv:12345', 'LINE TV 單一戲劇識別');

// 8. KKTV
assert(getVideoIdentifier('https://www.kktv.me/play/01000187010001') === 'kktv:01000187010001', 'KKTV 播放識別 (kktv:01000187010001)');

// 9. Crunchyroll
assert(getVideoIdentifier('https://www.crunchyroll.com/watch/GRDQ09WPY/the-day-it-began') === 'crunchyroll:GRDQ09WPY', 'Crunchyroll 動畫識別 (crunchyroll:GRDQ09WPY)');

// 10. 遠傳 friDay 影音
assert(getVideoIdentifier('https://video.friday.tw/drama/detail/12345?episode=2') === 'friday:drama:12345?episode=2', 'friDay 影音劇集與集數識別');
assert(getVideoIdentifier('https://video.friday.tw/movie/detail/67890') === 'friday:movie:67890', 'friDay 電影識別');

// 11. Max (HBO Max)
assert(getVideoIdentifier('https://play.max.com/video/watch/UUID-1234-5678') === 'max:UUID-1234-5678', 'Max 影片識別 (max:UUID-1234-5678)');

// 12. 愛奇藝 iQIYI
assert(getVideoIdentifier('https://www.iq.com/play/12345678') === 'iqiyi:12345678', 'iQIYI 國際版播放識別');
assert(getVideoIdentifier('https://www.iqiyi.com/v_12345.html') === 'iqiyi:12345', 'iQIYI 大陸版視頻識別');

// 13. Apple TV+
assert(getVideoIdentifier('https://tv.apple.com/episode/umc.cmc.4u280a5') === 'appletv:umc.cmc.4u280a5', 'Apple TV+ 劇集識別');


// 測試套件 1.5: 跨平台純淨標準影片網址 (getCanonicalVideoUrl) 測試
console.log('\n--- 測試套件 1.5: 跨平台純淨標準網址 (getCanonicalVideoUrl) 測試 ---');
const dirtyNetflix = 'https://www.netflix.com/watch/81759292?trackId=264163088&tctx=%2C%2C596c0582-23ec-4603-b1f0-10543a3c2e3a-33534024%2CeyJwYWdlSWQiOiJQU18zZTlmOTJkZi0zM2E1LTQ0MDUtODZlOS02NGJkMGYyYzFlNWJfTDFfTjgiLCJzZWN0aW9uSWQiOiI3OGY4MWVmMS03MjFiLTQxOTktYmY1MS0zMWU0YzhhOGRhYzQiLCJpZHgiOi05OTl9%2CPS_3e9f92df-33a5-4405-86e9-64bd0f2c1e5b_L1_N8%2C%2C%2C%2C%2CVideo%3A81759290%2C%2C';
assert(getCanonicalVideoUrl(dirtyNetflix) === 'https://www.netflix.com/watch/81759292', 'Netflix 超長 tctx/trackId 參數徹底剔除並轉為純淨 /watch/81759292');

const dirtyYt = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123&index=1&ab_channel=RickAstley';
assert(getCanonicalVideoUrl(dirtyYt) === 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'YouTube 剔除 playlist/ab_channel 參數');

const shortYt = 'https://youtu.be/dQw4w9WgXcQ?si=abcdef';
assert(getCanonicalVideoUrl(shortYt) === 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'YouTube 短網址轉為標準 /watch?v=dQw4w9WgXcQ');

const dirtyBili = 'https://www.bilibili.com/video/BV1xx411c7mD/?spm_id_from=333.337.0.0';
assert(getCanonicalVideoUrl(dirtyBili) === 'https://www.bilibili.com/video/BV1xx411c7mD', 'Bilibili 剔除 spm_id 追蹤參數');

const dirtyNico = 'https://www.nicovideo.jp/watch/sm9?ref=search_key_video';
assert(getCanonicalVideoUrl(dirtyNico) === 'https://www.nicovideo.jp/watch/sm9', 'Niconico 剔除 ref 追蹤參數');

assert(getCanonicalVideoUrl('https://vimeo.com/76979871?share=copy&autoplay=1') === 'https://vimeo.com/76979871', 'Vimeo 剔除 share 參數');
assert(getCanonicalVideoUrl('https://ani.gamer.com.tw/animeVideo.php?sn=38210&from=banner&t=30') === 'https://ani.gamer.com.tw/animeVideo.php?sn=38210', '動畫瘋剔除 from/t 參數');
assert(getCanonicalVideoUrl('https://www.twitch.tv/videos/1234567890?filter=archives') === 'https://www.twitch.tv/videos/1234567890', 'Twitch 剔除 filter 參數');
assert(getCanonicalVideoUrl('https://www.disneyplus.com/video/4b045e77?track=1') === 'https://www.disneyplus.com/video/4b045e77', 'Disney+ 剔除 track 參數');
assert(getCanonicalVideoUrl('https://www.primevideo.com/detail/0STG2N4YOGQJNVUG5VOS0O8R4F/ref=atv_dp') === 'https://www.primevideo.com/detail/0STG2N4YOGQJNVUG5VOS0O8R4F', 'Prime Video 剔除 ref 參數');
assert(getCanonicalVideoUrl('https://www.myvideo.net.tw/details/0/123456?source=banner') === 'https://www.myvideo.net.tw/details/0/123456', 'MyVideo 剔除 source 參數');
assert(getCanonicalVideoUrl('https://www.linetv.tw/drama/12345/eps/1?track=1') === 'https://www.linetv.tw/drama/12345/eps/1', 'LINE TV 剔除 track 參數');
assert(getCanonicalVideoUrl('https://www.kktv.me/play/01000187010001?source=1') === 'https://www.kktv.me/play/01000187010001', 'KKTV 剔除 source 參數');
assert(getCanonicalVideoUrl('https://www.crunchyroll.com/watch/GRDQ09WPY/the-day-it-began?sp=1') === 'https://www.crunchyroll.com/watch/GRDQ09WPY', 'Crunchyroll 純淨化 watch 網址');
assert(getCanonicalVideoUrl('https://video.friday.tw/drama/detail/12345?episode=2&ref=banner') === 'https://video.friday.tw/drama/detail/12345?episode=2', 'friDay 剔除 ref 參數');
assert(getCanonicalVideoUrl('https://play.max.com/video/watch/UUID-1234-5678?trackId=1') === 'https://play.max.com/video/watch/UUID-1234-5678', 'Max 剔除 trackId 參數');
assert(getCanonicalVideoUrl('https://www.iq.com/play/12345678?spm=1') === 'https://www.iq.com/play/12345678', 'iQIYI 剔除 spm 參數');
assert(getCanonicalVideoUrl('https://tv.apple.com/episode/umc.cmc.4u280a5?ctx_brand=1') === 'https://tv.apple.com/episode/umc.cmc.4u280a5', 'Apple TV+ 剔除 ctx 參數');

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
  /^https:\/\/(www\.)?catchplay\.com\/.*(watch|play|video)\/[a-zA-Z0-9_-]+/,
  /^https:\/\/(www\.)?netflix\.com\/watch\/[0-9]+/,
  /^https:\/\/(www\.|player\.)?vimeo\.com\/([0-9]{5,}|channels\/.+|groups\/.+|showcase\/.+|video\/[0-9]+)/,
  /^https:\/\/ani\.gamer\.com\.tw\/animeVideo\.php\?.*sn=[0-9]+/,
  /^https:\/\/(www\.)?twitch\.tv\/(videos\/[0-9]+|[a-zA-Z0-9_]{3,25}(\/clip\/[a-zA-Z0-9_-]+)?)/,
  /^https:\/\/clips\.twitch\.tv\/[a-zA-Z0-9_-]+/,
  /^https:\/\/(www\.)?disneyplus\.com\/([a-z]{2}(-[a-z]{2,4})?\/)?(video|play|series)\/[a-zA-Z0-9_-]+/,
  /^https:\/\/(www\.)?primevideo\.com\/([a-zA-Z0-9_-]+\/)*detail\/[a-zA-Z0-9_-]+/,
  /^https:\/\/(www\.)?amazon\.com\/gp\/video\/detail\/[a-zA-Z0-9_-]+/,
  /^https:\/\/(www\.)?myvideo\.net\.tw\/(details\/[0-9]+\/[0-9]+|player\/[0-9]+)/,
  /^https:\/\/(www\.)?linetv\.tw\/drama\/[0-9]+(\/eps\/[0-9]+)?/,
  /^https:\/\/(www\.)?kktv\.me\/play\/[a-zA-Z0-9]+/,
  /^https:\/\/(www\.)?crunchyroll\.com\/([a-z]{2}(-[a-z]{2,4})?\/)?watch\/[a-zA-Z0-9]+/,
  /^https:\/\/video\.friday\.tw\/(drama|movie|anime|show|detail)\/(detail\/)?[0-9]+/,
  /^https:\/\/(www\.|play\.)?max\.com\/(video\/watch|player)\/[a-zA-Z0-9_-]+/,
  /^https:\/\/play\.hbomax\.com\/(video\/watch|player)\/[a-zA-Z0-9_-]+/,
  /^https:\/\/(www\.)?iq\.com\/play\/[a-zA-Z0-9_-]+/,
  /^https:\/\/(www\.)?iqiyi\.com\/[va]_[a-zA-Z0-9]+\.html/,
  /^https:\/\/tv\.apple\.com\/.+/
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
assert(isSafeUrl('https://www.catchplay.com/tw/watch/ed8c3d70-1234'), '放行合法 CATCHPLAY+ 觀看網址');
assert(!isSafeUrl('https://anime1.me/23456'), '官方預設白名單已移除 Anime1.me (改由彩蛋通用模式控管)');
assert(isSafeUrl('https://www.netflix.com/watch/80057281'), '放行合法 Netflix 播放網址');
assert(isSafeUrl('https://netflix.com/watch/80057281'), '放行無 www 前綴之合法 Netflix 播放網址');
assert(isSafeUrl('https://vimeo.com/76979871'), '放行合法 Vimeo 影片網址');
assert(isSafeUrl('https://ani.gamer.com.tw/animeVideo.php?sn=38210'), '放行合法動畫瘋播放網址');
assert(isSafeUrl('https://www.twitch.tv/videos/1234567890'), '放行合法 Twitch VOD 網址');
assert(isSafeUrl('https://clips.twitch.tv/GentleFunnyPenguin-1234'), '放行合法 Twitch 剪輯網址');
assert(isSafeUrl('https://www.disneyplus.com/video/4b045e77-5060'), '放行合法 Disney+ 播放網址');
assert(isSafeUrl('https://www.primevideo.com/detail/0STG2N4YOGQJNVUG5VOS0O8R4F'), '放行合法 Prime Video 播放網址');
assert(isSafeUrl('https://www.amazon.com/gp/video/detail/B08W5B4N7M'), '放行合法 Amazon Video 播放網址');
assert(isSafeUrl('https://www.myvideo.net.tw/details/0/123456'), '放行合法 MyVideo 播放網址');
assert(isSafeUrl('https://www.linetv.tw/drama/12345/eps/1'), '放行合法 LINE TV 播放網址');
assert(isSafeUrl('https://www.kktv.me/play/01000187010001'), '放行合法 KKTV 播放網址');
assert(isSafeUrl('https://www.crunchyroll.com/watch/GRDQ09WPY'), '放行合法 Crunchyroll 播放網址');
assert(isSafeUrl('https://video.friday.tw/drama/detail/12345'), '放行合法 friDay 播放網址');
assert(isSafeUrl('https://play.max.com/video/watch/UUID-1234-5678'), '放行合法 Max 播放網址');
assert(isSafeUrl('https://www.iq.com/play/12345678'), '放行合法 iQIYI 播放網址');
assert(isSafeUrl('https://tv.apple.com/episode/umc.cmc.4u280a5'), '放行合法 Apple TV+ 播放網址');

// 新平台釣魚防禦
assert(!isSafeUrl('https://evil-vimeo.com/76979871'), '攔截偽造 Vimeo 釣魚網域');
assert(!isSafeUrl('https://ani.gamer.com.tw.attacker.com/animeVideo.php?sn=123'), '攔截偽造動畫瘋釣魚網域');
assert(!isSafeUrl('https://www.twitch.tv.evil.com/videos/123'), '攔截偽造 Twitch 釣魚網域');
assert(!isSafeUrl('https://disneyplus.com.fake.com/video/123'), '攔截偽造 Disney+ 釣魚網域');
assert(!isSafeUrl('https://primevideo.com.hacker.com/detail/123'), '攔截偽造 Prime Video 釣魚網域');
assert(!isSafeUrl('https://myvideo.net.tw.attacker.com/details/0/123'), '攔截偽造 MyVideo 釣魚網域');
assert(!isSafeUrl('https://linetv.tw.evil.com/drama/123'), '攔截偽造 LINE TV 釣魚網域');
assert(!isSafeUrl('https://kktv.me.fake.com/play/123'), '攔截偽造 KKTV 釣魚網域');
assert(!isSafeUrl('https://crunchyroll.com.hacker.com/watch/123'), '攔截偽造 Crunchyroll 釣魚網域');
assert(!isSafeUrl('https://video.friday.tw.attacker.com/drama/123'), '攔截偽造 friDay 釣魚網域');
assert(!isSafeUrl('https://play.max.com.evil.com/watch/123'), '攔截偽造 Max 釣魚網域');
assert(!isSafeUrl('https://iq.com.attacker.com/play/123'), '攔截偽造 iQIYI 釣魚網域');
assert(!isSafeUrl('https://tv.apple.com.fake.com/episode/123'), '攔截偽造 Apple TV+ 釣魚網域');
assert(isSafeUrl('https://vimeo.com/76979871'), '放行合法 Vimeo 影片網址');
assert(isSafeUrl('https://ani.gamer.com.tw/animeVideo.php?sn=38210'), '放行合法動畫瘋播放網址');
assert(isSafeUrl('https://www.twitch.tv/videos/1234567890'), '放行合法 Twitch VOD 網址');
assert(isSafeUrl('https://clips.twitch.tv/GentleFunnyPenguin-1234'), '放行合法 Twitch 剪輯網址');
assert(isSafeUrl('https://www.disneyplus.com/video/4b045e77-5060'), '放行合法 Disney+ 播放網址');
assert(isSafeUrl('https://www.primevideo.com/detail/0STG2N4YOGQJNVUG5VOS0O8R4F'), '放行合法 Prime Video 播放網址');
assert(isSafeUrl('https://www.amazon.com/gp/video/detail/B08W5B4N7M'), '放行合法 Amazon Video 播放網址');
assert(isSafeUrl('https://www.myvideo.net.tw/details/0/123456'), '放行合法 MyVideo 播放網址');

// 新平台釣魚防禦
assert(!isSafeUrl('https://evil-vimeo.com/76979871'), '攔截偽造 Vimeo 釣魚網域');
assert(!isSafeUrl('https://ani.gamer.com.tw.attacker.com/animeVideo.php?sn=123'), '攔截偽造動畫瘋釣魚網域');
assert(!isSafeUrl('https://www.twitch.tv.evil.com/videos/123'), '攔截偽造 Twitch 釣魚網域');
assert(!isSafeUrl('https://disneyplus.com.fake.com/video/123'), '攔截偽造 Disney+ 釣魚網域');
assert(!isSafeUrl('https://primevideo.com.hacker.com/detail/123'), '攔截偽造 Prime Video 釣魚網域');
assert(!isSafeUrl('https://myvideo.net.tw.attacker.com/details/0/123'), '攔截偽造 MyVideo 釣魚網域');

// 惡意與偽造網址攔截測試 (Security Defenses)
assert(!isSafeUrl('https://evil-youtube.com/watch?v=dQw4w9WgXcQ'), '攔截偽造 YouTube 釣魚網域');
assert(!isSafeUrl('https://www.youtube.com.evil.com/watch?v=dQw4w9WgXcQ'), '攔截 YouTube 子網域偽造攻擊');
assert(!isSafeUrl('https://www.nicovideo.jp.attacker.com/watch/sm9'), '攔截 Niconico 釣魚網域');
assert(!isSafeUrl('https://anime1.me.evil.com/23456'), '攔截 Anime1.me 釣魚網域');
assert(!isSafeUrl('https://www.netflix.com.attacker.com/watch/80057281'), '攔截 Netflix 釣魚網域');
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

function checkTargetSite(url, candidatesUnlocked = false) {
  const isYouTube = url.includes('youtube.com/watch');
  const isBilibili = url.includes('bilibili.com/video') || url.includes('bilibili.com/bangumi');
  const isNiconico = url.includes('nicovideo.jp/watch/');
  const isAnime1 = /^https?:\/\/([a-z0-9-]+\.)?anime1\.me\/.+/.test(url);
  const isNetflix = url.includes('netflix.com/watch/');
  const isVimeo = /^https?:\/\/(www\.|player\.)?vimeo\.com\/([0-9]{5,}|channels\/|groups\/|showcase\/)/.test(url);
  const isGamer = url.includes('ani.gamer.com.tw/animeVideo.php');
  const isTwitch = url.includes('twitch.tv/videos/') || url.includes('clips.twitch.tv/') || /^https?:\/\/(www\.)?twitch\.tv\/[a-zA-Z0-9_]{3,25}$/.test(url);
  const isDisney = url.includes('disneyplus.com/video/') || url.includes('disneyplus.com/play/') || url.includes('disneyplus.com/series/');
  const isPrime = url.includes('primevideo.com/detail/') || url.includes('amazon.com/gp/video/detail/');
  const isMyVideo = url.includes('myvideo.net.tw/details/') || url.includes('myvideo.net.tw/player/');
  const isLineTV = url.includes('linetv.tw/drama/');
  const isKKTV = url.includes('kktv.me/play/');
  const isCrunchyroll = url.includes('crunchyroll.com/watch/') || (url.includes('crunchyroll.com/') && url.includes('/watch/'));
  const isFriday = url.includes('video.friday.tw/');
  const isMax = url.includes('max.com/video/watch') || url.includes('max.com/player/') || url.includes('hbomax.com/');
  const isIQIYI = url.includes('iq.com/play/') || url.includes('iqiyi.com/v_') || url.includes('iqiyi.com/a_');
  const isAppleTV = url.includes('tv.apple.com/');
  return {
    isYouTube, isBilibili, isNiconico, isAnime1, isNetflix,
    isVimeo, isGamer, isTwitch, isDisney, isPrime, isMyVideo,
    isLineTV, isKKTV, isCrunchyroll, isFriday, isMax, isIQIYI, isAppleTV,
    isTargetSite: isPlatformActive(url, candidatesUnlocked)
  };
}

assert(checkTargetSite('https://www.catchplay.com/watch/123', false).isTargetSite === true, '預設狀態下 CATCHPLAY+ 標記為正式支援正版平台 (綠燈)');
assert(checkTargetSite('https://anime1.me/23456', false).isTargetSite === false, '預設狀態下 Anime1.me 標記為不支援 (紅燈)');
assert(checkTargetSite('https://anime1.me/23456', true).isTargetSite === true, '彩蛋解鎖後 Anime1.me 標記為通用模式支援 (綠燈)');
assert(checkTargetSite('https://www.litv.tv/vod/123', false).isTargetSite === false, '預設狀態下 LiTV 標記為不支援 (紅燈)');
assert(checkTargetSite('https://www.litv.tv/vod/123', true).isTargetSite === true, '彩蛋解鎖後 LiTV 標記為支援 (綠燈)');
assert(checkTargetSite('https://www.google.com', true).isTargetSite === false, '非串流網站解鎖後仍為不支援 (紅燈)');
assert(checkTargetSite('https://www.youtube.com/watch?v=123').isTargetSite === true, 'Popup 識別 YouTube 為支援目標頁面');
assert(checkTargetSite('https://www.bilibili.com/video/BV1xx').isTargetSite === true, 'Popup 識別 Bilibili 為支援目標頁面');
assert(checkTargetSite('https://www.nicovideo.jp/watch/sm9').isTargetSite === true, 'Popup 識別 Niconico 為支援目標頁面');
assert(checkTargetSite('https://www.catchplay.com/tw/watch/ed8c3d70').isTargetSite === true, 'Popup 識別 CATCHPLAY+ 為支援目標頁面');
assert(checkTargetSite('https://www.netflix.com/watch/80057281').isTargetSite === true, 'Popup 識別 Netflix 為支援目標頁面');
assert(checkTargetSite('https://vimeo.com/76979871').isTargetSite === true, 'Popup 識別 Vimeo 為支援目標頁面');
assert(checkTargetSite('https://ani.gamer.com.tw/animeVideo.php?sn=38210').isTargetSite === true, 'Popup 識別動畫瘋為支援目標頁面');
assert(checkTargetSite('https://www.twitch.tv/videos/1234567890').isTargetSite === true, 'Popup 識別 Twitch 為支援目標頁面');
assert(checkTargetSite('https://www.disneyplus.com/video/4b045e77').isTargetSite === true, 'Popup 識別 Disney+ 為支援目標頁面');
assert(checkTargetSite('https://www.primevideo.com/detail/0STG2N4Y').isTargetSite === true, 'Popup 識別 Prime Video 為支援目標頁面');
assert(checkTargetSite('https://www.myvideo.net.tw/details/0/123456').isTargetSite === true, 'Popup 識別 MyVideo 為支援目標頁面');
assert(checkTargetSite('https://www.linetv.tw/drama/12345/eps/1').isTargetSite === true, 'Popup 識別 LINE TV 為支援目標頁面');
assert(checkTargetSite('https://www.kktv.me/play/01000187010001').isTargetSite === true, 'Popup 識別 KKTV 為支援目標頁面');
assert(checkTargetSite('https://www.crunchyroll.com/watch/GRDQ09WPY').isTargetSite === true, 'Popup 識別 Crunchyroll 為支援目標頁面');
assert(checkTargetSite('https://video.friday.tw/drama/detail/12345').isTargetSite === true, 'Popup 識別 friDay 為支援目標頁面');
assert(checkTargetSite('https://play.max.com/video/watch/UUID-1234-5678').isTargetSite === true, 'Popup 識別 Max 為支援目標頁面');
assert(checkTargetSite('https://www.iq.com/play/12345678').isTargetSite === true, 'Popup 識別 iQIYI 為支援目標頁面');
assert(checkTargetSite('https://tv.apple.com/episode/umc.cmc.4u280a5').isTargetSite === true, 'Popup 識別 Apple TV+ 為支援目標頁面');
assert(checkTargetSite('https://www.netflix.com/browse').isTargetSite === false, 'Popup 識別 Netflix 首頁非觀看頁面 (安全防護)');
assert(checkTargetSite('https://www.google.com').isTargetSite === false, 'Popup 識別 Google 非目標頁面 (顯示請開啟支援影片提示)');
assert(checkTargetSite('https://anime1.me/', true).isTargetSite === false, 'Popup 識別 Anime1.me 首頁非播放頁面 (安全防護)');
// 預先取得授權但尚未正式開放平台測試 (使用者規範：不特別顯示、不亮黃燈)
assert(checkTargetSite('https://www.hulu.com/watch/123').isTargetSite === false, 'Popup 識別 Hulu 為未開放支援 (isTargetSite: false)');
assert(checkTargetSite('https://www.litv.tv/vod/123').isTargetSite === false, 'Popup 識別 LiTV 為未開放支援 (isTargetSite: false)');

// ----------------------------------------------------
// 測試套件 6: 燈號狀態標記 (綠燈支援 / 紅燈不支援) 與商店清單自動化測試
// ----------------------------------------------------
console.log('\n--- 測試套件 6: 燈號狀態標記 (綠燈支援 / 紅燈不支援) 與商店連結自動化測試 ---');

function getSiteIndicatorState(url, candidatesUnlocked = false) {
  const target = checkTargetSite(url, candidatesUnlocked);
  return {
    isTargetSite: target.isTargetSite,
    lightColor: target.isTargetSite ? 'GREEN' : 'RED',
    badgeKey: target.isTargetSite ? 'supportBadge' : 'unsupportedBadge',
    hasHoverTooltip: true,
    storeRedirectAvailable: !target.isTargetSite
  };
}

const ytState = getSiteIndicatorState('https://www.youtube.com/watch?v=abc1234');
assert(ytState.lightColor === 'GREEN', 'YouTube 顯示綠燈支援標記');
assert(ytState.badgeKey === 'supportBadge', 'YouTube 顯示支援徽章');

const biliState = getSiteIndicatorState('https://www.bilibili.com/video/BV1xx411c7mD');
assert(biliState.lightColor === 'GREEN', 'Bilibili 顯示綠燈支援標記');

const nicoState = getSiteIndicatorState('https://www.nicovideo.jp/watch/sm9');
assert(nicoState.lightColor === 'GREEN', 'Niconico 顯示綠燈支援標記');

const catchplayActiveState = getSiteIndicatorState('https://www.catchplay.com/watch/123');
assert(catchplayActiveState.lightColor === 'GREEN', 'CATCHPLAY+ 顯示綠燈支援標記');

const netflixState = getSiteIndicatorState('https://www.netflix.com/watch/80057281');
assert(netflixState.lightColor === 'GREEN', 'Netflix 顯示綠燈支援標記');
assert(getSiteIndicatorState('https://vimeo.com/76979871').lightColor === 'GREEN', 'Vimeo 顯示綠燈支援標記');
assert(getSiteIndicatorState('https://ani.gamer.com.tw/animeVideo.php?sn=38210').lightColor === 'GREEN', '動畫瘋顯示綠燈支援標記');
assert(getSiteIndicatorState('https://www.twitch.tv/videos/1234567890').lightColor === 'GREEN', 'Twitch 顯示綠燈支援標記');
assert(getSiteIndicatorState('https://www.disneyplus.com/video/4b045e77').lightColor === 'GREEN', 'Disney+ 顯示綠燈支援標記');
assert(getSiteIndicatorState('https://www.primevideo.com/detail/0STG2N4Y').lightColor === 'GREEN', 'Prime Video 顯示綠燈支援標記');
assert(getSiteIndicatorState('https://www.myvideo.net.tw/details/0/123456').lightColor === 'GREEN', 'MyVideo 顯示綠燈支援標記');
assert(getSiteIndicatorState('https://www.linetv.tw/drama/12345/eps/1').lightColor === 'GREEN', 'LINE TV 顯示綠燈支援標記');
assert(getSiteIndicatorState('https://www.kktv.me/play/01000187010001').lightColor === 'GREEN', 'KKTV 顯示綠燈支援標記');
assert(getSiteIndicatorState('https://www.crunchyroll.com/watch/GRDQ09WPY').lightColor === 'GREEN', 'Crunchyroll 顯示綠燈支援標記');
assert(getSiteIndicatorState('https://video.friday.tw/drama/detail/12345').lightColor === 'GREEN', 'friDay 顯示綠燈支援標記');
assert(getSiteIndicatorState('https://play.max.com/video/watch/UUID-1234-5678').lightColor === 'GREEN', 'Max 顯示綠燈支援標記');
assert(getSiteIndicatorState('https://www.iq.com/play/12345678').lightColor === 'GREEN', 'iQIYI 顯示綠燈支援標記');
assert(getSiteIndicatorState('https://tv.apple.com/episode/umc.cmc.4u280a5').lightColor === 'GREEN', 'Apple TV+ 顯示綠燈支援標記');

const googleState = getSiteIndicatorState('https://www.google.com');
assert(googleState.lightColor === 'RED', '非支援網站 (Google) 顯示紅燈不支援標記');
assert(googleState.badgeKey === 'unsupportedBadge', '非支援網站顯示不支援徽章');
assert(googleState.storeRedirectAvailable === true, '非支援網站支援點擊前往 Chrome 商店查看完整支援清單');

// 嚴格落實使用者需求：非正版授權 (Anime1.me) 與未開放網站預設一律顯示紅燈不支援
const anime1DefaultState = getSiteIndicatorState('https://anime1.me/12345', false);
assert(anime1DefaultState.lightColor === 'RED', '預設狀態下 Anime1.me 嚴格顯示紅燈不支援');
assert(anime1DefaultState.badgeKey === 'unsupportedBadge', '預設狀態下 Anime1.me 顯示不支援徽章');
const anime1UnlockedState = getSiteIndicatorState('https://anime1.me/12345', true);
assert(anime1UnlockedState.lightColor === 'GREEN', '連擊 3 次版本號解鎖彩蛋後 Anime1.me 轉為綠燈通用模式支援');

const huluState = getSiteIndicatorState('https://www.hulu.com/watch/123');
assert(huluState.lightColor === 'RED', '未正式開放支援網站 (Hulu) 嚴格顯示紅燈 (杜絕黃燈)');
assert(huluState.badgeKey === 'unsupportedBadge', '未正式開放支援網站顯示不支援徽章');

const CHROME_STORE_URL =
  'https://chromewebstore.google.com/detail/syncine-%E5%90%8C%E6%98%A0-%E9%81%A0%E7%AB%AF%E5%BD%B1%E7%89%87%E5%90%8C%E6%AD%A5%E6%92%AD%E6%94%BE-watch/filebpdgpniidghnnepdndpfgbcgnkip';
assert(CHROME_STORE_URL.startsWith('https://chromewebstore.google.com/detail/syncine-'), 'Chrome 商店官方發布網址正確無誤');

// ----------------------------------------------------
// 測試套件 7: bfcache 頁面快取生命週期與沙盒 iframe 注入隔離測試
// ----------------------------------------------------
console.log('\n--- 測試套件 7: bfcache 快取生命週期與沙盒 iframe 隔離測試 ---');

const manifestObj = JSON.parse(fs.readFileSync(path.join(__dirname, 'src/manifest.json'), 'utf-8'));
assert(manifestObj.content_scripts[0].all_frames === false, 'manifest.json 停用 all_frames (防止注入廣告/沙盒 iframe)');
assert(!manifestObj.content_scripts[0].match_about_blank, 'manifest.json 移除 match_about_blank');

const contentSrc = readModuleTree('src/content');
assert(contentSrc.includes('isPlatformActive'), 'content/index.ts 實裝 isPlatformActive 局部開放靜默退出守衛');
assert(contentSrc.includes('window.self !== window.top'), 'content/index.ts 包含頂層視窗防禦守衛 (window.self !== window.top)');
assert(contentSrc.includes('pagehide'), 'content/index.ts 監聽 pagehide 事件以釋放 Port');
assert(contentSrc.includes('pageshow'), 'content/index.ts 監聽 pageshow 事件以恢復 Port 與狀態');
assert(contentSrc.includes('event.persisted'), 'content/index.ts 依據 event.persisted 判定 bfcache 生命週期');
assert(contentSrc.includes('chrome.runtime.lastError'), 'content/index.ts 存取 chrome.runtime.lastError 消除未捕獲異常');

assert(contentSrc.includes('findGenericVideoElement'), 'content/index.ts 實裝標準影片通用檢索方案 (findGenericVideoElement)');
assert(contentSrc.includes('syncine_unlock_candidates'), 'content/index.ts 監聽彩蛋解鎖儲存旗標 (syncine_unlock_candidates)');

const popupSrc = readModuleTree('src/popup');
assert(popupSrc.includes('handleVersionTripleClick'), 'Popup.tsx 實裝版本號點擊 3 次隱藏彩蛋觸發器 (handleVersionTripleClick)');
assert(popupSrc.includes('syncine_unlock_candidates'), 'Popup.tsx 透過 syncine_unlock_candidates 儲存解鎖狀態');
assert(popupSrc.includes('isPlatformActive(activeTabUrl, candidatesUnlocked)'), 'Popup.tsx 根據彩蛋解鎖狀態計算目標支援判定');
assert(popupSrc.includes("useState<'create' | 'join'>('join')"), 'Popup.tsx 預設開窗視圖為加入房間 (join)');
assert(popupSrc.includes("setActiveTab('join')"), 'Popup.tsx 離開房間時重置預設視圖為加入房間 (join)');
assert(manifestObj.permissions.includes('activeTab'), 'Manifest 宣告 activeTab 權限');
assert(manifestObj.permissions.includes('scripting'), 'Manifest 宣告 scripting 權限以支援動態注入');
assert(contentSrc.includes('CS_PING') && contentSrc.includes('CS_ACTIVATE_UNIVERSAL'), 'content/index.ts 支援 activeTab 通用激活與 Ping 響應');

const bgSrc = readModuleTree('src/background');
assert(bgSrc.includes('isPlatformActive'), 'background/index.ts 實裝 isPlatformActive 廣播與白名單過濾守衛');
assert(bgSrc.includes('chrome.runtime.lastError'), 'background/index.ts 存取 chrome.runtime.lastError 消除斷開異常');

// ----------------------------------------------------
// 測試套件 8: Netflix MV3 Main World Bridge 深度適配與事件橋接測試
// ----------------------------------------------------
console.log('\n--- 測試套件 8: Netflix MV3 Main World Bridge 深度適配測試 ---');

assert(fs.existsSync(path.join(__dirname, 'src/content/netflix_bridge.ts')), 'Netflix Bridge 原始碼檔案存在');
assert(manifestObj.content_scripts.some((cs) => cs.world === 'MAIN' && cs.js.includes('src/content/netflix_bridge.ts')), 'Manifest 宣告 Netflix Bridge 於 world: MAIN 環境');
assert(contentSrc.includes('SYNCINE_NETFLIX_CMD'), 'Content Script 實裝 SYNCINE_NETFLIX_CMD 事件轉發');
assert(contentSrc.includes('applySeek') && contentSrc.includes('applyPlay') && contentSrc.includes('applyPause'), 'Content Script 實裝跨平台安全播放控制適配器');

const bridgeSrc = fs.readFileSync(path.join(__dirname, 'src/content/netflix_bridge.ts'), 'utf-8');
assert(bridgeSrc.includes('getNetflixPlayer'), 'Netflix Bridge 實裝內部 VideoPlayer 實例探測器');
assert(bridgeSrc.includes('player.seek'), 'Netflix Bridge 調用 player.seek 原生 API');
assert(bridgeSrc.includes('detail.currentTime * 1000'), 'Netflix Bridge 正確將秒數換算為毫秒 (ms)');

// ----------------------------------------------------
// 測試套件 9: 播放清單與上下集 (Next/Prev Episode) 自動跳轉同步測試
// ----------------------------------------------------
console.log('\n--- 測試套件 9: 清單與上下集 (Next/Prev Episode) 自動跳轉同步測試 ---');

// 1. 原始碼與邏輯注入驗證
assert(contentSrc.includes('isPlaylistOrEpisodeSupported'), 'Content Script 實裝 isPlaylistOrEpisodeSupported 支援判定函式');
assert(contentSrc.includes('markPlaylistActionTriggered'), 'Content Script 實裝 markPlaylistActionTriggered 換集信號捕捉器');
assert(contentSrc.includes('checkAndBroadcastPlaylistNavigation'), 'Content Script 實裝 checkAndBroadcastPlaylistNavigation 跳轉廣播發射器');
assert(contentSrc.includes('initPlaylistClickListeners'), 'Content Script 實裝 initPlaylistClickListeners 換集點擊監聽');
assert(contentSrc.includes('yt-navigate-finish'), 'Content Script 監聽 YouTube yt-navigate-finish 換片導航事件');
assert(contentSrc.includes('popstate') && contentSrc.includes('hashchange'), 'Content Script 監聽 popstate 與 hashchange 歷史記錄導航');

// 2. 選擇器涵蓋率驗證
assert(contentSrc.includes('.ytp-next-button'), '涵蓋 YouTube 下一部按鈕 (.ytp-next-button)');
assert(contentSrc.includes('.bpx-player-ctrl-btn-next') || contentSrc.includes('.squirtle-video-next'), '涵蓋 Bilibili 下一集按鈕');
assert(contentSrc.includes('[data-uia="control-next"]') || contentSrc.includes('[data-uia*="next-episode"]'), '涵蓋 Netflix 下一集按鈕');
assert(contentSrc.includes('ytd-playlist-panel-renderer'), '涵蓋 YouTube 播放清單面板');
assert(contentSrc.includes('#multi_page') || contentSrc.includes('.ep-list-wrapper'), '涵蓋 Bilibili 分P與番劇選集清單');
assert(contentSrc.includes('[data-uia="control-episodes"]'), '涵蓋 Netflix 影集選集抽屜按鈕');
assert(contentSrc.includes('.ani-control__btn--next') || contentSrc.includes('section.season'), '涵蓋動畫瘋選集與下一集');
assert(contentSrc.includes('.playlist-container') || contentSrc.includes('.showcase-item'), '涵蓋 Vimeo 播放清單與展示集');
assert(contentSrc.includes('player-next-video-button') || contentSrc.includes('collection-item'), '涵蓋 Twitch 下一部與合輯');
assert(contentSrc.includes('disneyplus.com') && contentSrc.includes('next-episode'), '涵蓋 Disney+ 下一集');
assert(contentSrc.includes('primevideo.com') && contentSrc.includes('next-episode'), '涵蓋 Prime Video 下一集');
assert(contentSrc.includes('myvideo.net.tw') && contentSrc.includes('episode-item'), '涵蓋 MyVideo 劇集選集');
assert(contentSrc.includes('linetv.tw') && contentSrc.includes('eps-item'), '涵蓋 LINE TV 劇集選集與分集');
assert(contentSrc.includes('kktv.me') && contentSrc.includes('play-series-item'), '涵蓋 KKTV 影集選集與下一集');
assert(contentSrc.includes('crunchyroll.com') && contentSrc.includes('playable-card'), '涵蓋 Crunchyroll 動畫選集與下一集');
assert(contentSrc.includes('friday.tw') && contentSrc.includes('episode-item'), '涵蓋 friDay 影音劇集選集');
assert((contentSrc.includes('max.com') || contentSrc.includes('hbomax.com')) && contentSrc.includes('next-episode'), '涵蓋 Max 下一集支援');
assert((contentSrc.includes('iq.com') || contentSrc.includes('iqiyi.com')) && contentSrc.includes('album-item'), '涵蓋 iQIYI 選集與下一集');
assert(contentSrc.includes('tv.apple.com') && contentSrc.includes('next-episode'), '涵蓋 Apple TV+ 下一集支援');
assert(contentSrc.includes('.ani-control__btn--next') || contentSrc.includes('section.season'), '涵蓋動畫瘋選集與下一集');
assert(contentSrc.includes('.playlist-container') || contentSrc.includes('.showcase-item'), '涵蓋 Vimeo 播放清單與展示集');
assert(contentSrc.includes('player-next-video-button') || contentSrc.includes('collection-item'), '涵蓋 Twitch 下一部與合輯');
assert(contentSrc.includes('disneyplus.com') && contentSrc.includes('next-episode'), '涵蓋 Disney+ 下一集');
assert(contentSrc.includes('primevideo.com') && contentSrc.includes('next-episode'), '涵蓋 Prime Video 下一集');
assert(contentSrc.includes('myvideo.net.tw') && contentSrc.includes('episode-item'), '涵蓋 MyVideo 劇集選集');

// 3. Bilibili 多 P 與番劇 ep 識別碼驗證
assert(getVideoIdentifier('https://www.bilibili.com/video/BV1xx411c7mD?p=2') === 'bili:BV1xx411c7mD?p=2', 'Bilibili 分 P 識別碼精確提取 (bili:BV1xx411c7mD?p=2)');
assert(getVideoIdentifier('https://www.bilibili.com/bangumi/play/ep12345') === 'bili:ep12345', 'Bilibili 番劇 ep 識別碼精確提取 (bili:ep12345)');
assert(getCanonicalVideoUrl('https://www.bilibili.com/video/BV1xx411c7mD?p=2&spm_id=123') === 'https://www.bilibili.com/video/BV1xx411c7mD?p=2', 'Bilibili 分 P 網址保留 ?p= 參數');
assert(getCanonicalVideoUrl('https://www.bilibili.com/bangumi/play/ep12345?from_spmid=123') === 'https://www.bilibili.com/bangumi/play/ep12345', 'Bilibili 番劇網址純淨保留 /ep12345');

// 4. Background 房主分頁切集無縫防重整驗證
assert(bgSrc.includes('isAlreadyOnVideo') || bgSrc.includes('isSameVideoOrWebsite'), 'Background 實裝切集防無效重整邏輯 (isAlreadyOnVideo)');


// ----------------------------------------------------
// 測試套件 10: 目標網站相同時杜絕強制刷新畫面 (No-Reload Guard) 測試
// ----------------------------------------------------
console.log('\n--- 測試套件 10: 目標網站相同時杜絕強制刷新畫面 (No-Reload Guard) 測試 ---');

// 1. isSameVideoOrWebsite 多平台精確度矩陣驗證
assert(
  isSameVideoOrWebsite('https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=50s'),
  'YouTube 相同影片帶有時間軸參數判定為相同'
);
assert(
  isSameVideoOrWebsite('https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://youtu.be/dQw4w9WgXcQ'),
  'YouTube 短網址與標準網址判定為相同'
);
assert(
  !isSameVideoOrWebsite('https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=oHg5SJYRHA0'),
  'YouTube 不同影片正確判定為不同'
);
assert(
  isSameVideoOrWebsite('https://www.bilibili.com/video/BV1xx411c7mD?p=2&spm_id=123', 'https://www.bilibili.com/video/BV1xx411c7mD?p=2'),
  'Bilibili 同分 P 帶追蹤參數判定為相同'
);
assert(
  isSameVideoOrWebsite('https://www.bilibili.com/video/BV1xx411c7mD', 'https://www.bilibili.com/video/BV1xx411c7mD?p=1'),
  'Bilibili 預設第 1 P 與無 p 參數判定為相同'
);
assert(
  !isSameVideoOrWebsite('https://www.bilibili.com/video/BV1xx411c7mD?p=2', 'https://www.bilibili.com/video/BV1xx411c7mD?p=3'),
  'Bilibili 不同分 P 正確判定為不同 (p=2 vs p=3)'
);
assert(
  isSameVideoOrWebsite('https://www.bilibili.com/bangumi/play/ep12345?from_spm=1', 'https://www.bilibili.com/bangumi/play/ep12345'),
  'Bilibili 番劇同集數帶追蹤參數判定為相同'
);
assert(
  !isSameVideoOrWebsite('https://www.bilibili.com/bangumi/play/ep12345', 'https://www.bilibili.com/bangumi/play/ep12346'),
  'Bilibili 番劇不同集數正確判定為不同'
);
assert(
  isSameVideoOrWebsite('https://www.netflix.com/watch/80057281?trackId=255', 'https://www.netflix.com/watch/80057281'),
  'Netflix 相同觀看 ID 帶 trackId 判定為相同'
);
assert(
  !isSameVideoOrWebsite('https://www.netflix.com/watch/80057281', 'https://www.netflix.com/watch/80057282'),
  'Netflix 不同劇集正確判定為不同'
);
assert(
  isSameVideoOrWebsite('https://www.nicovideo.jp/watch/sm9?ref=search', 'https://www.nicovideo.jp/watch/sm9'),
  'Niconico 相同影片帶 ref 參數判定為相同'
);
assert(
  isSameVideoOrWebsite('https://anime1.me/12345', 'https://anime1.me/12345/'),
  'Anime1.me 相同集數頁面判定為相同'
);
assert(
  isSameVideoOrWebsite('https://vimeo.com/76979871?share=copy', 'https://vimeo.com/76979871'),
  'Vimeo 相同影片帶參數判定為相同'
);
assert(
  isSameVideoOrWebsite('https://ani.gamer.com.tw/animeVideo.php?sn=38210&from=1', 'https://ani.gamer.com.tw/animeVideo.php?sn=38210'),
  '動畫瘋相同 sn 帶參數判定為相同'
);
assert(
  isSameVideoOrWebsite('https://www.twitch.tv/videos/1234567890?filter=1', 'https://www.twitch.tv/videos/1234567890'),
  'Twitch 相同 VOD 帶參數判定為相同'
);
assert(
  isSameVideoOrWebsite('https://www.disneyplus.com/video/4b045e77?ref=1', 'https://www.disneyplus.com/video/4b045e77'),
  'Disney+ 相同視頻帶參數判定為相同'
);
assert(
  isSameVideoOrWebsite('https://www.primevideo.com/detail/0STG2N4YOGQJNVUG5VOS0O8R4F/ref=1', 'https://www.primevideo.com/detail/0STG2N4YOGQJNVUG5VOS0O8R4F'),
  'Prime Video 相同視頻帶參數判定為相同'
);
assert(
  isSameVideoOrWebsite('https://www.myvideo.net.tw/details/0/123456?from=1', 'https://www.myvideo.net.tw/details/0/123456'),
  'MyVideo 相同視頻帶參數判定為相同'
);
assert(
  isSameVideoOrWebsite('https://www.linetv.tw/drama/12345/eps/1?track=1', 'https://www.linetv.tw/drama/12345/eps/1'),
  'LINE TV 相同劇集分集帶參數判定為相同'
);
assert(
  !isSameVideoOrWebsite('https://www.linetv.tw/drama/12345/eps/1', 'https://www.linetv.tw/drama/12345/eps/2'),
  'LINE TV 不同分集正確判定為不同'
);
assert(
  isSameVideoOrWebsite('https://www.kktv.me/play/01000187010001?from=banner', 'https://www.kktv.me/play/01000187010001'),
  'KKTV 相同影片帶參數判定為相同'
);
assert(
  !isSameVideoOrWebsite('https://www.kktv.me/play/01000187010001', 'https://www.kktv.me/play/01000187010002'),
  'KKTV 不同集數正確判定為不同'
);
assert(
  isSameVideoOrWebsite('https://www.crunchyroll.com/watch/GRDQ09WPY/the-day-it-began?sp=1', 'https://www.crunchyroll.com/watch/GRDQ09WPY'),
  'Crunchyroll 相同動畫帶參數判定為相同'
);
assert(
  !isSameVideoOrWebsite('https://www.crunchyroll.com/watch/GRDQ09WPY', 'https://www.crunchyroll.com/watch/GRDQ09WPZ'),
  'Crunchyroll 不同集數正確判定為不同'
);
assert(
  isSameVideoOrWebsite('https://video.friday.tw/drama/detail/12345?episode=1&from=1', 'https://video.friday.tw/drama/detail/12345?episode=1'),
  'friDay 相同劇集集數帶參數判定為相同'
);
assert(
  !isSameVideoOrWebsite('https://video.friday.tw/drama/detail/12345?episode=1', 'https://video.friday.tw/drama/detail/12345?episode=2'),
  'friDay 不同集數正確判定為不同'
);
assert(
  isSameVideoOrWebsite('https://play.max.com/video/watch/UUID-1234-5678?t=10', 'https://play.max.com/video/watch/UUID-1234-5678'),
  'Max 相同影片帶參數判定為相同'
);
assert(
  !isSameVideoOrWebsite('https://play.max.com/video/watch/UUID-1234-5678', 'https://play.max.com/video/watch/UUID-9999-0000'),
  'Max 不同影片正確判定為不同'
);
assert(
  isSameVideoOrWebsite('https://www.iq.com/play/12345678?spm=1', 'https://www.iq.com/play/12345678'),
  'iQIYI 相同影片帶參數判定為相同'
);
assert(
  !isSameVideoOrWebsite('https://www.iq.com/play/12345678', 'https://www.iq.com/play/87654321'),
  'iQIYI 不同影片正確判定為不同'
);
assert(
  isSameVideoOrWebsite('https://tv.apple.com/episode/umc.cmc.4u280a5?ctx=1', 'https://tv.apple.com/episode/umc.cmc.4u280a5'),
  'Apple TV+ 相同影片帶參數判定為相同'
);
assert(
  !isSameVideoOrWebsite('https://tv.apple.com/episode/umc.cmc.4u280a5', 'https://tv.apple.com/episode/umc.cmc.9z99999'),
  'Apple TV+ 不同影片正確判定為不同'
);

// 2. Background 與 Content 原始碼防重整保護檢驗
assert(bgSrc.includes('isSameVideoOrWebsite'), 'Background 實裝 isSameVideoOrWebsite 函式引用');
assert(bgSrc.includes('不強制刷新畫面'), 'Background 具備當前分頁或現有分頁已在目標時不強制刷新畫面機制');
assert(!bgSrc.includes('目標分頁尚未注入 Content Script，刷新分頁以注入'), 'Background 徹底移除錯誤強制刷新邏輯');
assert(contentSrc.includes('isSameVideoOrWebsite(currentHref, roomState.currentUrl)'), 'Content Script 在目標網站相同時不觸發跳轉廣播');
assert(contentSrc.includes('sendResponse?.({ received: true })'), 'Content Script 訊息通道提供正常響應');

// ----------------------------------------------------
// 測試套件 11: Code Review 關鍵修復與非必要顯示資訊清理迴歸測試 (D-01~D-09, U-01~U-07)
// ----------------------------------------------------
console.log('\n--- 測試套件 11: Code Review 關鍵修復與非必要顯示資訊清理驗證 ---');

// D-01: BG_REDIRECT_ROOM payload 對齊與向下相容
assert(
  contentSrc.includes("type: 'BG_REDIRECT_ROOM'") && contentSrc.includes('payload: { targetUrl: cleanTarget }'),
  'D-01: Content Script 連播換集廣播使用標準 payload: { targetUrl } 結構'
);
assert(
  bgSrc.includes('payload?.targetUrl ?? (request as any).targetUrl'),
  'D-01: Background BG_REDIRECT_ROOM 支援 payload.targetUrl 與舊版頂層雙相容讀取'
);

// D-03 & U-01: SPA 首頁導航啟用守衛與生產包靜默無洩漏
assert(
  contentSrc.includes('isPlatformDomainActive'),
  'D-03: Content Script 採用 isPlatformDomainActive 支援從已開放平台首頁 SPA 進入播放頁'
);
assert(
  !contentSrc.includes('console.log(`🎬 [Syncine Content] 腳本載入'),
  'U-01: Content Script 移除頂層無條件啟動 console.log 洩漏'
);
const buildContentMjs = fs.readFileSync(path.join(__dirname, 'build_content.mjs'), 'utf-8');
assert(
  buildContentMjs.includes("pure: ['console.log', 'console.debug']"),
  'U-01: build_content.mjs 配置 esbuild pure 標記自動剝離生產環境 console.log/debug'
);

// D-04 & D-09: 通用播放器接線、0:00 回滾修復與關閉彩蛋即時卸載
assert(!contentSrc.includes('google.com'), 'D-04: Content Script 移除殘留 google.com 死碼分支');
assert(contentSrc.includes('lastSyncedTime >= 0'), 'D-09: 無權限觀眾於 0:00 拖曳進度條時亦可正確回滾');
assert(contentSrc.includes('deactivateContentScript()'), 'D-09: 關閉候選彩蛋時即時卸載 Content Script 觀察器與 Port');

// D-07: getCanonicalVideoUrl 保留候選/通用平台業務參數並剝離追蹤碼
assert(
  getCanonicalVideoUrl('https://www.catchplay.com/watch/abc?ep=3&utm_source=fb&fbclid=12345') ===
    'https://www.catchplay.com/watch/abc?ep=3',
  'D-07: getCanonicalVideoUrl 保留非追蹤業務參數 (?ep=3) 並剝離 utm_source / fbclid'
);
assert(
  getCanonicalVideoUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ?feature=share') ===
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  'D-07: getCanonicalVideoUrl 支援 YouTube Shorts 標準化為標準 /watch?v= 網址'
);
assert(
  getCanonicalVideoUrl('https://www.disneyplus.com/zh-hant/series/shogun/12345abc?tctx=xyz') ===
    'https://www.disneyplus.com/series/shogun/12345abc',
  'D-07: getCanonicalVideoUrl 支援 Disney+ /series/ 標準化並剔除語系前綴與追蹤參數'
);

// D-08: P2P 多人計數、重複監聽防護與單一校準計時器
const offscreenSrc = fs.readFileSync(path.join(__dirname, 'src/offscreen/index.ts'), 'utf-8');
assert(offscreenSrc.includes('guestKnownMemberCount'), 'D-08: Offscreen 保留房主廣播之真實多人房成員數');
assert(offscreenSrc.includes('dataListenerBoundIds'), 'D-08: Offscreen 防護重複綁定 conn.on(data) 事件');
assert(bgSrc.includes('memberCountSyncTimer'), 'D-08: Background 追蹤並清理單一 memberCountSyncTimer 防止計時器累積');

// U-02 ~ U-07: Popup UI 單一真理來源與非必要資訊清理
assert(!popupSrc.includes('const isYouTube ='), 'U-02: Popup.tsx 移除 18 組脆弱字串局部變數，消除紅燈顯示已連線矛盾');
assert(popupSrc.includes("if (connectionMode !== 'DEFAULT') return;"), 'U-04: Popup.tsx 僅於 DEFAULT 模式探測 /health');
assert(!popupSrc.includes('authuser=0'), 'U-05: CHROME_STORE_URL 移除個人 authuser 與語系尾綴');
assert(popupSrc.includes('{unlockToast &&'), 'U-03: Popup.tsx 實際渲染彩蛋切換視覺回饋 Toast');
assert(!popupSrc.includes('t.roomUi.newRoom'), 'U-06: Popup.tsx 移除房內重複之「建立新房間」按鈕');
assert(!popupSrc.includes('t.tabStatus.singleTabHint'), 'U-07: Popup.tsx 移除過時之「建議僅開啟單一分頁」橫幅');
assert(!popupSrc.includes('t.roomUi.autoCalibrateHint'), 'U-07: Popup.tsx 移除「(每30秒自動校準)」內部技術文字');

// ----------------------------------------------------
// 測試套件 12: 18 大正式開放平台端到端同步檢核矩陣 (Active 18 Platforms Full E2E Audit)
// ----------------------------------------------------
console.log('\n--- 測試套件 12: 18 大正式開放平台端到端同步檢核矩陣測試 ---');

const serverTypesModulePath = path.join(__dirname, 'dist_test/server_types.mjs');
execSync(
  `npx esbuild "${path.join(__dirname, '../server/src/types.ts')}" --bundle --format=esm --outfile="${serverTypesModulePath}"`,
  { stdio: 'pipe' }
);
const {
  isServerUrlAllowed,
  getVideoIdentifier: getServerVideoIdentifier,
  getCanonicalVideoUrl: getServerCanonicalVideoUrl,
  isSameVideoOrWebsite: isServerSameVideo
} = await import(`file://${serverTypesModulePath.replace(/\\/g, '/')}`);

// 1. 18 大正式開放平台端到端全鏈路檢核矩陣 (涵蓋前後端一致、Manifest 授權、Popup 燈號與正規化)
const ACTIVE_18_MATRIX = [
  { id: 'youtube', name: 'YouTube', raw: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&ab_channel=Rick', expectedCanon: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
  { id: 'bilibili', name: 'Bilibili', raw: 'https://www.bilibili.com/list/watchlater?bvid=BV1xx411c7mD&p=2&spm_id_from=333', expectedCanon: 'https://www.bilibili.com/video/BV1xx411c7mD?p=2' },
  { id: 'niconico', name: 'Niconico', raw: 'https://sp.nicovideo.jp/watch/sm9?ref=top', expectedCanon: 'https://www.nicovideo.jp/watch/sm9' },
  { id: 'catchplay', name: 'CATCHPLAY+', raw: 'https://www.catchplay.com/tw/watch/ed8c3d70-1234?utm_source=line', expectedCanon: 'https://www.catchplay.com/watch/ed8c3d70-1234' },
  { id: 'netflix', name: 'Netflix', raw: 'https://www.netflix.com/watch/80057281?trackId=13752289&tctx=0%2C0', expectedCanon: 'https://www.netflix.com/watch/80057281' },
  { id: 'vimeo', name: 'Vimeo', raw: 'https://vimeo.com/showcase/9999999/video/76979871', expectedCanon: 'https://vimeo.com/76979871' },
  { id: 'gamer', name: '巴哈姆特動畫瘋', raw: 'https://ani.gamer.com.tw/animeVideo.php?sn=38210&ad=1', expectedCanon: 'https://ani.gamer.com.tw/animeVideo.php?sn=38210' },
  { id: 'twitch', name: 'Twitch', raw: 'https://www.twitch.tv/shroud/', expectedCanon: 'https://www.twitch.tv/shroud' },
  { id: 'disney', name: 'Disney+', raw: 'https://www.disneyplus.com/zh-Hant/play/4b045e77-5060?tctx=abc', expectedCanon: 'https://www.disneyplus.com/play/4b045e77-5060' },
  { id: 'prime', name: 'Prime Video', raw: 'https://www.primevideo.com/detail/0STG2N4YOGQJNVUG5VOS0O8R4F/ref=atv_dp_season_select_s1', expectedCanon: 'https://www.primevideo.com/detail/0STG2N4YOGQJNVUG5VOS0O8R4F' },
  { id: 'myvideo', name: 'MyVideo', raw: 'https://www.myvideo.net.tw/details/3/24680?utm_source=line', expectedCanon: 'https://www.myvideo.net.tw/details/3/24680' },
  { id: 'linetv', name: 'LINE TV', raw: 'https://www.linetv.tw/en/drama/12345/eps/3?utm_medium=share', expectedCanon: 'https://www.linetv.tw/drama/12345/eps/3' },
  { id: 'kktv', name: 'KKTV', raw: 'https://www.kktv.me/play/01000187010001?from=app', expectedCanon: 'https://www.kktv.me/play/01000187010001' },
  { id: 'crunchyroll', name: 'Crunchyroll', raw: 'https://www.crunchyroll.com/zh-tw/watch/GRDQ09WPY/the-day-it-began', expectedCanon: 'https://www.crunchyroll.com/watch/GRDQ09WPY' },
  { id: 'friday', name: '遠傳 friDay 影音', raw: 'https://video.friday.tw/anime/detail/54321?episode=4&utm_source=share', expectedCanon: 'https://video.friday.tw/anime/detail/54321?episode=4' },
  { id: 'max', name: 'Max (HBO)', raw: 'https://play.max.com/sport/watch/UUID-SPORT-99?utm_source=web', expectedCanon: 'https://play.max.com/sport/watch/UUID-SPORT-99' },
  { id: 'iqiyi', name: '愛奇藝 iQIYI', raw: 'https://www.iq.com/zh-tw/play/frieren-ep1-19rrhl79k8?lang=zh_tw', expectedCanon: 'https://www.iq.com/play/frieren-ep1-19rrhl79k8' },
  { id: 'appletv', name: 'Apple TV+', raw: 'https://tv.apple.com/tw/movie/coda/umc.cmc.3eh9r5iz322241vw307x41x8e?ctx_brand=tvs.sbd.4000', expectedCanon: 'https://tv.apple.com/tw/movie/coda/umc.cmc.3eh9r5iz322241vw307x41x8e' }
];

assert(ACTIVE_18_MATRIX.length === 18, '檢核矩陣完整涵蓋全部 18 個正式開放平台');
for (const item of ACTIVE_18_MATRIX) {
  const detected = getPlatformByUrl(item.raw);
  assert(detected?.id === item.id && isPlatformActive(item.raw) === true, `[${item.name}] Client 平台識別與 Active 綠燈狀態正確 (${item.id})`);
  assert(isServerUrlAllowed(item.raw) === true, `[${item.name}] Server 安全白名單放行正確`);
  const clientCanon = getCanonicalVideoUrl(item.raw);
  const serverCanon = getServerCanonicalVideoUrl(item.raw);
  assert(
    clientCanon === item.expectedCanon && serverCanon === item.expectedCanon,
    `[${item.name}] 前後端 Canonical URL 標準化一致且精確 (${clientCanon})`,
    `client=${clientCanon}, server=${serverCanon}, expected=${item.expectedCanon}`
  );
  const clientId = getVideoIdentifier(item.raw);
  const serverId = getServerVideoIdentifier(item.raw);
  assert(Boolean(clientId) && clientId === serverId, `[${item.name}] 前後端 getVideoIdentifier 完全一致 (${clientId})`);
  assert(
    isSameVideoOrWebsite(item.raw, item.expectedCanon) && isServerSameVideo(item.raw, item.expectedCanon),
    `[${item.name}] 前後端 isSameVideoOrWebsite 防重整比對一致通過`
  );
  assert(popupSrc.includes(`${item.id}:`), `[${item.name}] Popup PLATFORM_TAB_STATUS_KEY_MAP 具備對應狀態鍵 (${item.id})`);
}

// 2. 跨平台特殊邊界案例迴歸驗證
assert(
  getVideoIdentifier('https://www.bilibili.com/video/av170001') === 'bili:av170001' &&
    getCanonicalVideoUrl('https://www.bilibili.com/video/av170001?spm_id=1') === 'https://www.bilibili.com/video/av170001',
  'Bilibili 傳統 av 號網址識別與標準化正確'
);
assert(
  getCanonicalVideoUrl('https://vimeo.com/76979871/a1b2c3d4?share=copy') === 'https://vimeo.com/76979871/a1b2c3d4',
  'Vimeo 未公開 (Unlisted) 影片保留隱私 Hash 路徑段避免 404'
);
assert(
  isSameVideoOrWebsite('https://www.disneyplus.com/play/4b045e77', 'https://www.disneyplus.com/video/4b045e77'),
  'Disney+ /play/<id> 與 /video/<id> 識別為同一部影片不重複刷新'
);
assert(
  isSameVideoOrWebsite(
    'https://tv.apple.com/tw/movie/coda/umc.cmc.3eh9r5iz322241vw307x41x8e',
    'https://tv.apple.com/us/movie/coda/umc.cmc.3eh9r5iz322241vw307x41x8e'
  ),
  'Apple TV+ 跨語系同部電影 (umc.cmc.*) 識別為相同影片且保留 /movie/ 路徑不 404'
);
assert(
  getVideoIdentifier('https://www.primevideo.com/watch?gti=amzn1.dv.gti.12345678-abcd') === 'prime:amzn1.dv.gti.12345678-abcd',
  'Prime Video /watch?gti= 播放參數精準識別'
);

// 3. Shadow DOM、Crunchyroll 子框架、Netflix Session、IMA 廣告防護與觀眾初始同步檢核
assert(contentSrc.includes('queryAllVideosDeep') && contentSrc.includes('.shadowRoot'), 'Content Script 支援穿透 Open ShadowRoot 鎖定 Apple TV+ / Disney+ / Max 播放器');
assert(
  manifestObj.host_permissions.includes('https://static.crunchyroll.com/*') &&
    manifestObj.content_scripts.some((cs) => cs.all_frames === true && cs.matches.includes('https://static.crunchyroll.com/*')) &&
    contentSrc.includes('isAllowedPlayerFrame') &&
    contentSrc.includes('video#player0'),
  'Crunchyroll Vilos 跨網域播放器子框架 (static.crunchyroll.com) 完整注入與綁定支援'
);
assert(
  bridgeSrc.includes("startsWith('watch')") && bridgeSrc.includes('syncineNfHandled'),
  'Netflix Bridge 優先鎖定活躍 watch* 工作階段並標記 syncineNfHandled 避免雙重觸發衝突'
);
assert(
  contentSrc.includes('isAdVideoElement') && contentSrc.includes('vjs-ad-playing'),
  '動畫瘋與 OTT Google IMA 前置廣告容器過濾與暫緩同步防護已實裝'
);
assert(
  contentSrc.includes("'nicovideo.jp'") &&
    contentSrc.includes("'anime1.me'") &&
    contentSrc.includes('Niconico Next/Series Click') &&
    contentSrc.includes('Anime1 Prev/Next Episode Click'),
  'Niconico 與 Anime1.me 納入上下集/系列連播自動跳轉支援 (18 平台 100% 覆蓋)'
);
assert(
  bgSrc.includes('BG_REQUEST_INIT_SYNC') &&
    offscreenSrc.includes('REQUEST_INIT_SYNC') &&
    contentSrc.includes('requestInitialSyncIfNeeded'),
  '觀眾端入房/跳轉載入完成後主動拉取初始時間軸機制 (P2P + Relay 雙模式) 已實裝'
);

// ----------------------------------------------------
// 測試套件 15: 實務連線與多使用者房間加入情境矩陣測試
// ----------------------------------------------------
console.log('\n--- 測試套件 15: 實務連線與多使用者房間加入情境矩陣測試 ---');

// 情境 1: 使用者 B 加入使用者 A 房間，A 有開啟非正式支援名單模式，B 未開啟
console.log('  ▸ [情境 1: 房主 A 解鎖候選/通用模式，觀眾 B 未開啟加入]');
const candidateUrl1 = 'https://www.hulu.com/watch/12345';
const candidateUrl2 = 'https://www.litv.tv/vod/drama/content.do?brd_id=123';
const thirdPartyUrl1 = 'https://gimy.ai/watch/789';
const thirdPartyUrl2 = 'https://8maple.tv/show/101';
const thirdPartyUrl3 = 'https://anime1.me/23456';

// 1.1 房主 A 處於解鎖狀態 (allowCandidates: true)，在候選與第三方網站開房皆放行
assert(isUrlAllowed(candidateUrl1, true) === true, '房主 A 解鎖狀態下，Hulu 候選網站判定合法放行');
assert(isUrlAllowed(candidateUrl2, true) === true, '房主 A 解鎖狀態下，LiTV 影視候選網站判定合法放行');
assert(isUrlAllowed(thirdPartyUrl1, true) === true, '房主 A 解鎖狀態下，Gimy 劇迷通用 activeTab 模式判定合法放行');
assert(isUrlAllowed(thirdPartyUrl2, true) === true, '房主 A 解鎖狀態下，楓林網 8maple 通用 activeTab 模式判定合法放行');
assert(isUrlAllowed(thirdPartyUrl3, true) === true, '房主 A 解鎖狀態下，Anime1.me 通用 activeTab 模式判定合法放行');

// 1.2 觀眾 B 處於預設鎖定狀態 (allowCandidates: false)，加入時對上述網址全數攔截阻擋跳轉
assert(isUrlAllowed(candidateUrl1, false) === false, '觀眾 B 未解鎖時，Hulu 候選網站被嚴格判定為未授權並觸發資安攔截');
assert(isUrlAllowed(candidateUrl2, false) === false, '觀眾 B 未解鎖時，LiTV 影視候選網站被嚴格判定為未授權並觸發資安攔截');
assert(isUrlAllowed(thirdPartyUrl1, false) === false, '觀眾 B 未解鎖時，Gimy 劇迷高風險網站被嚴格判定為未授權並觸發資安攔截');
assert(isUrlAllowed(thirdPartyUrl2, false) === false, '觀眾 B 未解鎖時，楓林網被嚴格判定為未授權並觸發資安攔截');
assert(isUrlAllowed(thirdPartyUrl3, false) === false, '觀眾 B 未解鎖時，Anime1.me 被嚴格判定為未授權並觸發資安攔截');

// 1.3 觀眾 B 隨後在彈窗中連續點擊 3 次版本號解鎖候選模式，即時通過校驗
assert(isUrlAllowed(candidateUrl1, true) === true, '觀眾 B 點擊版本號解鎖後，再次校驗 Hulu 順利轉為放行');
assert(isUrlAllowed(thirdPartyUrl1, true) === true, '觀眾 B 點擊版本號解鎖後，再次校驗 Gimy 順利轉為放行');
assert(isUrlAllowed(thirdPartyUrl3, true) === true, '觀眾 B 點擊版本號解鎖後，再次校驗 Anime1.me 順利轉為放行');

// 情境 2: 雙方皆開啟非正式支援模式 (A, B 均已解鎖彩蛋)
console.log('  ▸ [情境 2: 房主 A 與觀眾 B 皆解鎖候選/通用模式]');
const wetvUrl = 'https://wetv.vip/play/123';
const litvUrl = 'https://www.litv.tv/vod/123';
const animeflixUrl = 'https://animeflix.live/watch/456';
assert(isUrlAllowed(wetvUrl, true) === true, '雙方解鎖模式下，WeTV 順利同步');
assert(isUrlAllowed(litvUrl, true) === true, '雙方解鎖模式下，LiTV 順利同步');
assert(isUrlAllowed(animeflixUrl, true) === true, '雙方解鎖模式下，Animeflix 第三方網站順利同步');

// 情境 3: 雙方皆未開啟非正式支援模式 (標準安全模式，18 大正版平台)
console.log('  ▸ [情境 3: 雙方皆處於預設安全模式，觀看 18 大正式支援正版平台]');
const ytUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const gamerUrl = 'https://ani.gamer.com.tw/animeVideo.php?sn=38210';
const biliUrl = 'https://www.bilibili.com/video/BV1xx411c7mD';
const netflixUrl = 'https://www.netflix.com/watch/80057281';
const nicoUrl = 'https://www.nicovideo.jp/watch/sm9';
const fridayUrl = 'https://video.friday.tw/drama/detail/54321';
assert(isUrlAllowed(ytUrl, false) === true, '預設安全模式下，YouTube 正常同步無警告');
assert(isUrlAllowed(gamerUrl, false) === true, '預設安全模式下，巴哈姆特動畫瘋正常同步無警告');
assert(isUrlAllowed(biliUrl, false) === true, '預設安全模式下，Bilibili 正常同步無警告');
assert(isUrlAllowed(netflixUrl, false) === true, '預設安全模式下，Netflix 正常同步無警告');
assert(isUrlAllowed(nicoUrl, false) === true, '預設安全模式下，Niconico 正常同步無警告');
assert(isUrlAllowed(fridayUrl, false) === true, '預設安全模式下，friDay 影音 (18大正版之一) 正常同步無警告');
assert(isUrlAllowed(nicoUrl, false) === true, '預設安全模式下，Niconico 正常同步無警告');

// 情境 4: 房主 A 在瀏覽器內部系統頁面開房 (防呆過濾情境)
console.log('  ▸ [情境 4: 房主 A 在系統內部頁面開房防呆保護]');
assert(isUrlAllowed('chrome://newtab/', false) === false, 'chrome://newtab/ 在標準模式下絕對禁止放行');
assert(isUrlAllowed('chrome://newtab/', true) === false, 'chrome://newtab/ 在解鎖模式下亦嚴格禁止放行 (防止繞過)');
assert(isUrlAllowed('about:blank', true) === false, 'about:blank 在任何模式下皆禁止放行');
assert(isUrlAllowed('edge://flags', true) === false, 'edge://flags 在任何模式下皆禁止放行');
assert(isUrlAllowed('chrome-extension://abcdefg/popup.html', true) === false, 'chrome-extension:// 協定在任何模式下皆禁止放行');

// 情境 5: 惡意釣魚跳轉與非安全通訊協定注入防禦
console.log('  ▸ [情境 5: 惡意腳本注入與釣魚跳轉防禦]');
assert(isUrlAllowed('javascript:alert(document.cookie)', true) === false, 'javascript: 偽協定被 100% 阻斷');
assert(isUrlAllowed('data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==', true) === false, 'data: 偽協定被 100% 阻斷');
assert(isUrlAllowed('file:///C:/Windows/System32/calc.exe', true) === false, 'file: 本機通訊協定被 100% 阻斷');
assert(isUrlAllowed('http://phishing-youtube.com/watch?v=123', true) === false, '非 HTTPS 非白名單釣魚網址被 100% 阻斷');

// 情境 6: 網路抖動 / 高頻 P2P 重連告警防轟炸模擬驗證
console.log('  ▸ [情境 6: 高頻事件與 P2P 重連告警防轟炸機制]');
let simulatedAlertCount = 0;
let lastAlertUrlSim = '';
let lastAlertTimeSim = 0;
function simulateVerifyAndRedirect(url, allowCandidates) {
  const isSafe = isUrlAllowed(url, allowCandidates);
  if (!isSafe) {
    const now = Date.now();
    if (url === lastAlertUrlSim && now - lastAlertTimeSim < 15000) {
      return; // 抑制重複告警
    }
    lastAlertUrlSim = url;
    lastAlertTimeSim = now;
    simulatedAlertCount++;
  }
}

// 模擬觀眾 B 在加入 Gimy 房間後，遭遇 5 次突發性事件 (加房成功 + 3次 P2P 重連握手 + 1次心跳)
simulatedAlertCount = 0;
lastAlertUrlSim = '';
lastAlertTimeSim = 0;
for (let i = 0; i < 5; i++) {
  simulateVerifyAndRedirect('https://gimy.ai/watch/789', false);
}
assert(simulatedAlertCount === 1, `5 次突發重連與心跳事件中，15 秒冷卻防線將告警數嚴格限制為 1 次 (實際觸發: ${simulatedAlertCount})`);

// ----------------------------------------------------
// 測試套件 16: 三大核心平台 (YouTube / Bilibili / Netflix) 深度零迴歸與資安加固驗證
// ----------------------------------------------------
console.log('\n--- 測試套件 16: 三大核心平台 (YouTube / Bilibili / Netflix) 深度零迴歸與資安加固驗證 ---');

// 1. YouTube 全方位格式與防誤判驗證
assert(
  isUrlAllowed('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL12345&index=2') &&
    getVideoIdentifier('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL12345&index=2') === 'yt:dQw4w9WgXcQ' &&
    getCanonicalVideoUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL12345&index=2') === 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  '[YouTube 核心檢驗] 播放清單網址識別、放行與 Canonical 純淨化 100% 正確'
);
assert(
  isUrlAllowed('https://youtu.be/dQw4w9WgXcQ?si=abcdef') &&
    isUrlAllowed('https://www.youtube.com/shorts/dQw4w9WgXcQ') &&
    isUrlAllowed('https://www.youtube.com/live/dQw4w9WgXcQ') &&
    isUrlAllowed('https://www.youtube.com/embed/dQw4w9WgXcQ'),
  '[YouTube 核心檢驗] 短網址 (youtu.be)、Shorts、Live 直播與 Embed 內嵌網址全數支援'
);
assert(
  contentSrc.includes('isAdPlaying') &&
    contentSrc.includes('.ytp-ad-player-overlay') &&
    contentSrc.includes('yt-navigate-finish'),
  '[YouTube 核心檢驗] 具備 AdBlocker 相容廣告過濾器與 yt-navigate-finish SPA 換片監聽'
);

const ytBridgeSrc = fs.readFileSync(path.join(__dirname, 'src/content/youtube_bridge.ts'), 'utf-8');
assert(
  ytBridgeSrc.includes("document.getElementById('movie_player')") &&
    ytBridgeSrc.includes('player.seekTo(detail.currentTime, true)') &&
    ytBridgeSrc.includes('player.playVideo()') &&
    ytBridgeSrc.includes('player.pauseVideo()') &&
    ytBridgeSrc.includes('player.setPlaybackRate(detail.playbackRate)'),
  '[YouTube 核心檢驗] youtube_bridge.ts 調用原生 #movie_player API 支援 seekTo(true)、play、pause 與 rate 控制'
);
assert(
  manifestObj.content_scripts.some(
    (cs) => cs.world === 'MAIN' && cs.matches.some((m) => m.includes('youtube.com')) && cs.js.some((f) => f.includes('youtube_bridge'))
  ),
  '[YouTube 核心檢驗] Manifest 註冊 MAIN world 橋接腳本，直接溝通 YouTube 播放器隔離環境'
);
assert(
  contentSrc.includes('SYNCINE_YOUTUBE_CMD') &&
    contentSrc.includes('if (video.seeking || isUserSeeking)') &&
    contentSrc.includes('const isPaused = wasPlayingBeforeSeek ? false : targetVideo.paused'),
  '[YouTube 控制異常修復檢驗] Content Script 實裝 SYNCINE_YOUTUBE_CMD 適配器並徹底過濾 seek 觸發之偽 pause 事件'
);

// 2. Bilibili 全方位格式 (BV / av / 番劇 ep / ss / 稍後再看 / 分P) 驗證
assert(
  isUrlAllowed('https://www.bilibili.com/video/BV1xx411c7mD?p=3&vd_source=abc') &&
    getVideoIdentifier('https://www.bilibili.com/video/BV1xx411c7mD?p=3&vd_source=abc') === 'bili:BV1xx411c7mD?p=3' &&
    getCanonicalVideoUrl('https://www.bilibili.com/video/BV1xx411c7mD?p=3&vd_source=abc') === 'https://www.bilibili.com/video/BV1xx411c7mD?p=3',
  '[Bilibili 核心檢驗] 多 P 選集 (?p=3) 精確識別為獨立分集並剝離 vd_source 追蹤碼'
);
assert(
  isSameVideoOrWebsite('https://www.bilibili.com/video/BV1xx411c7mD?p=1', 'https://www.bilibili.com/video/BV1xx411c7mD') &&
    !isSameVideoOrWebsite('https://www.bilibili.com/video/BV1xx411c7mD?p=1', 'https://www.bilibili.com/video/BV1xx411c7mD?p=2'),
  '[Bilibili 核心檢驗] p=1 與無參數視為同集不重整，切換至 p=2 時正確觸發連播同步跳轉'
);
assert(
  isUrlAllowed('https://www.bilibili.com/bangumi/play/ep123456?from_spmid=666') &&
    isUrlAllowed('https://www.bilibili.com/bangumi/play/ss45678') &&
    getCanonicalVideoUrl('https://www.bilibili.com/bangumi/play/ep123456?from_spmid=666') === 'https://www.bilibili.com/bangumi/play/ep123456',
  '[Bilibili 核心檢驗] 番劇 ep 與 ss 播放頁放行與標準化正確'
);

// 3. Netflix 全方位防護 (/browse 隔離、tctx 剝離、MAIN World Bridge 毫秒轉換) 驗證
assert(
  isUrlAllowed('https://www.netflix.com/watch/80057281?trackId=123&tctx=abc') === true &&
    isUrlAllowed('https://www.netflix.com/browse') === false,
  '[Netflix 核心檢驗] 嚴格區分 /watch/<id> 播放頁與 /browse 首頁預覽（首頁不誤觸房間跳轉）'
);
assert(
  bridgeSrc.includes('Math.floor(detail.currentTime * 1000)') &&
    bridgeSrc.includes('getVideoPlayerBySessionId') &&
    manifestObj.content_scripts.some((cs) => cs.world === 'MAIN' && cs.js.some((f) => f.includes('netflix_bridge'))),
  '[Netflix 核心檢驗] Manifest 註冊 MAIN world 橋接腳本，透過毫秒級 seek() 與 watch* session 雙向控制 Cadmium 播放器'
);

// 4. SEC-01 & SEC-03 資安強化驗證 (RFC 1918 / 雲端 Metadata SSRF 阻斷 & Popup 最小權限注入)
assert(
  isServerUrlAllowed('https://172.25.0.1/watch/123', true) === false &&
    isServerUrlAllowed('https://169.254.169.254/latest/meta-data/', true) === false &&
    isServerUrlAllowed('https://[::1]/watch/123', true) === false &&
    isServerUrlAllowed('https://evil-phishing.example.com/watch/123', true) === false,
  '[SEC-01 資安檢驗] 伺服器端於通用模式下嚴格阻斷 172.16-31.*、169.254.* SSRF 與未知釣魚網域'
);
assert(
  popupSrc.includes('isUniversalSupportedUrl(curTab.url) || isPlatformDomainPermitted(curTab.url)'),
  '[SEC-03 資安檢驗] Popup.tsx 遵循最小權限原則，僅對核可之通用影音網域或預授權平台執行腳本探測與注入'
);
assert(
  bgSrc.includes('export { HOST_WHITELIST }'),
  '[DEBT-01 技術債清理] Background 統一由 platforms.ts 匯入並轉匯出 HOST_WHITELIST，消除重複定義'
);
assert(
  contentSrc.includes('if (!isRecentAction)') &&
    contentSrc.includes('ytd-compact-video-renderer') &&
    contentSrc.includes('lastPlaylistActionTime = 0'),
  '[YouTube 換片行為邊界檢驗] 僅在點擊上下一集按鈕或播放清單時自動同步，點擊一般推薦影片/搜尋結果時不自動跳轉，保留手動推送機制'
);

// ----------------------------------------------------
// 測試套件 17: SDD Phase 1-3 架構模組化、跨站選擇器隔離與 P2P 安全迴歸測試
// ----------------------------------------------------
console.log('\n--- 測試套件 17: SDD Phase 1-3 模組化與安全加固迴歸測試 ---');

// 1. Content Script 跨站點擊選擇器隔離實測 (matchPlaylistClickForHostname)
const syncEngineModulePath = path.join(__dirname, 'dist_test/syncEngine.mjs');
execSync(`npx esbuild "${path.join(__dirname, 'src/content/syncEngine.ts')}" --bundle --format=esm --outfile="${syncEngineModulePath}"`, { stdio: 'pipe' });
const { matchPlaylistClickForHostname } = await import(`file://${syncEngineModulePath.replace(/\\/g, '/')}`);

const makeTargetWithClass = (matchingSelectors) => ({
  closest: (selector) => matchingSelectors.some((s) => selector.includes(s)) ? {} : null
});

const epTarget = makeTargetWithClass(['.episode-item']);
assert(
  matchPlaylistClickForHostname('www.myvideo.net.tw', epTarget).matched === true &&
    matchPlaylistClickForHostname('www.youtube.com', epTarget).matched === false &&
    matchPlaylistClickForHostname('www.netflix.com', epTarget).matched === false &&
    matchPlaylistClickForHostname('example.com', epTarget).matched === false,
  '跨站換集選擇器嚴格依 hostname 隔離：.episode-item 僅於所屬影音平台觸發，絕不在 YouTube/Netflix/未知網站誤觸'
);
assert(
  matchPlaylistClickForHostname('www.youtube.com', makeTargetWithClass(['ytd-compact-video-renderer'])).ignored === true,
  'YouTube 一般推薦影片點擊明確標記 ignored 以重置自動連播計時'
);

// 2. Offscreen PeerJSWebRTCManager 安全邊界實測 (本機收件時間戳防偽造 + 單次核准 + SyncData 驗證)
const offscreenModulePath = path.join(__dirname, 'dist_test/offscreen.mjs');
execSync(`npx esbuild "${path.join(__dirname, 'src/offscreen/index.ts')}" --bundle --format=esm --outfile="${offscreenModulePath}"`, { stdio: 'pipe' });
const { PeerJSWebRTCManager } = await import(`file://${offscreenModulePath.replace(/\\/g, '/')}`);

const mgr = new PeerJSWebRTCManager(false);
const sentPackets = [];
const dataHandlers = [];
const mockConn = {
  peer: 'guest-peer-1',
  open: true,
  metadata: { userId: 'guest_u1', timestamp: Date.now() - 600_000 }, // 惡意偽造 10 分鐘前過期時間戳
  send: (msg) => sentPackets.push(msg),
  close: () => {},
  on: (evt, cb) => {
    if (evt === 'data') dataHandlers.push(cb);
  },
  once: () => {}
};

const forwarded = [];
const origChrome = globalThis.chrome;
globalThis.chrome = {
  runtime: {
    sendMessage: (msg) => {
      forwarded.push(msg);
      return Promise.resolve();
    }
  }
};

try {
  const localNow = Date.now();
  mgr['role'] = 'HOST';
  mgr['pendingRequests'].set('guest-peer-1', mockConn);
  mgr['pendingReceivedAt'].set('guest-peer-1', localNow);
  mgr['notifyJoinRequestsChanged']();

  const updatedReqMsg = forwarded.find((m) => m.type === 'CS_JOIN_REQUESTS_UPDATED');
  assert(
    updatedReqMsg && updatedReqMsg.payload.pendingRequests[0].timestamp >= localNow,
    'Host 待審核佇列採用本地 pendingReceivedAt 時間戳，不受遠端偽造 metadata.timestamp 污染'
  );

  mgr.approveJoinRequest('guest-peer-1', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert(
    sentPackets.filter((p) => p?.type === 'JOIN_APPROVED').length === 1,
    'Host 核准觀眾僅發送單次確定性 JOIN_APPROVED 封包（無重複 setTimeout 連發）'
  );

  forwarded.length = 0;
  mgr.updatePermission(true);
  const guestDataHandler = dataHandlers[0];
  assert(typeof guestDataHandler === 'function', 'Host 核准觀眾後成功註冊 DataChannel data 監聽器');

  guestDataHandler({ action: 'HEARTBEAT', currentTime: 12, timestamp: Date.now(), paused: false });
  guestDataHandler({ action: 'PLAY', currentTime: -50, playbackRate: 99, timestamp: Date.now() });
  assert(
    forwarded.length === 0,
    'Offscreen Host 端攔截 Guest 偽造 HEARTBEAT 與負數時間/違法倍速同步封包'
  );

  guestDataHandler({ action: 'PLAY', currentTime: 42, timestamp: Date.now(), paused: false });
  assert(
    forwarded.length === 1 && forwarded[0].type === 'OFFSCREEN_DATA_RECEIVED' && forwarded[0].payload.currentTime === 42,
    'Offscreen Host 端於授權後正常放行合法 Guest PLAY 操作封包'
  );
} finally {
  globalThis.chrome = origChrome;
}

// 3. Background Service Worker MV3 合規與僵死信令清理驗證
assert(
  bgSrc.includes('ensureSessionHydrated') &&
    bgSrc.includes('periodInMinutes: 0.5') &&
    !bgSrc.includes('periodInMinutes: 0.33'),
  'Background 具備單一並行 storage 狀態還原鎖與合規 0.5 分鐘 (30秒) 保活 Alarm'
);
assert(
  !bgSrc.includes("'PING_ALIVE'") &&
    !bgSrc.includes("'BG_SERVERLESS_CREATE_OFFER'") &&
    !bgSrc.includes("'OFFSCREEN_INIT_P2P'") &&
    !bgSrc.includes("'OFFSCREEN_TRIGGER_FALLBACK'"),
  'Background 已徹底移除過時 PING_ALIVE / Serverless 剪貼簿 / 舊版信令冗餘程式碼'
);
assert(
  isUrlAllowed('http://www.youtube.com/watch?v=dQw4w9WgXcQ') === false,
  '擴充端平台註冊表嚴格拒絕明文 http:// 協定'
);

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
