export type ConnectionMode = 'DEFAULT' | 'CUSTOM_IP' | 'P2P';

// 伺服器端目標網址安全白名單 (縱深防禦：防範惡意 Host 廣播釣魚或偽協定網址)
export const SERVER_HOST_WHITELIST: RegExp[] = [
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
  /^https:\/\/(www\.)?myvideo\.net\.tw\/(details\/[0-9]+\/[0-9]+|player\/[0-9]+)/
];

export type SyncineEvent = 
  | 'CREATE_ROOM' 
  | 'CREATE_ROOM_SUCCESS' 
  | 'JOIN_ROOM' 
  | 'JOIN_ROOM_SUCCESS' 
  | 'LEAVE_ROOM'
  | 'REQUEST_CURRENT_STATE' 
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


export function isServerUrlAllowed(rawUrl: string): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  const targetUrl = rawUrl.trim();
  if (SERVER_HOST_WHITELIST.some((regex) => regex.test(targetUrl))) {
    return true;
  }
  try {
    const parsed = new URL(targetUrl);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    if ((host === 'www.youtube.com' || host === 'youtube.com' || host === 'm.youtube.com') && parsed.pathname === '/watch' && parsed.searchParams.has('v')) {
      return true;
    }
    if ((host === 'www.bilibili.com' || host === 'bilibili.com') && (parsed.pathname.startsWith('/video/') || parsed.pathname.startsWith('/bangumi/play/'))) {
      return true;
    }
    if ((host === 'www.nicovideo.jp' || host === 'nicovideo.jp') && parsed.pathname.startsWith('/watch/')) {
      return true;
    }
    if (host === 'anime1.me' || host.endsWith('.anime1.me')) {
      return true;
    }
    if ((host === 'www.netflix.com' || host === 'netflix.com') && parsed.pathname.startsWith('/watch/')) {
      return true;
    }
    // Vimeo
    if (host === 'vimeo.com' || host === 'www.vimeo.com' || host === 'player.vimeo.com') {
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
    if ((host === 'www.primevideo.com' || host === 'primevideo.com' || host === 'www.amazon.com') && (parsed.pathname.includes('/detail/') || parsed.pathname.includes('/gp/video/'))) {
      return true;
    }
    // MyVideo
    if ((host === 'www.myvideo.net.tw' || host === 'myvideo.net.tw') && (parsed.pathname.startsWith('/details/') || parsed.pathname.startsWith('/player/'))) {
      return true;
    }
  } catch (e) {
    return false;
  }
  return false;
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
      if (url.pathname.startsWith('/embed/')) {
        const id = url.pathname.split('/')[2];
        if (id) return `https://www.youtube.com/watch?v=${id}`;
      }
    }
    if (host.includes('youtu.be')) {
      const id = url.pathname.slice(1).split('?')[0];
      if (id) return `https://www.youtube.com/watch?v=${id}`;
    }

    // 3. Bilibili: 僅保留純淨 /video/BV... 或 /bangumi/play/ep... (支援分 P 參數 ?p=)
    if (host.includes('bilibili.com')) {
      const bvMatch = url.pathname.match(/\/(BV[a-zA-Z0-9]+)/i);
      if (bvMatch && bvMatch[1]) {
        const p = url.searchParams.get('p');
        return p && p !== '1' ? `https://www.bilibili.com/video/${bvMatch[1]}?p=${p}` : `https://www.bilibili.com/video/${bvMatch[1]}`;
      }
      const epMatch = url.pathname.match(/\/bangumi\/play\/(ep[0-9]+|ss[0-9]+)/i);
      if (epMatch && epMatch[1]) {
        return `https://www.bilibili.com/bangumi/play/${epMatch[1]}`;
      }
    }

    // 4. Niconico: 僅保留標準 /watch/<id>
    if (host.includes('nicovideo.jp')) {
      const match = url.pathname.match(/\/watch\/([a-zA-Z0-9]+)/);
      if (match && match[1]) {
        return `https://www.nicovideo.jp/watch/${match[1]}`;
      }
    }

    // 5. Anime1.me
    if (host.includes('anime1.me')) {
      return `${url.origin}${url.pathname}`;
    }

    // 6. Vimeo: 僅保留標準 https://vimeo.com/<id>
    if (host.includes('vimeo.com')) {
      const match = url.pathname.match(/\/([0-9]{5,})/);
      if (match && match[1]) {
        return `https://vimeo.com/${match[1]}`;
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
      const channelMatch = url.pathname.match(/^\/([a-zA-Z0-9_]{3,25})$/);
      if (channelMatch && channelMatch[1] && !['directory', 'p', 'settings', 'search', 'videos'].includes(channelMatch[1])) {
        return `https://www.twitch.tv/${channelMatch[1]}`;
      }
    }

    // 9. Disney+: 僅保留標準 /video/<id>
    if (host.includes('disneyplus.com')) {
      const match = url.pathname.match(/\/(?:video|play)\/([a-zA-Z0-9_-]+)/);
      if (match && match[1]) {
        return `https://www.disneyplus.com/video/${match[1]}`;
      }
    }

    // 10. Prime Video / Amazon: 僅保留標準 /detail/<id>
    if (host.includes('primevideo.com') || host.includes('amazon.com')) {
      const primeMatch = url.pathname.match(/\/detail\/(?:[^\/]+\/)?([a-zA-Z0-9_-]{10,})/i);
      if (primeMatch && primeMatch[1]) {
        return `https://www.primevideo.com/detail/${primeMatch[1]}`;
      }
      const amazonMatch = url.pathname.match(/\/gp\/video\/detail\/([a-zA-Z0-9_-]{10,})/i);
      if (amazonMatch && amazonMatch[1]) {
        return `https://www.amazon.com/gp/video/detail/${amazonMatch[1]}`;
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

    return `${url.origin}${url.pathname}`;
  } catch (e) {
    return rawUrl.trim();
  }
}

export function isSameVideoOrWebsite(url1?: string, url2?: string): boolean {
  if (!url1 || !url2) return false;
  const clean1 = url1.trim();
  const clean2 = url2.trim();
  if (clean1 === clean2) return true;

  const canon1 = getCanonicalVideoUrl(clean1);
  const canon2 = getCanonicalVideoUrl(clean2);
  if (canon1 && canon2 && canon1 === canon2) return true;

  return false;
}
