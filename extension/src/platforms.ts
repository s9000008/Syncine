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
      if (h.includes('youtube.com')) {
        return (url.pathname === '/watch' && url.searchParams.has('v')) || url.pathname.startsWith('/embed/');
      }
      if (h.includes('youtu.be')) {
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
      return p.includes('/video/') || p.includes('/bangumi/play/');
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
    matchUrl: (url) => url.pathname.length > 1 && url.pathname !== '/'
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
    matchUrl: (url) => /\/([0-9]{5,}|channels\/|groups\/|showcase\/)/.test(url.pathname)
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
      return Boolean(ch && !['directory', 'p', 'settings', 'search', 'videos'].includes(ch));
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
    matchUrl: (url) => url.pathname.includes('/detail/') || url.pathname.includes('/gp/video/detail/')
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
    matchUrl: (url) => url.pathname.startsWith('/drama/')
  },
  {
    id: 'kktv',
    name: 'KKTV',
    enabled: true,
    domains: ['kktv.me'],
    matchUrl: (url) => url.pathname.startsWith('/play/')
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
    matchUrl: (url) => url.hostname.includes('video.friday.tw') && (url.pathname.includes('/detail/') || url.pathname.includes('/drama/') || url.pathname.includes('/movie/'))
  },
  {
    id: 'max',
    name: 'Max (HBO)',
    enabled: true,
    domains: ['max.com', 'hbomax.com'],
    matchUrl: (url) => url.pathname.includes('/video/watch') || url.pathname.includes('/player/')
  },
  {
    id: 'iqiyi',
    name: '愛奇藝 iQIYI',
    enabled: true,
    domains: ['iq.com', 'iqiyi.com'],
    matchUrl: (url) => {
      if (url.hostname.includes('iq.com')) return url.pathname.startsWith('/play/');
      if (url.hostname.includes('iqiyi.com')) return url.pathname.startsWith('/v_') || url.pathname.startsWith('/a_');
      return false;
    }
  },
  {
    id: 'appletv',
    name: 'Apple TV+',
    enabled: true,
    domains: ['tv.apple.com'],
    matchUrl: (url) => url.pathname.includes('/episode/') || url.pathname.includes('/movie/') || url.pathname.includes('/show/') || url.pathname.includes('umc.cmc.')
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
 * 取得當前網址對應之平台定義（無論是否已正式啟用）
 */
export function getPlatformByUrl(rawUrl?: string): PlatformDefinition | null {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  try {
    const url = new URL(rawUrl.trim());
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
 * 檢查當前網址是否為「已正式開放啟用支援 (Active)」之影音平台
 */
export function isPlatformActive(rawUrl?: string, allowCandidates = false): boolean {
  const p = getPlatformByUrl(rawUrl);
  if (!p) return false;
  return allowCandidates ? true : Boolean(p.enabled);
}

/**
 * 檢查當前網址是否在「授權名單」中（包含已正式啟用與預先申請權限者）
 */
export function isPlatformPermitted(rawUrl?: string): boolean {
  const p = getPlatformByUrl(rawUrl);
  return Boolean(p);
}

/**
 * 取得所有已正式開放支援之平台清單
 */
export function getActivePlatforms(): PlatformDefinition[] {
  return PLATFORM_REGISTRY.filter((p) => p.enabled);
}
