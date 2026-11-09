import { isPlatformActive, isPlatformPermitted } from './platforms';

export type ConnectionMode = 'DEFAULT' | 'CUSTOM_IP' | 'P2P';

// 伺服器端目標網址安全白名單 (縱深防禦：防範惡意 Host 廣播釣魚或偽協定網址)
export const SERVER_HOST_WHITELIST: RegExp[] = [
  /^https:\/\/www\.youtube\.com\/watch\?.*v=[a-zA-Z0-9_-]+/,
  /^https:\/\/www\.youtube\.com\/watch\?v=[a-zA-Z0-9_-]+/,
  /^https:\/\/(www\.|m\.)?youtube\.com\/(watch\?.*v=|shorts\/|live\/|embed\/)[a-zA-Z0-9_-]+/,
  /^https:\/\/youtu\.be\/[a-zA-Z0-9_-]+/,
  /^https:\/\/(www\.)?bilibili\.com\/(video\/[a-zA-Z0-9]+|list\/.+\?.*bvid=BV[a-zA-Z0-9]+)/,
  /^https:\/\/(www\.)?bilibili\.com\/bangumi\/play\/(ep|ss)[0-9]+/,
  /^https:\/\/(www\.|sp\.)?nicovideo\.jp\/watch\/[a-zA-Z0-9]+/,
  /^https:\/\/anime1\.me\/(\?cat=[0-9]+|.+)/,
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
  /^https:\/\/(www\.|play\.)?(max|hbomax)\.com\/.*(video\/watch|player|watch)\/[a-zA-Z0-9_-]+/,
  /^https:\/\/(www\.)?iq\.com\/([a-zA-Z_-]+\/)?play\/[a-zA-Z0-9_-]+/,
  /^https:\/\/(www\.)?iqiyi\.com\/[va]_[a-zA-Z0-9]+\.html/,
  /^https:\/\/tv\.apple\.com\/.+/
];

export type SyncineEvent = 
  | 'CREATE_ROOM' 
  | 'CREATE_ROOM_SUCCESS' 
  | 'JOIN_ROOM' 
  | 'JOIN_ROOM_SUCCESS' 
  | 'LEAVE_ROOM'
  | 'REQUEST_CURRENT_STATE' 
  | 'REQUEST_INIT_SYNC'
  | 'SYNC_STATE' 
  | 'REDIRECT_ROOM' 
  | 'TOGGLE_PERMISSION' 
  | 'SIGNAL_OFFER'
  | 'SIGNAL_ANSWER'
  | 'SIGNAL_ICE_CANDIDATE'
  | 'P2P_FALLBACK'
  | 'HOST_PRIVILEGE_GRANTED'
  | 'ERROR';

export type CoViewEvent = SyncineEvent;

export interface SyncinePayload {
  event: SyncineEvent;
  roomId?: string;
  data?: any;
}

export type CoViewPayload = SyncinePayload;

export interface CreateRoomReq {
  event: 'CREATE_ROOM';
  data: {
    userId: string;
    currentUrl: string;
    isSelfHosted?: boolean;
    mode?: ConnectionMode;
    customServerUrl?: string;
    language?: string;
  };
}

export interface CreateRoomRes {
  event: 'CREATE_ROOM_SUCCESS';
  roomId: string;
  data: {
    allowGuestControl: boolean;
    mode?: ConnectionMode;
    shareCode?: string;
    resumeToken?: string;
  };
}

export interface JoinRoomReq {
  event: 'JOIN_ROOM';
  roomId: string;
  data: {
    userId: string;
    mode?: ConnectionMode;
    isReconnecting?: boolean;
    resumeToken?: string;
  };
}

export interface JoinRoomRes {
  event: 'JOIN_ROOM_SUCCESS';
  roomId: string;
  data: {
    allowGuestControl: boolean;
    currentUrl: string;
    isHost: boolean;
    mode?: ConnectionMode;
    hostSocketId: string;
    resumeToken?: string;
  };
}

export interface RequestCurrentStateMsg {
  event: 'REQUEST_CURRENT_STATE';
  roomId: string;
}

