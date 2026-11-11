/**
 * Syncine 伺服器端目標網址安全檢驗與局部開放中心
 */

export interface PlatformDefinition {
  id: string;
  name: string;
  enabled: boolean;
  domains: string[];
  matchUrl: (url: URL) => boolean;
}

export const PLATFORM_REGISTRY: PlatformDefinition[] = [
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
  {
    id: 'catchplay',
    name: 'CATCHPLAY+',
    enabled: true,
    domains: ['catchplay.com'],
    matchUrl: (url) =>
      url.pathname.includes('/watch/') ||
      url.pathname.includes('/play/') ||
      url.pathname.includes('/video/')
  },

  // 預先授權但尚未開放支援之平台 (enabled: false)
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
  } catch (_) {
    return false;
  }
}

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

export function isPlatformPermitted(rawUrl?: string): boolean {
  const p = getPlatformByUrl(rawUrl);
  return Boolean(p);
}
