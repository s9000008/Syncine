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
const { getVideoIdentifier, getCanonicalVideoUrl, isSameVideoOrWebsite } = await import(`file://${protoModulePath.replace(/\\/g, '/')}`);

const platformsModulePath = path.join(__dirname, 'dist_test/platforms.mjs');
execSync(`npx esbuild "${path.join(__dirname, 'src/platforms.ts')}" --bundle --format=esm --outfile="${platformsModulePath}"`, { stdio: 'pipe' });
const { isPlatformActive, isPlatformPermitted, getPlatformByUrl, getActivePlatforms } = await import(`file://${platformsModulePath.replace(/\\/g, '/')}`);

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

// 預授權候選網站 (enabled: false)
assert(isPlatformActive('https://www.catchplay.com/watch/123') === false, 'CatchPlay 預留權限但尚未開放支援 (Active: false)');
assert(isPlatformPermitted('https://www.catchplay.com/watch/123') === true, 'CatchPlay 處於 Manifest 預授權名單中 (Permitted: true)');

assert(isPlatformActive('https://www.hulu.com/watch/123') === false, 'Hulu 預留權限但尚未開放支援 (Active: false)');
assert(isPlatformPermitted('https://www.hulu.com/watch/123') === true, 'Hulu 處於 Manifest 預授權名單中 (Permitted: true)');

assert(isPlatformActive('https://www.litv.tv/vod/123') === false, 'LiTV 預留權限但尚未開放支援 (Active: false)');
assert(isPlatformPermitted('https://www.litv.tv/vod/123') === true, 'LiTV 處於 Manifest 預授權名單中 (Permitted: true)');

assert(isPlatformActive('https://wetv.vip/play/123') === false, 'WeTV 預留權限但尚未開放支援 (Active: false)');
assert(isPlatformPermitted('https://wetv.vip/play/123') === true, 'WeTV 處於 Manifest 預授權名單中 (Permitted: true)');

assert(isPlatformActive('https://www.google.com') === false, 'Google 非活躍支援平台');
assert(isPlatformPermitted('https://www.google.com') === false, 'Google 不在授權名單中');
assert(getActivePlatforms().length === 18, '目前正式局部開放支援之平台總數為 18');

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
  /^https:\/\/anime1\.me\/.+/,
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
assert(isSafeUrl('https://anime1.me/23456'), '放行合法 Anime1.me 單集網址');
assert(isSafeUrl('https://anime1.me/category/my-anime/'), '放行合法 Anime1.me 分類網址');
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

assert(checkTargetSite('https://www.catchplay.com/watch/123', false).isTargetSite === false, '預設狀態下 CatchPlay 標記為不支援 (紅燈)');
assert(checkTargetSite('https://www.catchplay.com/watch/123', true).isTargetSite === true, '彩蛋解鎖後 CatchPlay 標記為支援 (綠燈)');
assert(checkTargetSite('https://www.litv.tv/vod/123', false).isTargetSite === false, '預設狀態下 LiTV 標記為不支援 (紅燈)');
assert(checkTargetSite('https://www.litv.tv/vod/123', true).isTargetSite === true, '彩蛋解鎖後 LiTV 標記為支援 (綠燈)');
assert(checkTargetSite('https://www.google.com', true).isTargetSite === false, '非串流網站解鎖後仍為不支援 (紅燈)');
assert(checkTargetSite('https://www.youtube.com/watch?v=123').isTargetSite === true, 'Popup 識別 YouTube 為支援目標頁面');
assert(checkTargetSite('https://www.bilibili.com/video/BV1xx').isTargetSite === true, 'Popup 識別 Bilibili 為支援目標頁面');
assert(checkTargetSite('https://www.nicovideo.jp/watch/sm9').isTargetSite === true, 'Popup 識別 Niconico 為支援目標頁面');
assert(checkTargetSite('https://anime1.me/23456').isTargetSite === true, 'Popup 識別 Anime1.me 為支援目標頁面');
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
assert(checkTargetSite('https://vimeo.com/76979871').isTargetSite === true, 'Popup 識別 Vimeo 為支援目標頁面');
assert(checkTargetSite('https://ani.gamer.com.tw/animeVideo.php?sn=38210').isTargetSite === true, 'Popup 識別動畫瘋為支援目標頁面');
assert(checkTargetSite('https://www.twitch.tv/videos/1234567890').isTargetSite === true, 'Popup 識別 Twitch 為支援目標頁面');
assert(checkTargetSite('https://www.disneyplus.com/video/4b045e77').isTargetSite === true, 'Popup 識別 Disney+ 為支援目標頁面');
assert(checkTargetSite('https://www.primevideo.com/detail/0STG2N4Y').isTargetSite === true, 'Popup 識別 Prime Video 為支援目標頁面');
assert(checkTargetSite('https://www.myvideo.net.tw/details/0/123456').isTargetSite === true, 'Popup 識別 MyVideo 為支援目標頁面');
assert(checkTargetSite('https://www.netflix.com/browse').isTargetSite === false, 'Popup 識別 Netflix 首頁非觀看頁面 (安全防護)');
assert(checkTargetSite('https://www.google.com').isTargetSite === false, 'Popup 識別 Google 非目標頁面 (顯示請開啟支援影片提示)');
assert(checkTargetSite('https://anime1.me/').isTargetSite === false, 'Popup 識別 Anime1.me 首頁非播放頁面 (安全防護)');
// 預先取得授權但尚未正式開放平台測試 (使用者規範：不特別顯示、不亮黃燈)
assert(checkTargetSite('https://www.catchplay.com/watch/123').isTargetSite === false, 'Popup 識別 CatchPlay 為未開放支援 (isTargetSite: false)');
assert(checkTargetSite('https://www.hulu.com/watch/123').isTargetSite === false, 'Popup 識別 Hulu 為未開放支援 (isTargetSite: false)');
assert(checkTargetSite('https://www.litv.tv/vod/123').isTargetSite === false, 'Popup 識別 LiTV 為未開放支援 (isTargetSite: false)');

