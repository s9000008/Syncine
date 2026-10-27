export type ConnectionMode = 'DEFAULT' | 'CUSTOM_IP' | 'P2P';

// 伺服器端目標網址安全白名單 (縱深防禦：防範惡意 Host 廣播釣魚或偽協定網址)
export const SERVER_HOST_WHITELIST: RegExp[] = [
  /^https:\/\/www\.youtube\.com\/watch\?.*v=[a-zA-Z0-9_-]+/,
  /^https:\/\/www\.youtube\.com\/watch\?v=[a-zA-Z0-9_-]+/,
  /^https:\/\/www\.bilibili\.com\/video\/[a-zA-Z0-9]+/,
  /^https:\/\/www\.bilibili\.com\/bangumi\/play\/(ep|ss)[0-9]+/,
  /^https:\/\/www\.nicovideo\.jp\/watch\/[a-zA-Z0-9]+/,
  /^https:\/\/anime1\.me\/.+/,
  /^https:\/\/(www\.)?netflix\.com\/watch\/[0-9]+/
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

    return `${url.origin}${url.pathname}`;
  } catch (e) {
    return rawUrl.trim();
  }
}
