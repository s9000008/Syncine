/**
 * Syncine 平台中央註冊表與局部開放配置中心 (Platform Registry & Feature Flags)
 * 
 * 架構目的：
 * 徹底解耦「瀏覽器授權名單 (Manifest Permissions)」與「實際支援開放名單 (Active Supported Platforms)」。
 * 允許擴充套件一口氣向 Chrome 申請廣泛的合法串流網域權限（避免未來每支援一個平台就觸發權限異動警告與停用風險），
 * 同時透過本註冊表以 enabled 旗標進行精細的「局部開放 (Partial Rollout)」。
 * 
 * 規則：
 * 1. 只有 enabled: true 的平台，Content Script 才會啟動同步、Background 才會轉發狀態、Popup 才會亮綠燈。
 * 2. 處於名單中但尚未啟用的平台 (enabled: false)，Content Script 靜默退出 (Early Bailout)，Popup 維持紅燈不支援，不特別提示。
 */

export interface PlatformDefinition {
  id: string;
  name: string;
  enabled: boolean; // 是否正式啟用支援 (局部開放開關)
  domains: string[]; // 匹配網域名稱 (包含子網域或頂級域名)
  matchUrl: (url: URL) => boolean;
}

export const PLATFORM_REGISTRY: PlatformDefinition[] = [
  // ==========================================
  // 正式支援開放平台 (Active Platforms - 18大平台)
  // ==========================================
  {
    id: 'youtube',
    name: 'YouTube',
    enabled: true,
    domains: ['youtube.com', 'youtu.be'],
    matchUrl: (url) => {
      const h = url.hostname.toLowerCase();
      if (h === 'youtube.com' || h.endsWith('.youtube.com')) {
        return (
          (url.pathname === '/watch' && url.searchParams.has('v')) ||
          url.pathname.startsWith('/embed/') ||
          url.pathname.startsWith('/shorts/') ||
          url.pathname.startsWith('/live/')
        );
      }
      if (h === 'youtu.be' || h.endsWith('.youtu.be')) {
        return url.pathname.length > 1;
      }
      return false;
    }
  },
  {
    id: 'bilibili',
    name: 'Bilibili',
    enabled: true,
    domains: ['bilibili.com'],
    matchUrl: (url) => {
      const p = url.pathname.toLowerCase();
      return (
        p.includes('/video/') ||
        p.includes('/bangumi/play/') ||
        (p.startsWith('/list/') && url.searchParams.has('bvid'))
      );
    }
  },
  {
    id: 'niconico',
    name: 'Niconico',
    enabled: true,
    domains: ['nicovideo.jp'],
    matchUrl: (url) => url.pathname.includes('/watch/')
  },
  {
    id: 'anime1',
    name: 'Anime1.me',
    enabled: true,
    domains: ['anime1.me'],
    matchUrl: (url) => (url.pathname.length > 1 && url.pathname !== '/') || url.searchParams.has('cat')
  },
  {
    id: 'netflix',
    name: 'Netflix',
    enabled: true,
    domains: ['netflix.com'],
    matchUrl: (url) => url.pathname.includes('/watch/')
  },
  {
    id: 'vimeo',
    name: 'Vimeo',
    enabled: true,
    domains: ['vimeo.com'],
    matchUrl: (url) => /\/([0-9]{5,}|video\/[0-9]+|channels\/|groups\/|showcase\/)/.test(url.pathname)
  },
  {
    id: 'gamer',
    name: '巴哈姆特動畫瘋',
    enabled: true,
    domains: ['gamer.com.tw'],
    matchUrl: (url) => url.hostname.includes('ani.gamer.com.tw') && url.pathname.includes('animeVideo.php') && url.searchParams.has('sn')
  },
  {
    id: 'twitch',
    name: 'Twitch',
    enabled: true,
    domains: ['twitch.tv'],
    matchUrl: (url) => {
      if (url.hostname.includes('clips.twitch.tv')) return url.pathname.length > 1;
      if (url.pathname.includes('/videos/') || url.pathname.includes('/clip/')) return true;
      const ch = url.pathname.slice(1).split('/')[0];
      return Boolean(ch && !['directory', 'p', 'settings', 'search', 'videos', 'downloads', 'wallet', 'subscriptions', 'inventory', 'drops', 'moderator'].includes(ch.toLowerCase()));
    }
  },
  {
    id: 'disney',
    name: 'Disney+',
    enabled: true,
    domains: ['disneyplus.com'],
    matchUrl: (url) => url.pathname.includes('/video/') || url.pathname.includes('/play/') || url.pathname.includes('/series/')
  },
  {
    id: 'prime',
    name: 'Prime Video',
    enabled: true,
    domains: ['primevideo.com', 'amazon.com'],
    matchUrl: (url) =>
      url.pathname.includes('/detail/') ||
      url.pathname.includes('/gp/video/detail/') ||
      (url.pathname.includes('/watch') && url.searchParams.has('gti'))
  },
  {
    id: 'myvideo',
    name: 'MyVideo',
    enabled: true,
    domains: ['myvideo.net.tw'],
    matchUrl: (url) => url.pathname.includes('/details/') || url.pathname.includes('/player/')
  },
  {
    id: 'linetv',
    name: 'LINE TV',
    enabled: true,
    domains: ['linetv.tw'],
    matchUrl: (url) => url.pathname.includes('/drama/')
  },
  {
    id: 'kktv',
    name: 'KKTV',
    enabled: true,
    domains: ['kktv.me'],
    matchUrl: (url) => url.pathname.includes('/play/')
  },
  {
    id: 'crunchyroll',
    name: 'Crunchyroll',
    enabled: true,
    domains: ['crunchyroll.com'],
    matchUrl: (url) => url.pathname.includes('/watch/')
  },
  {
    id: 'friday',
    name: '遠傳 friDay 影音',
    enabled: true,
    domains: ['friday.tw'],
    matchUrl: (url) =>
      url.hostname.includes('video.friday.tw') &&
      (/\/(detail|drama|movie|anime|show|sn)\//.test(url.pathname) || url.pathname.includes('/player'))
  },
  {
    id: 'max',
    name: 'Max (HBO)',
    enabled: true,
    domains: ['max.com', 'hbomax.com'],
    matchUrl: (url) => url.pathname.includes('/video/watch') || url.pathname.includes('/player/') || url.pathname.includes('/watch/')
  },
  {
    id: 'iqiyi',
    name: '愛奇藝 iQIYI',
    enabled: true,
    domains: ['iq.com', 'iqiyi.com'],
    matchUrl: (url) => {
      if (url.hostname.includes('iq.com')) return url.pathname.includes('/play/');
      if (url.hostname.includes('iqiyi.com')) return url.pathname.includes('/v_') || url.pathname.includes('/a_');
      return false;
    }
  },
  {
    id: 'appletv',
    name: 'Apple TV+',
    enabled: true,
    domains: ['tv.apple.com'],
    matchUrl: (url) =>
      url.pathname.includes('/episode/') ||
      url.pathname.includes('/movie/') ||
      url.pathname.includes('/show/') ||
      url.pathname.includes('/sport/') ||
      url.pathname.includes('umc.cmc.')
  },

  // =========================================================================
  // 預先取得授權但尚未局部開放支援之候選名單 (Permitted Staged - enabled: false)
  // 未來若欲開放，只需將 enabled 改為 true 並實裝專屬選擇器，不需重送 Chrome 審查！
  // =========================================================================
  {
    id: 'catchplay',
    name: 'CATCHPLAY+',
    enabled: false,
    domains: ['catchplay.com'],
    matchUrl: (url) => url.pathname.includes('/watch/')
  },
  {
    id: 'litv',
    name: 'LiTV 立視線上影視',
    enabled: false,
    domains: ['litv.tv'],
    matchUrl: (url) => url.pathname.includes('/vod/')
  },
  {
    id: 'wetv',
    name: 'WeTV',
    enabled: false,
    domains: ['wetv.vip'],
    matchUrl: (url) => url.pathname.includes('/play/')
  },
  {
    id: 'bilibili_tv',
    name: 'Bilibili 國際版',
    enabled: false,
    domains: ['bilibili.tv'],
    matchUrl: (url) => url.pathname.includes('/play/')
  },
  {
    id: 'dailymotion',
    name: 'Dailymotion',
    enabled: false,
    domains: ['dailymotion.com'],
    matchUrl: (url) => url.pathname.includes('/video/')
  },
  {
    id: 'hulu',
    name: 'Hulu',
    enabled: false,
    domains: ['hulu.com'],
    matchUrl: (url) => url.pathname.includes('/watch/')
  },
  {
    id: 'peacock',
    name: 'Peacock',
    enabled: false,
    domains: ['peacocktv.com'],
    matchUrl: (url) => url.pathname.includes('/watch/')
  },
  {
    id: 'paramount',
    name: 'Paramount+',
    enabled: false,
    domains: ['paramountplus.com'],
    matchUrl: (url) => url.pathname.includes('/shows/') || url.pathname.includes('/movies/')
  },
  {
    id: 'hbogo',
    name: 'HBO GO Asia',
    enabled: false,
    domains: ['hbogoasia.tw', 'hbogoasia.com'],
    matchUrl: (url) => url.pathname.includes('/play/')
  }
];

/**
 * 依據網域取得對應之平台定義（不限是否已進入播放子路徑，供 SPA 首頁導航守衛使用）
 */
export function getPlatformByDomain(rawUrl?: string): PlatformDefinition | null {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  try {
    const url = new URL(rawUrl.trim());
    if (url.protocol !== 'https:') return null;
    const host = url.hostname.toLowerCase();
    for (const p of PLATFORM_REGISTRY) {
      if (p.domains.some((d) => host === d || host.endsWith('.' + d))) {
        // 針對共用大網域之子服務進行精確子網域限定
        if (p.id === 'gamer' && host !== 'ani.gamer.com.tw') continue;
        if (p.id === 'friday' && host !== 'video.friday.tw') continue;
        return p;
      }
    }
  } catch (e) {
    return null;
  }
  return null;
}

/**
 * 取得當前播放頁網址對應之平台定義（必須同時匹配網域與播放頁路徑 matchUrl）
 */
export function getPlatformByUrl(rawUrl?: string): PlatformDefinition | null {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  try {
    const url = new URL(rawUrl.trim());
    if (url.protocol !== 'https:') return null;
    const host = url.hostname.toLowerCase();
    for (const p of PLATFORM_REGISTRY) {
      if (p.domains.some((d) => host === d || host.endsWith('.' + d))) {
        if (p.matchUrl(url)) {
          return p;
        }
      }
    }
  } catch (e) {
    return null;
  }
  return null;
}

/**
 * 高風險第三方影視與動漫綜合網站清單 (未授權/經常跳轉網域，零 Manifest 宣告，僅在版本號彩蛋解鎖後以 activeTab 模式動態支援)
 */
export const HIGH_RISK_STREAMING_CATALOG: { name: string; pattern: RegExp }[] = [
  { name: 'Gimy 劇迷', pattern: /(?:^|\.)gimy\.[a-z0-9_-]+/i },
  { name: '楓林網 (8maple)', pattern: /(?:^|\.)8maple\.[a-z0-9_-]+|maplestage\./i },
  { name: '小鴨影音 / 123KUBO', pattern: /kubo|kobo/i },
  { name: 'MoMoVOD', pattern: /(?:^|\.)momovod\.[a-z0-9_-]+/i },
  { name: '伊莉影音', pattern: /eyny\.com/i },
  { name: '歐樂影院 (OleVod)', pattern: /olevod/i },
  { name: 'AGE動漫', pattern: /(?:^|\.)(agemys|agefans)\.[a-z0-9_-]+/i },
  { name: '櫻花動漫', pattern: /(?:^|\.)(yhdm|yinghuacd|yhdmp)\.[a-z0-9_-]+/i },
  { name: 'Myself 動漫', pattern: /myself-bbs\.com/i },
  { name: 'Girigiri愛動漫', pattern: /girigirilove/i },
  { name: 'Animeflix / Zoro (HiAnime)', pattern: /animeflix|zoro\.to|hianime\.to/i }
];

export function getHighRiskPlatform(rawUrl?: string): { name: string; isHighRisk: boolean } | null {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  try {
    const url = new URL(rawUrl.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    const host = url.hostname.toLowerCase();
    for (const item of HIGH_RISK_STREAMING_CATALOG) {
      if (item.pattern.test(host)) {
        return { name: item.name, isHighRisk: true };
      }
    }
  } catch (_) {
    return null;
  }
  return null;
}

/**
 * 檢查當前網址是否為可透過 activeTab 通用模式支援之高風險或第三方串流網頁 (過濾內部與本機網址)
 */
export function isUniversalSupportedUrl(rawUrl?: string): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  try {
    const url = new URL(rawUrl.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host.startsWith('192.168.') ||
      host.startsWith('10.') ||
      host.startsWith('172.16.')
    ) {
      return false;
    }
    // 若命中已知高風險/第三方影視平台特徵，放行通用模式
    if (getHighRiskPlatform(rawUrl)) {
      return true;
    }
    return false;
  } catch (_) {
    return false;
  }
}

/**
 * 檢查當前網址是否為「已正式開放啟用支援 (Active)」之影音播放頁 (或彩蛋解鎖之通用 activeTab 網頁)
 */
export function isPlatformActive(rawUrl?: string, allowCandidates = false): boolean {
  const p = getPlatformByUrl(rawUrl);
  if (p) {
    return allowCandidates ? true : Boolean(p.enabled);
  }
  // 若已解鎖彩蛋且為合規之外部 Web 網址，以 activeTab 通用模式放行
  if (allowCandidates && isUniversalSupportedUrl(rawUrl)) {
    return true;
  }
  return false;
}

/**
 * 檢查當前網域是否屬於「已開放啟用 (或彩蛋解鎖)」之平台網域
 * 供 Content Script 在平台首頁 (如 /browse) 預先掛載 SPA 路由觀察器，同時確保未解鎖候選網站 100% 靜默休眠
 */
export function isPlatformDomainActive(rawUrl?: string, allowCandidates = false): boolean {
  const p = getPlatformByDomain(rawUrl);
  if (p) {
    return allowCandidates ? true : Boolean(p.enabled);
  }
  if (allowCandidates && isUniversalSupportedUrl(rawUrl)) {
    return true;
  }
  return false;
}

/**
 * 檢查當前網址是否在「授權名單」之有效播放頁中（包含已正式啟用與預先申請權限者）
 */
export function isPlatformPermitted(rawUrl?: string): boolean {
  const p = getPlatformByUrl(rawUrl);
  return Boolean(p);
}

/**
 * 檢查當前網域是否在「授權網域名單」中（包含已正式啟用與預先申請權限者）
 */
export function isPlatformDomainPermitted(rawUrl?: string): boolean {
  const p = getPlatformByDomain(rawUrl);
  return Boolean(p);
}

/**
 * 取得所有已正式開放支援之平台清單
 */
export function getActivePlatforms(): PlatformDefinition[] {
  return PLATFORM_REGISTRY.filter((p) => p.enabled);
}

/**
 * 官方 18 大受信任串流平台正則白名單
 */
export const HOST_WHITELIST: RegExp[] = [
  /^https:\/\/www\.youtube\.com\/watch\?.*v=[a-zA-Z0-9_-]+/,
  /^https:\/\/www\.youtube\.com\/watch\?v=[a-zA-Z0-9_-]+/,
  /^https:\/\/(www\.|m\.)?youtube\.com\/(watch\?.*v=|shorts\/|live\/|embed\/)[a-zA-Z0-9_-]+/,
  /^https:\/\/youtu\.be\/[a-zA-Z0-9_-]+/,
  /^https:\/\/(www\.)?bilibili\.com\/(video\/[a-zA-Z0-9]+|list\/.+\?.*bvid=BV[a-zA-Z0-9]+)/,
  /^https:\/\/(www\.)?bilibili\.com\/bangumi\/play\/(ep|ss)[0-9]+/,
  /^https:\/\/(www\.|sp\.)?nicovideo\.jp\/watch\/[a-zA-Z0-9]+/,
  /^https:\/\/anime1\.me\/.+/,
  /^https:\/\/(www\.)?netflix\.com\/watch\/[0-9]+/,
  /^https:\/\/(www\.|player\.)?vimeo\.com\/([0-9]{5,}|channels\/.+|groups\/.+|showcase\/.+|video\/[0-9]+)/,
  /^https:\/\/ani\.gamer\.com\.tw\/animeVideo\.php\?.*sn=[0-9]+/,
  /^https:\/\/(www\.)?twitch\.tv\/(videos\/[0-9]+|[a-zA-Z0-9_]{3,25}(\/clip\/[a-zA-Z0-9_-]+|\/)?)/,
  /^https:\/\/clips\.twitch\.tv\/[a-zA-Z0-9_-]+/,
  /^https:\/\/(www\.)?disneyplus\.com\/([a-zA-Z]{2}(-[a-zA-Z]{2,4})?\/)?(video|play|series)\/[a-zA-Z0-9_\/-]+/,
  /^https:\/\/(www\.)?primevideo\.com\/(([a-zA-Z0-9_-]+\/)*detail\/[a-zA-Z0-9._-]+|watch\?.*gti=[a-zA-Z0-9._-]+)/,
  /^https:\/\/(www\.)?amazon\.com\/gp\/video\/detail\/[a-zA-Z0-9._-]+/,
  /^https:\/\/(www\.)?myvideo\.net\.tw\/(details\/[0-9]+\/[0-9]+|player\/[0-9]+)/,
  /^https:\/\/(www\.)?linetv\.tw\/([a-zA-Z-]+\/)?drama\/[0-9]+(\/eps\/[0-9]+)?/,
  /^https:\/\/(www\.)?kktv\.me\/([a-zA-Z-]+\/)?play\/[a-zA-Z0-9]+/,
  /^https:\/\/(www\.)?crunchyroll\.com\/([a-zA-Z]{2}(-[a-zA-Z]{2,4})?\/)?watch\/[a-zA-Z0-9]+/,
  /^https:\/\/video\.friday\.tw\/((drama|movie|anime|show|detail|sn)\/(detail\/)?[0-9]+|player)/,
  /^https:\/\/(www\.|play\.)?max\.com\/.*(video\/watch|player|watch)\/[a-zA-Z0-9_-]+/,
  /^https:\/\/(www\.|play\.)?hbomax\.com\/.*(video\/watch|player|watch)\/[a-zA-Z0-9_-]+/,
  /^https:\/\/(www\.)?iq\.com\/([a-zA-Z_-]+\/)?play\/[a-zA-Z0-9_-]+/,
  /^https:\/\/(www\.)?iqiyi\.com\/[va]_[a-zA-Z0-9]+\.html/,
  /^https:\/\/tv\.apple\.com\/.+/
];

/**
 * 核心網址安全白名單校驗器
 * @param rawUrl 待校驗之目標網址
 * @param allowCandidates 是否放行候選/非正式支援與 activeTab 通用網頁
 */
export function isUrlAllowed(rawUrl: string, allowCandidates = false): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  const targetUrl = rawUrl.trim();

  // 0. 局部開放守衛：只有正式啟用，或已由彩蛋解鎖之候選平台才放行
  if (!isPlatformActive(targetUrl, allowCandidates)) {
    return false;
  }

  // 1. 若處於解鎖模式且為合規候選平台或通用 activeTab 網頁，直接放行
  if (allowCandidates && (isPlatformPermitted(targetUrl) || isUniversalSupportedUrl(targetUrl))) {
    return true;
  }

  // 2. 正則白名單檢驗
  if (HOST_WHITELIST.some((regex) => regex.test(targetUrl))) {
    return true;
  }

  // 3. 原生 URL 解析器雙重驗證 (防範因 query 參數過長、轉義或大小寫導致正則偽陰性)
  try {
    const parsed = new URL(targetUrl);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();

    // YouTube
    if (
      ((host === 'www.youtube.com' || host === 'youtube.com' || host === 'm.youtube.com') &&
        ((parsed.pathname === '/watch' && parsed.searchParams.has('v')) ||
          parsed.pathname.startsWith('/shorts/') ||
          parsed.pathname.startsWith('/live/') ||
          parsed.pathname.startsWith('/embed/'))) ||
      (host === 'youtu.be' && parsed.pathname.length > 1)
    ) {
      return true;
    }
    // Bilibili
    if (
      (host === 'www.bilibili.com' || host === 'bilibili.com' || host.endsWith('.bilibili.com')) &&
      (parsed.pathname.includes('/video/') ||
        parsed.pathname.includes('/bangumi/play/') ||
        (parsed.pathname.toLowerCase().startsWith('/list/') && parsed.searchParams.has('bvid')))
    ) {
      return true;
    }
    // Niconico
    if (
      (host === 'www.nicovideo.jp' || host === 'nicovideo.jp' || host.endsWith('.nicovideo.jp')) &&
      parsed.pathname.includes('/watch/')
    ) {
      return true;
    }
    // Anime1.me
    if (host === 'anime1.me' || host.endsWith('.anime1.me')) {
      return true;
    }
    // Netflix
    if (
      (host === 'www.netflix.com' || host === 'netflix.com') &&
      parsed.pathname.includes('/watch/')
    ) {
      return true;
    }
    // Vimeo
    if (host === 'vimeo.com' || host.endsWith('.vimeo.com')) {
      return true;
    }
    // 巴哈姆特動畫瘋
    if (host === 'ani.gamer.com.tw' && parsed.pathname.includes('/animeVideo.php') && parsed.searchParams.has('sn')) {
      return true;
    }
    // Twitch
    if (host === 'www.twitch.tv' || host === 'twitch.tv' || host === 'clips.twitch.tv') {
      return true;
    }
    // Disney+
    if ((host === 'www.disneyplus.com' || host === 'disneyplus.com') && (parsed.pathname.includes('/video/') || parsed.pathname.includes('/play/') || parsed.pathname.includes('/series/'))) {
      return true;
    }
    // Prime Video / Amazon
    if (
      (host === 'www.primevideo.com' || host === 'primevideo.com' || host === 'www.amazon.com' || host === 'amazon.com') &&
      (parsed.pathname.includes('/detail/') || parsed.pathname.includes('/gp/video/') || (parsed.pathname.includes('/watch') && parsed.searchParams.has('gti')))
    ) {
      return true;
    }
    // MyVideo
    if ((host === 'www.myvideo.net.tw' || host === 'myvideo.net.tw') && (parsed.pathname.includes('/details/') || parsed.pathname.includes('/player/'))) {
      return true;
    }
    // LINE TV
    if ((host === 'www.linetv.tw' || host === 'linetv.tw') && parsed.pathname.includes('/drama/')) {
      return true;
    }
    // KKTV
    if ((host === 'www.kktv.me' || host === 'kktv.me') && parsed.pathname.includes('/play/')) {
      return true;
    }
    // Crunchyroll
    if ((host === 'www.crunchyroll.com' || host === 'crunchyroll.com') && parsed.pathname.includes('/watch/')) {
      return true;
    }
    // friDay
    if (host === 'video.friday.tw' && (/\/(detail|drama|movie|anime|show|sn)\//.test(parsed.pathname) || parsed.pathname.includes('/player'))) {
      return true;
    }
    // Max / HBO Max
    if (
      (host === 'www.max.com' || host === 'max.com' || host === 'play.max.com' || host === 'www.hbomax.com' || host === 'hbomax.com' || host === 'play.hbomax.com') &&
      (parsed.pathname.includes('/video/watch') || parsed.pathname.includes('/player/') || parsed.pathname.includes('/watch/'))
    ) {
      return true;
    }
    // iQIYI
    if ((host === 'www.iq.com' || host === 'iq.com') && parsed.pathname.includes('/play/')) {
      return true;
    }
    if ((host === 'www.iqiyi.com' || host === 'iqiyi.com') && (parsed.pathname.includes('/v_') || parsed.pathname.includes('/a_'))) {
      return true;
    }
    // Apple TV+
    if (
      host === 'tv.apple.com' &&
      (parsed.pathname.includes('/episode/') || parsed.pathname.includes('/movie/') || parsed.pathname.includes('/show/') || parsed.pathname.includes('/sport/') || parsed.pathname.includes('umc.cmc.'))
    ) {
      return true;
    }
  } catch (e) {
    return false;
  }

  return false;
}
