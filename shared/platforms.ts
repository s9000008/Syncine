/**
 * Syncine 前後端共用平台中央註冊表與局部開放 / 白名單安全中心 (Single Source of Truth)
 *
 * 架構原則：
 * 1. 單一宣告式 PLATFORM_REGISTRY 統一衍生 HOST_WHITELIST、isPlatformActive、isPlatformPermitted、isUrlAllowed 與 isServerUrlAllowed。
 * 2. 非官方／高風險站台（含 Anime1.me 等盜版站台）嚴格隔離於 HIGH_RISK_STREAMING_CATALOG，
 *    完全不包含於 Manifest 靜態授權與正式支援清單。
 * 3. SSRF 縱深防禦：isPrivateOrInternalHost 嚴格攔截本機與內網 RFC 1918 / Link-Local 位址。
 */

export interface PlatformDefinition {
  id: string;
  name: string;
  enabled: boolean; // 是否正式啟用支援 (局部開放開關)
  domains: string[]; // 匹配網域名稱 (包含子網域或頂級域名)
  strictSubdomains?: string[]; // 若共用頂級域名，限制允許之精確主機名稱
  whitelistPatterns: RegExp[]; // 衍生統一 HOST_WHITELIST 之正則條目
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
    whitelistPatterns: [
      /^https:\/\/www\.youtube\.com\/watch\?.*v=[a-zA-Z0-9_-]+/,
      /^https:\/\/www\.youtube\.com\/watch\?v=[a-zA-Z0-9_-]+/,
      /^https:\/\/(www\.|m\.)?youtube\.com\/(watch\?.*v=|shorts\/|live\/|embed\/)[a-zA-Z0-9_-]+/,
      /^https:\/\/youtu\.be\/[a-zA-Z0-9_-]+/
    ],
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
    whitelistPatterns: [
      /^https:\/\/(www\.)?bilibili\.com\/(video\/[a-zA-Z0-9]+|list\/.+\?.*bvid=BV[a-zA-Z0-9]+)/,
      /^https:\/\/(www\.)?bilibili\.com\/bangumi\/play\/(ep|ss)[0-9]+/
    ],
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
    whitelistPatterns: [/^https:\/\/(www\.|sp\.)?nicovideo\.jp\/watch\/[a-zA-Z0-9]+/],
    matchUrl: (url) => url.pathname.includes('/watch/')
  },
  {
    id: 'netflix',
    name: 'Netflix',
    enabled: true,
    domains: ['netflix.com'],
    whitelistPatterns: [/^https:\/\/(www\.)?netflix\.com\/watch\/[0-9]+/],
    matchUrl: (url) => url.pathname.includes('/watch/')
  },
  {
    id: 'vimeo',
    name: 'Vimeo',
    enabled: true,
    domains: ['vimeo.com'],
    whitelistPatterns: [
      /^https:\/\/(www\.|player\.)?vimeo\.com\/([0-9]{5,}|channels\/.+|groups\/.+|showcase\/.+|video\/[0-9]+)/
    ],
    matchUrl: (url) => /\/([0-9]{5,}|video\/[0-9]+|channels\/|groups\/|showcase\/)/.test(url.pathname)
  },
  {
    id: 'gamer',
    name: '巴哈姆特動畫瘋',
    enabled: true,
    domains: ['gamer.com.tw'],
    strictSubdomains: ['ani.gamer.com.tw'],
    whitelistPatterns: [/^https:\/\/ani\.gamer\.com\.tw\/animeVideo\.php\?.*sn=[0-9]+/],
    matchUrl: (url) =>
      url.hostname.toLowerCase() === 'ani.gamer.com.tw' &&
      url.pathname.includes('animeVideo.php') &&
      url.searchParams.has('sn')
  },
  {
    id: 'twitch',
    name: 'Twitch',
    enabled: true,
    domains: ['twitch.tv'],
    whitelistPatterns: [
      /^https:\/\/(www\.)?twitch\.tv\/(videos\/[0-9]+|[a-zA-Z0-9_]{3,25}(\/clip\/[a-zA-Z0-9_-]+|\/)?)/,
      /^https:\/\/clips\.twitch\.tv\/[a-zA-Z0-9_-]+/
    ],
    matchUrl: (url) => {
      if (url.hostname.toLowerCase().includes('clips.twitch.tv')) return url.pathname.length > 1;
      if (url.pathname.includes('/videos/') || url.pathname.includes('/clip/')) return true;
      const ch = url.pathname.slice(1).split('/')[0];
      return Boolean(
        ch &&
          ![
            'directory',
            'p',
            'settings',
            'search',
            'videos',
            'downloads',
            'wallet',
            'subscriptions',
            'inventory',
            'drops',
            'moderator'
          ].includes(ch.toLowerCase())
      );
    }
  },
  {
    id: 'disney',
    name: 'Disney+',
    enabled: true,
    domains: ['disneyplus.com'],
    whitelistPatterns: [
      /^https:\/\/(www\.)?disneyplus\.com\/([a-zA-Z]{2}(-[a-zA-Z]{2,4})?\/)?(video|play|series)\/[a-zA-Z0-9_\/-]+/
    ],
    matchUrl: (url) =>
      url.pathname.includes('/video/') || url.pathname.includes('/play/') || url.pathname.includes('/series/')
  },
  {
    id: 'prime',
    name: 'Prime Video',
    enabled: true,
    domains: ['primevideo.com', 'amazon.com'],
    whitelistPatterns: [
      /^https:\/\/(www\.)?primevideo\.com\/(([a-zA-Z0-9_-]+\/)*detail\/[a-zA-Z0-9._-]+|watch\?.*gti=[a-zA-Z0-9._-]+)/,
      /^https:\/\/(www\.)?amazon\.com\/gp\/video\/detail\/[a-zA-Z0-9._-]+/
    ],
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
    whitelistPatterns: [/^https:\/\/(www\.)?myvideo\.net\.tw\/(details\/[0-9]+\/[0-9]+|player\/[0-9]+)/],
    matchUrl: (url) => url.pathname.includes('/details/') || url.pathname.includes('/player/')
  },
  {
    id: 'linetv',
    name: 'LINE TV',
    enabled: true,
    domains: ['linetv.tw'],
    whitelistPatterns: [/^https:\/\/(www\.)?linetv\.tw\/([a-zA-Z-]+\/)?drama\/[0-9]+(\/eps\/[0-9]+)?/],
    matchUrl: (url) => url.pathname.includes('/drama/')
  },
  {
    id: 'kktv',
    name: 'KKTV',
    enabled: true,
    domains: ['kktv.me'],
    whitelistPatterns: [/^https:\/\/(www\.)?kktv\.me\/([a-zA-Z-]+\/)?play\/[a-zA-Z0-9]+/],
    matchUrl: (url) => url.pathname.includes('/play/')
  },
  {
    id: 'crunchyroll',
    name: 'Crunchyroll',
    enabled: true,
    domains: ['crunchyroll.com'],
    whitelistPatterns: [/^https:\/\/(www\.)?crunchyroll\.com\/([a-zA-Z]{2}(-[a-zA-Z]{2,4})?\/)?watch\/[a-zA-Z0-9]+/],
    matchUrl: (url) => url.pathname.includes('/watch/')
  },
  {
    id: 'friday',
    name: '遠傳 friDay 影音',
    enabled: true,
    domains: ['friday.tw'],
    strictSubdomains: ['video.friday.tw'],
    whitelistPatterns: [/^https:\/\/video\.friday\.tw\/((drama|movie|anime|show|detail|sn)\/(detail\/)?[0-9]+|player)/],
    matchUrl: (url) =>
      url.hostname.toLowerCase() === 'video.friday.tw' &&
      (/\/(detail|drama|movie|anime|show|sn)\//.test(url.pathname) || url.pathname.includes('/player'))
  },
  {
    id: 'max',
    name: 'Max (HBO)',
    enabled: true,
    domains: ['max.com', 'hbomax.com'],
    whitelistPatterns: [
      /^https:\/\/(www\.|play\.)?max\.com\/.*(video\/watch|player|watch)\/[a-zA-Z0-9_-]+/,
      /^https:\/\/(www\.|play\.)?hbomax\.com\/.*(video\/watch|player|watch)\/[a-zA-Z0-9_-]+/
    ],
    matchUrl: (url) =>
      url.pathname.includes('/video/watch') || url.pathname.includes('/player/') || url.pathname.includes('/watch/')
  },
  {
    id: 'iqiyi',
    name: '愛奇藝 iQIYI',
    enabled: true,
    domains: ['iq.com', 'iqiyi.com'],
    whitelistPatterns: [
      /^https:\/\/(www\.)?iq\.com\/([a-zA-Z_-]+\/)?play\/[a-zA-Z0-9_-]+/,
      /^https:\/\/(www\.)?iqiyi\.com\/[va]_[a-zA-Z0-9]+\.html/
    ],
    matchUrl: (url) => {
      const h = url.hostname.toLowerCase();
      if (h === 'iq.com' || h.endsWith('.iq.com')) return url.pathname.includes('/play/');
      if (h === 'iqiyi.com' || h.endsWith('.iqiyi.com')) return url.pathname.includes('/v_') || url.pathname.includes('/a_');
      return false;
    }
  },
  {
    id: 'appletv',
    name: 'Apple TV+',
    enabled: true,
    domains: ['tv.apple.com'],
    whitelistPatterns: [/^https:\/\/tv\.apple\.com\/.+/],
    matchUrl: (url) =>
      url.pathname.includes('/episode/') ||
      url.pathname.includes('/movie/') ||
      url.pathname.includes('/show/') ||
      url.pathname.includes('/sport/') ||
      url.pathname.includes('umc.cmc.')
  },
  {
    id: 'catchplay',
    name: 'CATCHPLAY+',
    enabled: true,
    domains: ['catchplay.com'],
    whitelistPatterns: [/^https:\/\/(www\.)?catchplay\.com\/.*(watch|play|video)\/[a-zA-Z0-9_-]+/],
    matchUrl: (url) =>
      url.pathname.includes('/watch/') || url.pathname.includes('/play/') || url.pathname.includes('/video/')
  },

  // =========================================================================
  // 預先取得授權但尚未局部開放支援之候選名單 (Permitted Staged - enabled: false，共 8 個)
  // 未來若欲開放，只需將 enabled 改為 true 並實裝專屬選擇器，不需重送 Chrome 審查！
  // =========================================================================
  {
    id: 'litv',
    name: 'LiTV 立視線上影視',
    enabled: false,
    domains: ['litv.tv'],
    whitelistPatterns: [/^https:\/\/(www\.)?litv\.tv\/vod\/.+/],
    matchUrl: (url) => url.pathname.includes('/vod/')
  },
  {
    id: 'wetv',
    name: 'WeTV',
    enabled: false,
    domains: ['wetv.vip'],
    whitelistPatterns: [/^https:\/\/(www\.)?wetv\.vip\/.*\/?play\/.+/],
    matchUrl: (url) => url.pathname.includes('/play/')
  },
  {
    id: 'bilibili_tv',
    name: 'Bilibili 國際版',
    enabled: false,
    domains: ['bilibili.tv'],
    whitelistPatterns: [/^https:\/\/(www\.)?bilibili\.tv\/.*\/?play\/.+/],
    matchUrl: (url) => url.pathname.includes('/play/')
  },
  {
    id: 'dailymotion',
    name: 'Dailymotion',
    enabled: false,
    domains: ['dailymotion.com'],
    whitelistPatterns: [/^https:\/\/(www\.)?dailymotion\.com\/video\/.+/],
    matchUrl: (url) => url.pathname.includes('/video/')
  },
  {
    id: 'hulu',
    name: 'Hulu',
    enabled: false,
    domains: ['hulu.com'],
    whitelistPatterns: [/^https:\/\/(www\.)?hulu\.com\/watch\/.+/],
    matchUrl: (url) => url.pathname.includes('/watch/')
  },
  {
    id: 'peacock',
    name: 'Peacock',
    enabled: false,
    domains: ['peacocktv.com'],
    whitelistPatterns: [/^https:\/\/(www\.)?peacocktv\.com\/watch\/.+/],
    matchUrl: (url) => url.pathname.includes('/watch/')
  },
  {
    id: 'paramount',
    name: 'Paramount+',
    enabled: false,
    domains: ['paramountplus.com'],
    whitelistPatterns: [/^https:\/\/(www\.)?paramountplus\.com\/(shows|movies)\/.+/],
    matchUrl: (url) => url.pathname.includes('/shows/') || url.pathname.includes('/movies/')
  },
  {
    id: 'hbogo',
    name: 'HBO GO Asia',
    enabled: false,
    domains: ['hbogoasia.tw', 'hbogoasia.com'],
    whitelistPatterns: [/^https:\/\/(www\.)?hbogoasia\.(tw|com)\/.*\/?play\/.+/],
    matchUrl: (url) => url.pathname.includes('/play/')
  }
];