export interface SyncStateMsg {
  event: 'SYNC_STATE';
  roomId: string;
  targetGuestSocketId?: string;
  data: {
    action: 'PLAY' | 'PAUSE' | 'SEEK' | 'HEARTBEAT';
    currentTime: number;
    timestamp: number;
    paused?: boolean;
    playbackRate?: number;
  };
}

export interface RedirectRoomMsg {
  event: 'REDIRECT_ROOM';
  roomId: string;
  data: {
    targetUrl: string;
  };
}

export interface TogglePermissionMsg {
  event: 'TOGGLE_PERMISSION';
  roomId: string;
  data: {
    allowGuestControl: boolean;
  };
}

export interface SignalOfferMsg {
  event: 'SIGNAL_OFFER';
  roomId: string;
  data: {
    targetSocketId?: string;
    senderSocketId?: string;
    targetUserId?: string;
    senderUserId?: string;
    sdp: any;
  };
}

export interface SignalAnswerMsg {
  event: 'SIGNAL_ANSWER';
  roomId: string;
  data: {
    targetSocketId?: string;
    senderSocketId?: string;
    targetUserId?: string;
    senderUserId?: string;
    sdp: any;
  };
}

export interface SignalIceCandidateMsg {
  event: 'SIGNAL_ICE_CANDIDATE';
  roomId: string;
  data: {
    targetSocketId?: string;
    senderSocketId?: string;
    targetUserId?: string;
    senderUserId?: string;
    candidate: any;
  };
}

export interface RoomMember {
  socketId: string;
  userId: string;
  isHost: boolean;
  joinedAt: number;
}

export interface RoomState {
  roomId: string;
  hostSocketId: string;
  hostUserId: string;
  hostLanguage?: string;
  currentUrl: string;
  allowGuestControl: boolean;
  isSelfHosted: boolean;
  mode?: ConnectionMode;
  hostResumeToken?: string;
  members: Map<string, RoomMember>;
  hostDisconnectTimer?: NodeJS.Timeout;
  emptyRoomTimer?: NodeJS.Timeout;
}


export function isServerUrlAllowed(rawUrl: string, allowUniversal = false): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  const targetUrl = rawUrl.trim();
  try {
    const parsed = new URL(targetUrl);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    // 基礎 SSRF 防護：嚴格阻斷本機與內部私有 IP
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host.startsWith('192.168.') ||
      host.startsWith('10.') ||
      host.startsWith('172.16.')
    ) {
      return false;
    }

    // 1. 白名單守衛：開放所有在權限名單中之目標平台 (涵蓋現行 18 個活躍平台與 9 個候選預授權平台)
    if (isPlatformPermitted(targetUrl)) {
      return true;
    }

    // 2. 若由客戶端攜帶 allowUniversal (例如解鎖 activeTab 通用模式)，放行合法外部 HTTPS 網址
    if (allowUniversal) {
      return true;
    }

    return false;
  } catch (e) {
    return false;
  }
}

const GENERIC_TRACKING_PARAM_REGEX =
  /^(utm_|fbclid$|gclid$|spm|from$|from_|vd_source$|track|tctx$|ref$|share|si$|pp$|ab_channel$)/i;

function buildCleanGenericUrl(url: URL): string {
  const kept: [string, string][] = [];
  url.searchParams.forEach((val, key) => {
    if (!GENERIC_TRACKING_PARAM_REGEX.test(key)) {
      kept.push([key, val]);
    }
  });
  if (kept.length === 0) {
    return `${url.origin}${url.pathname}`;
  }
  kept.sort((a, b) => a[0].localeCompare(b[0]));
  const qs = new URLSearchParams(kept).toString();
  return `${url.origin}${url.pathname}?${qs}`;
}

