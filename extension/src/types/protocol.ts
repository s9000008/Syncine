export type ConnectionMode = 'DEFAULT' | 'CUSTOM_IP' | 'P2P';

export type DetectedShareCodeType = 'P2P' | 'DEFAULT' | 'CUSTOM_IP' | 'LEGACY_RAW' | 'LEGACY_COMPOSITE';

export interface ParsedConnectionInfo {
  roomId: string;
  mode: ConnectionMode;
  serverUrl: string;
  isLegacy: boolean;
  detectedType: DetectedShareCodeType;
}

export type P2PStatus = 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'FALLBACK';

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
  | 'GET_ROOM_MEMBER_COUNT'
  | 'MEMBER_COUNT_UPDATED'
  | 'HOST_PRIVILEGE_GRANTED'
  | 'ERROR';

export type CoViewEvent = SyncineEvent;

export interface SyncData {
  action: 'PLAY' | 'PAUSE' | 'SEEK' | 'HEARTBEAT';
  currentTime: number;
  timestamp: number;
  paused?: boolean;
}

export interface JoinRequest {
  requestId: string;
  guestName: string;
  guestShortId?: string;
  timestamp: number;
}

export type ConnectionStatus = 'CONNECTED' | 'RECONNECTING' | 'DISCONNECTED';

export interface RoomStateInfo {
  roomId: string;
  isHost: boolean;
  allowGuestControl: boolean;
  serverUrl: string;
  currentUrl?: string;
  mode?: ConnectionMode;
  p2pStatus?: P2PStatus;
  connectionStatus?: ConnectionStatus;
  connectedPeerCount?: number;
  serverlessHandshakeState?: 'IDLE' | 'AWAITING_ANSWER' | 'AWAITING_HOST_CONFIRM' | 'CONNECTED';
  offerCode?: string;
  answerCode?: string;
  compositeCode?: string;
  pendingJoinRequests?: JoinRequest[];
  guestAwaitingApproval?: boolean;
  resumeToken?: string;
}

export interface SignalOfferData {
  targetSocketId?: string;
  senderSocketId?: string;
  targetUserId?: string;
  senderUserId?: string;
  sdp: RTCSessionDescriptionInit;
}

export interface SignalAnswerData {
  targetSocketId?: string;
  senderSocketId?: string;
  targetUserId?: string;
  senderUserId?: string;
  sdp: RTCSessionDescriptionInit;
}

export interface SignalIceCandidateData {
  targetSocketId?: string;
  senderSocketId?: string;
  targetUserId?: string;
  senderUserId?: string;
  candidate: RTCIceCandidateInit;
}

// Content Script <-> Background <-> Offscreen 通訊 payload
export interface ExtensionMessage {
  type: 
    | 'BG_CREATE_ROOM'
    | 'BG_JOIN_ROOM'
    | 'BG_SYNC_STATE'
    | 'BG_REDIRECT_ROOM'
    | 'BG_TOGGLE_PERMISSION'
    | 'BG_LEAVE_ROOM'
    | 'BG_APPROVE_JOIN_REQUEST'
    | 'BG_REJECT_JOIN_REQUEST'
    | 'CS_SYNC_RECEIVED'
    | 'CS_REDIRECT_RECEIVED'
    | 'CS_PERMISSION_UPDATED'
    | 'CS_ROOM_STATE_CHANGED'
    | 'CS_REQUEST_CURRENT_STATE'
    | 'CS_JOIN_REQUESTS_UPDATED'
    | 'CS_CONNECTION_STATUS_CHANGED'
    | 'GET_ROOM_STATE'
    // Offscreen WebRTC 內部通訊訊息
    | 'OFFSCREEN_INIT_P2P'
    | 'OFFSCREEN_CLOSE_P2P'
    | 'OFFSCREEN_SIGNAL_OFFER'
    | 'OFFSCREEN_SIGNAL_ANSWER'
    | 'OFFSCREEN_SIGNAL_ICE_CANDIDATE'
    | 'OFFSCREEN_NEW_PEER'
    | 'OFFSCREEN_SEND_DATA'
    | 'OFFSCREEN_DATA_RECEIVED'
    | 'OFFSCREEN_P2P_STATUS'
    | 'OFFSCREEN_TRIGGER_FALLBACK'
    // PeerJS 統一邀請碼與審核訊息
    | 'OFFSCREEN_PEER_CREATE_ROOM'
    | 'OFFSCREEN_PEER_JOIN_ROOM'
    | 'OFFSCREEN_APPROVE_JOIN_REQUEST'
    | 'OFFSCREEN_REJECT_JOIN_REQUEST'
    | 'OFFSCREEN_UPDATE_PERMISSION'
    | 'BG_P2P_GUEST_APPROVED'
    | 'GET_P2P_DIAGNOSTIC'
    | 'OFFSCREEN_GET_DIAGNOSTIC'
    // 相容性保留
    | 'BG_SERVERLESS_CREATE_OFFER'
    | 'BG_SERVERLESS_ACCEPT_OFFER'
    | 'BG_SERVERLESS_ACCEPT_ANSWER'
    | 'OFFSCREEN_SERVERLESS_CREATE_OFFER'
    | 'OFFSCREEN_SERVERLESS_ACCEPT_OFFER'
    | 'OFFSCREEN_SERVERLESS_ACCEPT_ANSWER';
  payload?: any;
}