/**
 * 依據 PLATFORM_REGISTRY 單一來源自動衍生之 18 大正式平台正則白名單
 */
export const HOST_WHITELIST: RegExp[] = PLATFORM_REGISTRY.filter((p) => p.enabled).flatMap((p) => p.whitelistPatterns);

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
        if (p.strictSubdomains && !p.strictSubdomains.includes(host)) continue;
        return p;
      }
    }
  } catch {
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
        if (p.strictSubdomains && !p.strictSubdomains.includes(host)) continue;
        if (p.matchUrl(url)) {
          return p;
        }
      }
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * 非官方／高風險第三方影視網站清單（含盜版站台如 Anime1.me）：
 * 零 Manifest 宣告與零正式授權，僅在彩蛋解鎖後於 activeTab 手動測試時有限放行。
 */
export const HIGH_RISK_STREAMING_CATALOG: { name: string; pattern: RegExp }[] = [
  { name: 'Anime1.me', pattern: /(?:^|\.)anime1\.me/i },
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
    if (url.protocol !== 'https:') return null;
    const host = url.hostname.toLowerCase();
    for (const item of HIGH_RISK_STREAMING_CATALOG) {
      if (item.pattern.test(host)) {
        return { name: item.name, isHighRisk: true };
      }
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * 檢查主機名稱是否為本機、私有網路 (RFC 1918)、Link-Local 雲端中繼資料或內部保留網域 (SSRF 縱深防禦)
 */
export function isPrivateOrInternalHost(rawHost: string): boolean {
  const host = rawHost.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;
  if (
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host === '0:0:0:0:0:0:0:1' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.localhost')
  ) {
    return true;
  }
  if (
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host)
  ) {
    return true;
  }
  return false;
}

/**
 * 檢查當前網址是否為可透過 activeTab 通用模式支援之高風險或第三方串流網頁 (嚴格 HTTPS + 過濾內部與本機網址)
 */
export function isUniversalSupportedUrl(rawUrl?: string): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  try {
    const url = new URL(rawUrl.trim());
    if (url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    if (isPrivateOrInternalHost(host)) {
      return false;
    }
    if (host === 'anime1.me' || host.endsWith('.anime1.me')) {
      return (url.pathname.length > 1 && url.pathname !== '/') || url.searchParams.has('cat');
    }
    if (getHighRiskPlatform(rawUrl)) {
      return true;
    }
    return false;
  } catch {
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
  if (allowCandidates && isUniversalSupportedUrl(rawUrl)) {
    return true;
  }
  return false;
}

/**
 * 檢查當前網域是否屬於「已開放啟用 (或彩蛋解鎖)」之平台網域
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
 * 核心網址安全白名單校驗器 (客戶端 / 共用單一驗證實作)
 * 基於 PLATFORM_REGISTRY 與 isPrivateOrInternalHost 單一來源衍生，杜絕重複規則漂移。
 */
export function isUrlAllowed(rawUrl: string, allowCandidates = false): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  const targetUrl = rawUrl.trim();
  try {
    const parsed = new URL(targetUrl);
    if (parsed.protocol !== 'https:' || isPrivateOrInternalHost(parsed.hostname)) {
      return false;
    }
  } catch {
    return false;
  }

  if (!isPlatformActive(targetUrl, allowCandidates)) {
    return false;
  }

  if (allowCandidates && (isPlatformPermitted(targetUrl) || isUniversalSupportedUrl(targetUrl))) {
    return true;
  }

  const matched = getPlatformByUrl(targetUrl);
  if (!matched || !matched.enabled) return false;

  return HOST_WHITELIST.some((regex) => regex.test(targetUrl)) || matched.matchUrl(new URL(targetUrl));
}

/**
 * 伺服器端重導向與建房白名單驗證 (嚴格強制 HTTPS + SSRF 防禦 + 預授權平台放行)
 */
export function isServerUrlAllowed(rawUrl: string, allowUniversal = false): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  const targetUrl = rawUrl.trim();

  try {
    const parsed = new URL(targetUrl);
    if (parsed.protocol !== 'https:' || isPrivateOrInternalHost(parsed.hostname)) {
      return false;
    }
  } catch {
    return false;
  }

  if (isPlatformPermitted(targetUrl)) {
    return true;
  }

  if (allowUniversal && isUniversalSupportedUrl(targetUrl)) {
    return true;
  }

  return false;
}