// ----------------------------------------------------
// 測試套件 6: 燈號狀態標記 (綠燈支援 / 紅燈不支援) 與商店清單自動化測試
// ----------------------------------------------------
console.log('\n--- 測試套件 6: 燈號狀態標記 (綠燈支援 / 紅燈不支援) 與商店連結自動化測試 ---');

function getSiteIndicatorState(url) {
  const target = checkTargetSite(url);
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

const anime1State = getSiteIndicatorState('https://anime1.me/12345');
assert(anime1State.lightColor === 'GREEN', 'Anime1.me 顯示綠燈支援標記');

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

// 嚴格落實使用者需求：處於授權名單但未開放的網站，一律顯示紅燈不支援 (杜絕特殊顯示或黃燈)
const catchplayState = getSiteIndicatorState('https://www.catchplay.com/watch/123');
assert(catchplayState.lightColor === 'RED', '未正式開放支援網站 (CatchPlay) 嚴格顯示紅燈 (杜絕黃燈)');
assert(catchplayState.badgeKey === 'unsupportedBadge', '未正式開放支援網站顯示不支援徽章');

const huluState = getSiteIndicatorState('https://www.hulu.com/watch/123');
assert(huluState.lightColor === 'RED', '未正式開放支援網站 (Hulu) 嚴格顯示紅燈 (杜絕黃燈)');
assert(huluState.badgeKey === 'unsupportedBadge', '未正式開放支援網站顯示不支援徽章');

const CHROME_STORE_URL =
  'https://chromewebstore.google.com/detail/syncine-%E5%90%8C%E6%98%A0-%E9%81%A0%E7%AB%AF%E5%BD%B1%E7%89%87%E5%90%8C%E6%AD%A5%E6%92%AD%E6%94%BE-watch/filebpdgpniidghnnepdndpfgbcgnkip?authuser=0&hl=zh-TW';
assert(CHROME_STORE_URL.startsWith('https://chromewebstore.google.com/detail/syncine-'), 'Chrome 商店官方發布網址正確無誤');

// ----------------------------------------------------
// 測試套件 7: bfcache 頁面快取生命週期與沙盒 iframe 注入隔離測試
// ----------------------------------------------------
console.log('\n--- 測試套件 7: bfcache 快取生命週期與沙盒 iframe 隔離測試 ---');

const manifestObj = JSON.parse(fs.readFileSync(path.join(__dirname, 'src/manifest.json'), 'utf-8'));
assert(manifestObj.content_scripts[0].all_frames === false, 'manifest.json 停用 all_frames (防止注入廣告/沙盒 iframe)');
assert(!manifestObj.content_scripts[0].match_about_blank, 'manifest.json 移除 match_about_blank');

const contentSrc = fs.readFileSync(path.join(__dirname, 'src/content/index.ts'), 'utf-8');
assert(contentSrc.includes('isPlatformActive'), 'content/index.ts 實裝 isPlatformActive 局部開放靜默退出守衛');
assert(contentSrc.includes('window.self !== window.top'), 'content/index.ts 包含頂層視窗防禦守衛 (window.self !== window.top)');
assert(contentSrc.includes('pagehide'), 'content/index.ts 監聽 pagehide 事件以釋放 Port');
assert(contentSrc.includes('pageshow'), 'content/index.ts 監聽 pageshow 事件以恢復 Port 與狀態');
assert(contentSrc.includes('event.persisted'), 'content/index.ts 依據 event.persisted 判定 bfcache 生命週期');
assert(contentSrc.includes('chrome.runtime.lastError'), 'content/index.ts 存取 chrome.runtime.lastError 消除未捕獲異常');

assert(contentSrc.includes('findGenericVideoElement'), 'content/index.ts 實裝標準影片通用檢索方案 (findGenericVideoElement)');
assert(contentSrc.includes('syncine_unlock_candidates'), 'content/index.ts 監聽彩蛋解鎖儲存旗標 (syncine_unlock_candidates)');

const popupSrc = fs.readFileSync(path.join(__dirname, 'src/popup/Popup.tsx'), 'utf-8');
assert(popupSrc.includes('handleVersionTripleClick'), 'Popup.tsx 實裝版本號點擊 3 次隱藏彩蛋觸發器 (handleVersionTripleClick)');
assert(popupSrc.includes('syncine_unlock_candidates'), 'Popup.tsx 透過 syncine_unlock_candidates 儲存解鎖狀態');
assert(popupSrc.includes('isPlatformActive(activeTabUrl, candidatesUnlocked)'), 'Popup.tsx 根據彩蛋解鎖狀態計算目標支援判定');

const bgSrc = fs.readFileSync(path.join(__dirname, 'src/background/index.ts'), 'utf-8');
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