export interface P2PLogEvent {
  timestamp: number;
  stage: 'INIT' | 'STUN_GATHER' | 'SIGNALING' | 'DATA_CHANNEL' | 'AUDIT' | 'CONNECTED' | 'RETRY' | 'DISCONNECTED' | 'ERROR';
  level: 'INFO' | 'WARN' | 'ERROR';
  event: string;
  details?: Record<string, any>;
}

export interface P2PDiagnosticData {
  version: string;
  roomId?: string;
  role?: 'HOST' | 'GUEST';
  status: P2PStatus;
  retryCount: number;
  candidatesSummary: { host: number; srflx: number; relay: number };
  recentLogs: P2PLogEvent[];
  markdownReport: string;
  githubIssueUrl: string;
}

/**
 * 解析影片唯一標識 (Video Identifier)
 * YouTube: 提取 v 參數 (如: yt:dQw4w9WgXcQ)
 * Bilibili: 提取 BV 號 (如: bili:BV1xx411c7mD)
 * Niconico: 提取 watch ID (如: nico:sm9, nico:so43652101)
 * Anime1.me: 提取單集或分類路徑 (如: anime1:12345)
 */
export function getVideoIdentifier(rawUrl?: string): string | null {
  if (!rawUrl) return null;
  try {
    const url = new URL(rawUrl);

    // 1. YouTube 影片辨識
    if (url.hostname.includes('youtube.com')) {
      const v = url.searchParams.get('v');
      if (v) return `yt:${v}`;
      if (url.pathname.startsWith('/embed/')) {
        const id = url.pathname.split('/')[2];
        if (id) return `yt:${id}`;
      }
    }
    if (url.hostname.includes('youtu.be')) {
      const id = url.pathname.slice(1).split('?')[0];
      if (id) return `yt:${id}`;
    }

    // 2. Bilibili 影片辨識 (支援單影片 BV、分 P 參數 ?p= 以及番劇 ep/ss)
    if (url.hostname.includes('bilibili.com')) {
      const match = url.pathname.match(/\/(BV[a-zA-Z0-9]+)/i);
      if (match && match[1]) {
        const p = url.searchParams.get('p');
        return p && p !== '1' ? `bili:${match[1]}?p=${p}` : `bili:${match[1]}`;
      }
      const epMatch = url.pathname.match(/\/bangumi\/play\/(ep[0-9]+|ss[0-9]+)/i);
      if (epMatch && epMatch[1]) {
        return `bili:${epMatch[1]}`;
      }
    }

    // 3. Niconico 影片辨識 (如: sm9, so43652101, nm12345, 純數字頻道影片 ID)
    if (url.hostname.includes('nicovideo.jp')) {
      const match = url.pathname.match(/\/watch\/([a-zA-Z0-9]+)/);
      if (match && match[1]) {
        return `nico:${match[1]}`;
      }
    }

    // 4. Anime1.me 影片辨識 (單集頁 /12345 或番劇分類頁 /category/...)
    if (url.hostname.includes('anime1.me')) {
      const cleanPath = decodeURIComponent(url.pathname).replace(/^\/+|\/+$/g, '');
      if (cleanPath) {
        return `anime1:${cleanPath}`;
      }
    }

    // 5. Netflix 影片辨識 (如: /watch/80057281)
    if (url.hostname.includes('netflix.com')) {
      const match = url.pathname.match(/\/watch\/([0-9]+)/);
      if (match && match[1]) {
        return `netflix:${match[1]}`;
      }
    }

    // 其它網址以去除 query/hash 之 pathname 為識別
    return `${url.origin}${url.pathname}`;
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