function extractPrimeVideoId(url: URL): string | null {
  const gti = url.searchParams.get('gti');
  if (gti && /^[a-zA-Z0-9._-]{8,}$/.test(gti)) {
    return gti;
  }
  const gpMatch = url.pathname.match(/\/gp\/video\/detail\/([a-zA-Z0-9._-]{8,})/i);
  if (gpMatch && gpMatch[1]) {
    return gpMatch[1];
  }
  const parts = url.pathname.split(/\/detail\//i);
  if (parts.length > 1 && parts[1]) {
    const segs = parts[1].split('/').filter((s) => Boolean(s) && !/^ref=/i.test(s));
    if (
      segs.length >= 2 &&
      !/^amzn1\.dv\.gti\./i.test(segs[0]) &&
      (/^amzn1\.dv\.gti\./i.test(segs[1]) || /^[A-Z0-9]{10,}$/.test(segs[1]))
    ) {
      return segs[1];
    }
    if (segs.length >= 1 && segs[0].length >= 8) {
      return segs[0];
    }
  }
  return null;
}

export function getVideoIdentifier(rawUrl?: string): string | null {
  if (!rawUrl) return null;
  try {
    const url = new URL(rawUrl);

    if (url.hostname.includes('youtube.com')) {
      const v = url.searchParams.get('v');
      if (v) return `yt:${v}`;
      if (url.pathname.startsWith('/embed/') || url.pathname.startsWith('/shorts/') || url.pathname.startsWith('/live/')) {
        const id = url.pathname.split('/')[2];
        if (id) return `yt:${id}`;
      }
    }
    if (url.hostname.includes('youtu.be')) {
      const id = url.pathname.slice(1).split('?')[0];
      if (id) return `yt:${id}`;
    }

    if (url.hostname.includes('bilibili.com')) {
      const match = url.pathname.match(/\/(BV[a-zA-Z0-9]+|av[0-9]+)/i);
      const bvidParam = url.pathname.toLowerCase().startsWith('/list/') ? url.searchParams.get('bvid') : null;
      const vid = (match && match[1]) || bvidParam;
      if (vid) {
        const p = url.searchParams.get('p');
        return p && p !== '1' ? `bili:${vid}?p=${p}` : `bili:${vid}`;
      }
      const epMatch = url.pathname.match(/\/bangumi\/play\/(ep[0-9]+|ss[0-9]+)/i);
      if (epMatch && epMatch[1]) {
        return `bili:${epMatch[1].toLowerCase()}`;
      }
    }

    if (url.hostname.includes('nicovideo.jp')) {
      const match = url.pathname.match(/\/watch\/([a-zA-Z0-9]+)/);
      if (match && match[1]) return `nico:${match[1]}`;
    }

    if (url.hostname.includes('anime1.me')) {
      const cleanPath = decodeURIComponent(url.pathname).replace(/^\/+|\/+$/g, '');
      if (cleanPath) return `anime1:${cleanPath}`;
      const cat = url.searchParams.get('cat');
      if (cat) {
        const paged = url.searchParams.get('paged') || url.searchParams.get('page');
        return paged && paged !== '1' ? `anime1:cat:${cat}:p${paged}` : `anime1:cat:${cat}`;
      }
    }

    if (url.hostname.includes('netflix.com')) {
      const match = url.pathname.match(/\/watch\/([0-9]+)/);
      if (match && match[1]) return `netflix:${match[1]}`;
    }

    if (url.hostname.includes('vimeo.com')) {
      const videoSubMatch = url.pathname.match(/\/video\/([0-9]{4,})/);
      if (videoSubMatch && videoSubMatch[1]) return `vimeo:${videoSubMatch[1]}`;
      const match = url.pathname.match(/\/([0-9]{5,})/);
      if (match && match[1]) return `vimeo:${match[1]}`;
    }

    if (url.hostname.includes('gamer.com.tw')) {
      const sn = url.searchParams.get('sn');
      if (sn) return `gamer:${sn}`;
    }

    if (url.hostname.includes('twitch.tv')) {
      const vodMatch = url.pathname.match(/\/videos\/([0-9]+)/);
      if (vodMatch && vodMatch[1]) return `twitch:video:${vodMatch[1]}`;
      if (url.hostname.includes('clips.twitch.tv')) {
        const clipId = url.pathname.slice(1).split('/')[0];
        if (clipId) return `twitch:clip:${clipId}`;
      }
      const clipMatch = url.pathname.match(/\/clip\/([a-zA-Z0-9_-]+)/);
      if (clipMatch && clipMatch[1]) return `twitch:clip:${clipMatch[1]}`;
      const channelMatch = url.pathname.match(/^\/([a-zA-Z0-9_]{3,25})\/?$/);
      if (channelMatch && channelMatch[1] && !['directory', 'p', 'settings', 'search', 'videos'].includes(channelMatch[1].toLowerCase())) {
        return `twitch:channel:${channelMatch[1].toLowerCase()}`;
      }
    }

    if (url.hostname.includes('disneyplus.com')) {
      const match = url.pathname.match(/\/(?:video|play)\/([a-zA-Z0-9_-]+)/);
      if (match && match[1]) return `disney:${match[1]}`;
      const seriesMatch = url.pathname.match(/\/series\/[^\/]+\/([a-zA-Z0-9_-]+)/);
      if (seriesMatch && seriesMatch[1]) return `disney:series:${seriesMatch[1]}`;
    }

    if (url.hostname.includes('primevideo.com') || url.hostname.includes('amazon.com')) {
      const primeId = extractPrimeVideoId(url);
      if (primeId) return `prime:${primeId}`;
    }

    if (url.hostname.includes('myvideo.net.tw')) {
      const detailsMatch = url.pathname.match(/\/details\/([0-9]+)\/([0-9]+)/);
      if (detailsMatch && detailsMatch[1] && detailsMatch[2]) return `myvideo:${detailsMatch[1]}:${detailsMatch[2]}`;
      const playerMatch = url.pathname.match(/\/player\/([0-9]+)/);
      if (playerMatch && playerMatch[1]) return `myvideo:player:${playerMatch[1]}`;
    }

    if (url.hostname.includes('linetv.tw')) {
      const dramaMatch = url.pathname.match(/\/drama\/([0-9]+)(?:\/eps\/([0-9]+))?/);
      if (dramaMatch && dramaMatch[1]) return dramaMatch[2] ? `linetv:${dramaMatch[1]}:${dramaMatch[2]}` : `linetv:${dramaMatch[1]}`;
    }

    if (url.hostname.includes('kktv.me')) {
      const match = url.pathname.match(/\/play\/([a-zA-Z0-9]+)/);
      if (match && match[1]) return `kktv:${match[1]}`;
    }

    if (url.hostname.includes('crunchyroll.com')) {
      const match = url.pathname.match(/\/watch\/([a-zA-Z0-9]+)/);
      if (match && match[1]) return `crunchyroll:${match[1]}`;
    }

    if (url.hostname.includes('friday.tw')) {
      const match = url.pathname.match(/\/(drama|movie|anime|show|detail|sn)\/(?:detail\/)?([0-9]+)/);
      if (match && match[2]) {
        const ep = url.searchParams.get('episode');
        return ep ? `friday:${match[1]}:${match[2]}?episode=${ep}` : `friday:${match[1]}:${match[2]}`;
      }
      if (url.pathname.includes('/player')) {
        const pid = url.searchParams.get('id') || url.searchParams.get('contentId') || url.searchParams.get('streamingId');
        const ep = url.searchParams.get('episode');
        if (pid) return ep ? `friday:player:${pid}?episode=${ep}` : `friday:player:${pid}`;
      }
    }

    if (url.hostname.includes('max.com') || url.hostname.includes('hbomax.com')) {
      const match = url.pathname.match(/\/(?:video\/watch|player|watch)\/([a-zA-Z0-9_-]+)/);
      if (match && match[1]) return `max:${match[1]}`;
    }

    if (url.hostname.includes('iq.com')) {
      const match = url.pathname.match(/\/play\/([a-zA-Z0-9_-]+)/);
      if (match && match[1]) return `iqiyi:${match[1]}`;
    }
    if (url.hostname.includes('iqiyi.com')) {
      const match = url.pathname.match(/\/[va]_([a-zA-Z0-9]+)\.html/);
      if (match && match[1]) return `iqiyi:${match[1]}`;
    }

    if (url.hostname.includes('tv.apple.com')) {
      const umcMatch = url.pathname.match(/(umc\.cmc\.[a-zA-Z0-9]+)/i);
      if (umcMatch && umcMatch[1]) return `appletv:${umcMatch[1].toLowerCase()}`;
      const epMatch = url.pathname.match(/\/(?:episode|movie|show|sport)\/(?:[^\/]+\/)?([a-zA-Z0-9._-]+)/);
      if (epMatch && epMatch[1]) return `appletv:${epMatch[1]}`;
    }

    return buildCleanGenericUrl(url);
  } catch (e) {
    return null;
  }
}

/**
 * 取得純淨的跨平台標準影片播放網址 (Canonical Video URL)
 * 徹底剔除各平台的龐大追蹤標籤、推薦上下文 (如 Netflix tctx/trackId, YouTube ab_channel/list, Bilibili spm_id)
 * 確保房間同步與強制跳轉時傳遞最精簡、乾淨且杜絕隱私洩漏的純粹影片網址
 */
export function getCanonicalVideoUrl(rawUrl?: string): string {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  try {
    const url = new URL(rawUrl.trim());
    const host = url.hostname.toLowerCase();

    // 1. Netflix: 僅保留標準 /watch/<id>，徹底剔除 trackId 與超長的 tctx 追蹤字串
    if (host.includes('netflix.com')) {
      const match = url.pathname.match(/\/watch\/([0-9]+)/);
      if (match && match[1]) {
        return `https://www.netflix.com/watch/${match[1]}`;
      }
    }

    // 2. YouTube: 僅保留標準 ?v=<id>
    if (host.includes('youtube.com')) {
      const v = url.searchParams.get('v');
      if (v) return `https://www.youtube.com/watch?v=${v}`;
      if (url.pathname.startsWith('/embed/') || url.pathname.startsWith('/shorts/') || url.pathname.startsWith('/live/')) {
        const id = url.pathname.split('/')[2];
        if (id) return `https://www.youtube.com/watch?v=${id}`;
      }
    }
    if (host.includes('youtu.be')) {
      const id = url.pathname.slice(1).split('?')[0];
      if (id) return `https://www.youtube.com/watch?v=${id}`;
    }

    // 3. Bilibili: 僅保留純淨 /video/BV|av... 或 /bangumi/play/ep...
    if (host.includes('bilibili.com')) {
      const bvMatch = url.pathname.match(/\/(BV[a-zA-Z0-9]+|av[0-9]+)/i);
      const bvidParam = url.pathname.toLowerCase().startsWith('/list/') ? url.searchParams.get('bvid') : null;
      const vid = (bvMatch && bvMatch[1]) || bvidParam;
      if (vid) {
        const p = url.searchParams.get('p');
        return p && p !== '1' ? `https://www.bilibili.com/video/${vid}?p=${p}` : `https://www.bilibili.com/video/${vid}`;
      }
      const epMatch = url.pathname.match(/\/bangumi\/play\/(ep[0-9]+|ss[0-9]+)/i);
      if (epMatch && epMatch[1]) {
        return `https://www.bilibili.com/bangumi/play/${epMatch[1].toLowerCase()}`;
      }
    }

    // 4. Niconico: 僅保留標準 /watch/<id>
    if (host.includes('nicovideo.jp')) {
      const match = url.pathname.match(/\/watch\/([a-zA-Z0-9]+)/);
      if (match && match[1]) {
        return `https://www.nicovideo.jp/watch/${match[1]}`;
      }
    }

    // 5. Anime1.me: 支援單集路徑與 ?cat=<id> 合集目錄頁
    if (host.includes('anime1.me')) {
      if ((url.pathname === '/' || url.pathname === '') && url.searchParams.has('cat')) {
        const cat = url.searchParams.get('cat')!;
        const paged = url.searchParams.get('paged') || url.searchParams.get('page');
        return paged && paged !== '1'
          ? `https://anime1.me/?cat=${encodeURIComponent(cat)}&paged=${encodeURIComponent(paged)}`
          : `https://anime1.me/?cat=${encodeURIComponent(cat)}`;
      }
      const cleanPath = url.pathname.replace(/\/+$/, '') || '/';
      return `${url.origin}${cleanPath}`;
    }

    // 6. Vimeo: 支援標準影片、showcase/.../video/<id> 以及未公開影片隱私 Hash
    if (host.includes('vimeo.com')) {
      const hParam = url.searchParams.get('h');
      const videoSubMatch = url.pathname.match(/\/video\/([0-9]{4,})/);
      if (videoSubMatch && videoSubMatch[1]) {
        return hParam ? `https://vimeo.com/${videoSubMatch[1]}?h=${encodeURIComponent(hParam)}` : `https://vimeo.com/${videoSubMatch[1]}`;
      }
      const directMatch = url.pathname.match(/^\/([0-9]{5,})(?:\/([a-zA-Z0-9]+))?/);
      if (directMatch && directMatch[1]) {
        if (directMatch[2] && directMatch[2] !== 'video') {
          return `https://vimeo.com/${directMatch[1]}/${directMatch[2]}`;
        }
        return hParam ? `https://vimeo.com/${directMatch[1]}?h=${encodeURIComponent(hParam)}` : `https://vimeo.com/${directMatch[1]}`;
      }
      const anyMatch = url.pathname.match(/\/([0-9]{5,})/);
      if (anyMatch && anyMatch[1]) {
        return `https://vimeo.com/${anyMatch[1]}`;
      }
    }

    // 7. 巴哈姆特動畫瘋: 僅保留標準 https://ani.gamer.com.tw/animeVideo.php?sn=<sn>
    if (host.includes('gamer.com.tw')) {
      const sn = url.searchParams.get('sn');
      if (sn) {
        return `https://ani.gamer.com.tw/animeVideo.php?sn=${sn}`;
      }
    }

    // 8. Twitch: 剔除追蹤參數，保留標準網址
    if (host.includes('twitch.tv')) {
      const vodMatch = url.pathname.match(/\/videos\/([0-9]+)/);
      if (vodMatch && vodMatch[1]) {
        return `https://www.twitch.tv/videos/${vodMatch[1]}`;
      }
      if (host.includes('clips.twitch.tv')) {
        const clipId = url.pathname.slice(1).split('/')[0];
        if (clipId) return `https://clips.twitch.tv/${clipId}`;
      }
      const clipMatch = url.pathname.match(/\/clip\/([a-zA-Z0-9_-]+)/);
      if (clipMatch && clipMatch[1]) {
        return `https://clips.twitch.tv/${clipMatch[1]}`;
      }
      const channelMatch = url.pathname.match(/^\/([a-zA-Z0-9_]{3,25})\/?$/);
      if (channelMatch && channelMatch[1] && !['directory', 'p', 'settings', 'search', 'videos'].includes(channelMatch[1].toLowerCase())) {
        return `https://www.twitch.tv/${channelMatch[1]}`;
      }
    }

    // 9. Disney+: 保留實際路由 (/play/<id> 或 /video/<id>) 與 /series/<slug>/<id>
    if (host.includes('disneyplus.com')) {
      const match = url.pathname.match(/\/(video|play)\/([a-zA-Z0-9_-]+)/);
      if (match && match[1] && match[2]) {
        return `https://www.disneyplus.com/${match[1]}/${match[2]}`;
      }
      const seriesMatch = url.pathname.match(/\/series\/([^\/]+)\/([a-zA-Z0-9_-]+)/);
      if (seriesMatch && seriesMatch[1] && seriesMatch[2]) {
        return `https://www.disneyplus.com/series/${seriesMatch[1]}/${seriesMatch[2]}`;
      }
    }

    // 10. Prime Video / Amazon: 精確保留 GTI/ASIN
    if (host.includes('primevideo.com') || host.includes('amazon.com')) {
      const primeId = extractPrimeVideoId(url);
      if (primeId) {
        if (host.includes('amazon.com') && url.pathname.includes('/gp/video/detail/')) {
          return `https://www.amazon.com/gp/video/detail/${primeId}`;
        }
        return `https://www.primevideo.com/detail/${primeId}`;
      }
    }

    // 11. MyVideo: 保留純淨 details 或 player 路徑
    if (host.includes('myvideo.net.tw')) {
      const detailsMatch = url.pathname.match(/\/details\/([0-9]+)\/([0-9]+)/);
      if (detailsMatch && detailsMatch[1] && detailsMatch[2]) {
        return `https://www.myvideo.net.tw/details/${detailsMatch[1]}/${detailsMatch[2]}`;
      }
      const playerMatch = url.pathname.match(/\/player\/([0-9]+)/);
      if (playerMatch && playerMatch[1]) {
        return `https://www.myvideo.net.tw/player/${playerMatch[1]}`;
      }
    }

    // 12. LINE TV: 僅保留標準 drama/eps 路徑
    if (host.includes('linetv.tw')) {
      const dramaMatch = url.pathname.match(/\/drama\/([0-9]+)(?:\/eps\/([0-9]+))?/);
      if (dramaMatch && dramaMatch[1]) {
        return dramaMatch[2]
          ? `https://www.linetv.tw/drama/${dramaMatch[1]}/eps/${dramaMatch[2]}`
          : `https://www.linetv.tw/drama/${dramaMatch[1]}`;
      }
    }

    // 13. KKTV: 僅保留標準 /play/<id>
    if (host.includes('kktv.me')) {
      const match = url.pathname.match(/\/play\/([a-zA-Z0-9]+)/);
      if (match && match[1]) {
        return `https://www.kktv.me/play/${match[1]}`;
      }
    }

    // 14. Crunchyroll: 僅保留標準 /watch/<id>
    if (host.includes('crunchyroll.com')) {
      const match = url.pathname.match(/\/watch\/([a-zA-Z0-9]+)/);
      if (match && match[1]) {
        return `https://www.crunchyroll.com/watch/${match[1]}`;
      }
    }

    // 15. 遠傳 friDay 影音: 保留純淨 detail / sn / player 與 episode
    if (host.includes('friday.tw')) {
      const match = url.pathname.match(/\/(drama|movie|anime|show|detail)\/(?:detail\/)?([0-9]+)/);
      if (match && match[2]) {
        const type = match[1];
        const id = match[2];
        const ep = url.searchParams.get('episode');
        return ep
          ? `https://video.friday.tw/${type}/detail/${id}?episode=${ep}`
          : `https://video.friday.tw/${type}/detail/${id}`;
      }
      const snMatch = url.pathname.match(/\/sn\/([0-9]+)/);
      if (snMatch && snMatch[1]) {
        return `https://video.friday.tw/sn/${snMatch[1]}`;
      }
      if (url.pathname.includes('/player')) {
        return buildCleanGenericUrl(url);
      }
    }

    // 16. Max: 保留純淨播放路徑
    if (host.includes('max.com') || host.includes('hbomax.com')) {
      const vpMatch = url.pathname.match(/\/(?:video\/watch|player)\/([a-zA-Z0-9_-]+)/);
      if (vpMatch && vpMatch[1]) {
        return `https://play.max.com/video/watch/${vpMatch[1]}`;
      }
      const watchMatch = url.pathname.match(/^(.*\/watch)\/([a-zA-Z0-9_-]+)/);
      if (watchMatch && watchMatch[2]) {
        return `https://play.max.com${watchMatch[1]}/${watchMatch[2]}`;
      }
    }

    // 17. 愛奇藝 iQIYI: 僅保留標準 /play/<id> 或 /v_<id>.html
    if (host.includes('iq.com')) {
      const match = url.pathname.match(/\/play\/([a-zA-Z0-9_-]+)/);
      if (match && match[1]) {
        return `https://www.iq.com/play/${match[1]}`;
      }
    }
    if (host.includes('iqiyi.com')) {
      const match = url.pathname.match(/\/[va]_([a-zA-Z0-9]+)\.html/);
      if (match && match[1]) {
        return `https://www.iqiyi.com/v_${match[1]}.html`;
      }
    }

    // 18. Apple TV+: 保留原始播放路徑並剝離追蹤查詢參數，避免電影被改寫為 /episode/ 造成 404
    if (host.includes('tv.apple.com')) {
      const cleanPath = url.pathname.replace(/\/+$/, '');
      if (cleanPath && cleanPath !== '/') {
        return `https://tv.apple.com${cleanPath}`;
      }
    }

    return buildCleanGenericUrl(url);
  } catch (e) {
    return rawUrl.trim();
  }
}

export function isSameVideoOrWebsite(url1?: string, url2?: string): boolean {
  if (!url1 || !url2) return false;
  const clean1 = url1.trim();
  const clean2 = url2.trim();
  if (clean1 === clean2) return true;

  const id1 = getVideoIdentifier(clean1);
  const id2 = getVideoIdentifier(clean2);
  if (id1 && id2 && id1 === id2) return true;

  const canon1 = getCanonicalVideoUrl(clean1);
  const canon2 = getCanonicalVideoUrl(clean2);
  if (canon1 && canon2 && canon1 === canon2) return true;

  return false;
}
