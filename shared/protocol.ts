/**
 * Syncine 前後端共用通訊協定、網址標準化與執行期 Payload 驗證 (Single Source of Truth)
 */

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
  | 'REQUEST_INIT_SYNC'
  | 'SYNC_STATE'
  | 'REDIRECT_ROOM'
  | 'TOGGLE_PERMISSION'
  | 'GET_ROOM_MEMBER_COUNT'
  | 'MEMBER_COUNT_UPDATED'
  | 'HOST_CHANGED'
  | 'HOST_PRIVILEGE_GRANTED'
  | 'ERROR';

export type CoViewEvent = SyncineEvent;

export interface SyncData {
  action: 'PLAY' | 'PAUSE' | 'SEEK' | 'HEARTBEAT';
  currentTime: number;
  timestamp: number;
  paused?: boolean;
  playbackRate?: number;
  videoUrl?: string;
}

export interface JoinRequest {
  requestId: string;
  guestName: string;
  guestShortId?: string;
  timestamp: number;
}

export type ConnectionStatus = 'CONNECTED' | 'RECONNECTING' | 'DISCONNECTED';

export interface PlaybackConflictEvent {
  timestamp: number;
  type: 'GUEST_ROLLBACK_BURST' | 'UNPROMPTED_STATE_FLIP' | 'CIRCUIT_BREAKER_ENGAGED';
  platformId: string;
  hostname: string; // 僅記錄純網域 (剝除 path/query/hash，零敏感網址與參數)
  expectedState: 'PLAYING' | 'PAUSED' | 'IDLE';
  observedAction: 'PLAY' | 'PAUSE' | 'SEEK';
  deltaMs: number;
  hadRecentUserInput: boolean;
}

export interface PlaybackConflictState {
  detected: boolean;
  dismissed?: boolean;
  platformId: string;
  hostname: string;
  reversalCount: number;
  circuitBreakerActive: boolean;
  lastDetectedAt: number;
  recentEvents?: PlaybackConflictEvent[];
}

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
  compositeCode?: string;
  pendingJoinRequests?: JoinRequest[];
  guestAwaitingApproval?: boolean;
  resumeToken?: string;
  playbackConflict?: PlaybackConflictState;
}

// ====================================================
// 後端房間狀態型別與 Socket 通訊信令結構
// ====================================================

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
  hostResumeToken: string;
  hostLanguage?: string;
  currentUrl: string;
  allowGuestControl: boolean;
  isSelfHosted: boolean;
  mode: ConnectionMode;
  members: Map<string, RoomMember>;
  hostDisconnectTimer?: ReturnType<typeof setTimeout>;
  emptyRoomTimer?: ReturnType<typeof setTimeout>;
}

export interface CreateRoomReq {
  event?: 'CREATE_ROOM';
  data: {
    userId: string;
    currentUrl: string;
    isSelfHosted?: boolean;
    mode?: ConnectionMode;
    allowUniversal?: boolean;
    language?: string;
  };
}

export interface CreateRoomRes {
  event: 'CREATE_ROOM_SUCCESS';
  roomId: string;
  data: {
    allowGuestControl: boolean;
    mode: ConnectionMode;
    resumeToken: string;
  };
}

export interface JoinRoomReq {
  event?: 'JOIN_ROOM';
  roomId: string;
  data: {
    userId: string;
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
    mode: ConnectionMode;
    hostSocketId: string;
    resumeToken?: string;
  };
}

export interface SyncStateMsg {
  event?: 'SYNC_STATE';
  roomId: string;
  targetGuestSocketId?: string;
  data: SyncData;
}

export interface RedirectRoomMsg {
  event?: 'REDIRECT_ROOM';
  roomId: string;
  data: {
    targetUrl: string;
    allowUniversal?: boolean;
  };
}

export interface TogglePermissionMsg {
  event?: 'TOGGLE_PERMISSION';
  roomId: string;
  data: {
    allowGuestControl: boolean;
  };
}

export type P2PDataMessage =
  | { type: 'JOIN_REQUEST'; guestName: string; timestamp?: number }
  | { type: 'JOIN_APPROVED'; roomId: string; currentUrl: string; allowGuestControl: boolean; memberCount: number }
  | { type: 'JOIN_REJECTED'; reason: string }
  | { type: 'REQUEST_INIT_SYNC' }
  | { type: 'REQUEST_CURRENT_STATE' }
  | { type: 'SYNC_STATE'; data: SyncData }
  | { type: 'REDIRECT_ROOM'; targetUrl: string }
  | { type: 'TOGGLE_PERMISSION'; allowGuestControl: boolean }
  | { type: 'MEMBER_COUNT_UPDATE'; count: number };

// Content Script <-> Background <-> Offscreen 通訊 payload（已清理廢棄 serverless/old-P2P 訊息）
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
    | 'BG_REQUEST_INIT_SYNC'
    | 'CS_SYNC_RECEIVED'
    | 'CS_REDIRECT_RECEIVED'
    | 'CS_PERMISSION_UPDATED'
    | 'CS_ROOM_STATE_CHANGED'
    | 'CS_REQUEST_CURRENT_STATE'
    | 'CS_JOIN_REQUESTS_UPDATED'
    | 'CS_CONNECTION_STATUS_CHANGED'
    | 'CS_PING'
    | 'CS_ACTIVATE_UNIVERSAL'
    | 'GET_ROOM_STATE'
    // Offscreen WebRTC PeerJS 統一邀請碼與審核訊息
    | 'OFFSCREEN_CLOSE_P2P'
    | 'OFFSCREEN_SEND_DATA'
    | 'OFFSCREEN_DATA_RECEIVED'
    | 'OFFSCREEN_P2P_STATUS'
    | 'OFFSCREEN_PEER_CREATE_ROOM'
    | 'OFFSCREEN_PEER_JOIN_ROOM'
    | 'OFFSCREEN_APPROVE_JOIN_REQUEST'
    | 'OFFSCREEN_REJECT_JOIN_REQUEST'
    | 'OFFSCREEN_UPDATE_PERMISSION'
    | 'BG_P2P_GUEST_APPROVED'
    | 'GET_P2P_DIAGNOSTIC'
    | 'GET_DIAGNOSTIC_REPORT'
    | 'BG_PLAYBACK_CONFLICT_DETECTED'
    | 'BG_DISMISS_PLAYBACK_CONFLICT'
    | 'OFFSCREEN_GET_DIAGNOSTIC';
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

// ====================================================
// 執行期嚴格 Payload 驗證 (Schema & Role Hardening)
// ====================================================

const ALLOWED_SYNC_ACTIONS = new Set(['PLAY', 'PAUSE', 'SEEK', 'HEARTBEAT']);

/**
 * 嚴格驗證與重建 SYNC_STATE 資料酬載，防範畸形數值、未定義欄位透傳與 Guest 偽造 HEARTBEAT
 */
export function validateSyncData(raw: unknown, isHost: boolean): SyncData | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  if (typeof obj.action !== 'string' || !ALLOWED_SYNC_ACTIONS.has(obj.action)) {
    return null;
  }
  const action = obj.action as SyncData['action'];

  // 權限角色隔離：只有房主可以廣播 HEARTBEAT 心跳
  if (action === 'HEARTBEAT' && !isHost) {
    return null;
  }

  if (typeof obj.currentTime !== 'number' || !Number.isFinite(obj.currentTime) || obj.currentTime < 0 || obj.currentTime > 86400 * 7) {
    return null;
  }

  if (typeof obj.timestamp !== 'number' || !Number.isFinite(obj.timestamp) || obj.timestamp <= 0) {
    return null;
  }

  const clean: SyncData = {
    action,
    currentTime: obj.currentTime,
    timestamp: obj.timestamp
  };

  if (obj.paused !== undefined) {
    if (typeof obj.paused !== 'boolean') return null;
    clean.paused = obj.paused;
  }

  if (obj.playbackRate !== undefined) {
    if (
      typeof obj.playbackRate !== 'number' ||
      !Number.isFinite(obj.playbackRate) ||
      obj.playbackRate < 0.25 ||
      obj.playbackRate > 4.0
    ) {
      return null;
    }
    clean.playbackRate = obj.playbackRate;
  }

  if (obj.videoUrl !== undefined) {
    if (
      typeof obj.videoUrl === 'string' &&
      obj.videoUrl.length > 0 &&
      obj.videoUrl.length <= 512 &&
      /^https?:\/\//i.test(obj.videoUrl)
    ) {
      clean.videoUrl = getCanonicalVideoUrl(obj.videoUrl);
    }
  }

  return clean;
}

// ====================================================
// 跨平台影片識別碼與標準網址清理工具 (Single Source of Truth)
// ====================================================

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
      if (match && match[1]) {
        return `nico:${match[1]}`;
      }
    }

    if (url.hostname.includes('anime1.me')) {
      const cleanPath = decodeURIComponent(url.pathname).replace(/^\/+|\/+$/g, '');
      if (cleanPath) {
        return `anime1:${cleanPath}`;
      }
      const cat = url.searchParams.get('cat');
      if (cat) {
        const paged = url.searchParams.get('paged') || url.searchParams.get('page');
        return paged && paged !== '1' ? `anime1:cat:${cat}:p${paged}` : `anime1:cat:${cat}`;
      }
    }

    if (url.hostname.includes('netflix.com')) {
      const match = url.pathname.match(/\/watch\/([0-9]+)/);
      if (match && match[1]) {
        return `netflix:${match[1]}`;
      }
    }

    if (url.hostname.includes('vimeo.com')) {
      const videoSubMatch = url.pathname.match(/\/video\/([0-9]{4,})/);
      if (videoSubMatch && videoSubMatch[1]) {
        return `vimeo:${videoSubMatch[1]}`;
      }
      const match = url.pathname.match(/\/([0-9]{5,})/);
      if (match && match[1]) {
        return `vimeo:${match[1]}`;
      }
    }

    if (url.hostname.includes('gamer.com.tw')) {
      const sn = url.searchParams.get('sn');
      if (sn) {
        return `gamer:${sn}`;
      }
    }

    if (url.hostname.includes('twitch.tv')) {
      const vodMatch = url.pathname.match(/\/videos\/([0-9]+)/);
      if (vodMatch && vodMatch[1]) {
        return `twitch:video:${vodMatch[1]}`;
      }
      if (url.hostname.includes('clips.twitch.tv')) {
        const clipId = url.pathname.slice(1).split('/')[0];
        if (clipId) return `twitch:clip:${clipId}`;
      }
      const clipMatch = url.pathname.match(/\/clip\/([a-zA-Z0-9_-]+)/);
      if (clipMatch && clipMatch[1]) {
        return `twitch:clip:${clipMatch[1]}`;
      }
      const channelMatch = url.pathname.match(/^\/([a-zA-Z0-9_]{3,25})\/?$/);
      if (channelMatch && channelMatch[1] && !['directory', 'p', 'settings', 'search', 'videos'].includes(channelMatch[1].toLowerCase())) {
        return `twitch:channel:${channelMatch[1].toLowerCase()}`;
      }
    }

    if (url.hostname.includes('disneyplus.com')) {
      const match = url.pathname.match(/\/(?:video|play)\/([a-zA-Z0-9_-]+)/);
      if (match && match[1]) {
        return `disney:${match[1]}`;
      }
      const seriesMatch = url.pathname.match(/\/series\/[^\/]+\/([a-zA-Z0-9_-]+)/);
      if (seriesMatch && seriesMatch[1]) {
        return `disney:series:${seriesMatch[1]}`;
      }
    }

    if (url.hostname.includes('primevideo.com') || url.hostname.includes('amazon.com')) {
      const primeId = extractPrimeVideoId(url);
      if (primeId) {
        return `prime:${primeId}`;
      }
    }

    if (url.hostname.includes('myvideo.net.tw')) {
      const detailsMatch = url.pathname.match(/\/details\/([0-9]+)\/([0-9]+)/);
      if (detailsMatch && detailsMatch[1] && detailsMatch[2]) {
        return `myvideo:${detailsMatch[1]}:${detailsMatch[2]}`;
      }
      const playerMatch = url.pathname.match(/\/player\/([0-9]+)/);
      if (playerMatch && playerMatch[1]) {
        return `myvideo:player:${playerMatch[1]}`;
      }
    }

    if (url.hostname.includes('linetv.tw')) {
      const dramaMatch = url.pathname.match(/\/drama\/([0-9]+)(?:\/eps\/([0-9]+))?/);
      if (dramaMatch && dramaMatch[1]) {
        return dramaMatch[2] ? `linetv:${dramaMatch[1]}:${dramaMatch[2]}` : `linetv:${dramaMatch[1]}`;
      }
    }

    if (url.hostname.includes('kktv.me')) {
      const match = url.pathname.match(/\/play\/([a-zA-Z0-9]+)/);
      if (match && match[1]) {
        return `kktv:${match[1]}`;
      }
    }

    if (url.hostname.includes('crunchyroll.com')) {
      const match = url.pathname.match(/\/watch\/([a-zA-Z0-9]+)/);
      if (match && match[1]) {
        return `crunchyroll:${match[1]}`;
      }
    }

    if (url.hostname.includes('friday.tw')) {
      const match = url.pathname.match(/\/(drama|movie|anime|show|detail|sn)\/(?:detail\/)?([0-9]+)/);
      if (match && match[2]) {
        const type = match[1];
        const id = match[2];
        const ep = url.searchParams.get('episode');
        return ep ? `friday:${type}:${id}?episode=${ep}` : `friday:${type}:${id}`;
      }
      if (url.pathname.includes('/player')) {
        const pid = url.searchParams.get('id') || url.searchParams.get('contentId') || url.searchParams.get('streamingId');
        const ep = url.searchParams.get('episode');
        if (pid) return ep ? `friday:player:${pid}?episode=${ep}` : `friday:player:${pid}`;
      }
    }

    if (url.hostname.includes('max.com') || url.hostname.includes('hbomax.com')) {
      const match = url.pathname.match(/\/(?:video\/watch|player|watch)\/([a-zA-Z0-9_-]+)/);
      if (match && match[1]) {
        return `max:${match[1]}`;
      }
    }

    if (url.hostname.includes('iq.com')) {
      const match = url.pathname.match(/\/play\/([a-zA-Z0-9_-]+)/);
      if (match && match[1]) {
        return `iqiyi:${match[1]}`;
      }
    }
    if (url.hostname.includes('iqiyi.com')) {
      const match = url.pathname.match(/\/[va]_([a-zA-Z0-9]+)\.html/);
      if (match && match[1]) {
        return `iqiyi:${match[1]}`;
      }
    }

    if (url.hostname.includes('tv.apple.com')) {
      const umcMatch = url.pathname.match(/(umc\.cmc\.[a-zA-Z0-9]+)/i);
      if (umcMatch && umcMatch[1]) {
        return `appletv:${umcMatch[1].toLowerCase()}`;
      }
      const epMatch = url.pathname.match(/\/(?:episode|movie|show|sport)\/(?:[^\/]+\/)?([a-zA-Z0-9._-]+)/);
      if (epMatch && epMatch[1]) {
        return `appletv:${epMatch[1]}`;
      }
    }

    if (url.hostname.includes('catchplay.com')) {
      const match = url.pathname.match(/\/(?:watch|play|video)\/([a-zA-Z0-9_-]+)/);
      if (match && match[1]) {
        const ep = url.searchParams.get('ep') || url.searchParams.get('episode');
        return ep ? `catchplay:${match[1]}?ep=${ep}` : `catchplay:${match[1]}`;
      }
    }

    return buildCleanGenericUrl(url);
  } catch {
    return null;
  }
}

export function getCanonicalVideoUrl(rawUrl?: string): string {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  try {
    const url = new URL(rawUrl.trim());
    const host = url.hostname.toLowerCase();

    if (host.includes('netflix.com')) {
      const match = url.pathname.match(/\/watch\/([0-9]+)/);
      if (match && match[1]) {
        return `https://www.netflix.com/watch/${match[1]}`;
      }
    }

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

    if (host.includes('nicovideo.jp')) {
      const match = url.pathname.match(/\/watch\/([a-zA-Z0-9]+)/);
      if (match && match[1]) {
        return `https://www.nicovideo.jp/watch/${match[1]}`;
      }
    }

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

    if (host.includes('gamer.com.tw')) {
      const sn = url.searchParams.get('sn');
      if (sn) {
        return `https://ani.gamer.com.tw/animeVideo.php?sn=${sn}`;
      }
    }

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

    if (host.includes('primevideo.com') || host.includes('amazon.com')) {
      const primeId = extractPrimeVideoId(url);
      if (primeId) {
        if (host.includes('amazon.com') && url.pathname.includes('/gp/video/detail/')) {
          return `https://www.amazon.com/gp/video/detail/${primeId}`;
        }
        return `https://www.primevideo.com/detail/${primeId}`;
      }
    }

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

    if (host.includes('linetv.tw')) {
      const dramaMatch = url.pathname.match(/\/drama\/([0-9]+)(?:\/eps\/([0-9]+))?/);
      if (dramaMatch && dramaMatch[1]) {
        return dramaMatch[2]
          ? `https://www.linetv.tw/drama/${dramaMatch[1]}/eps/${dramaMatch[2]}`
          : `https://www.linetv.tw/drama/${dramaMatch[1]}`;
      }
    }

    if (host.includes('kktv.me')) {
      const match = url.pathname.match(/\/play\/([a-zA-Z0-9]+)/);
      if (match && match[1]) {
        return `https://www.kktv.me/play/${match[1]}`;
      }
    }

    if (host.includes('crunchyroll.com')) {
      const match = url.pathname.match(/\/watch\/([a-zA-Z0-9]+)/);
      if (match && match[1]) {
        return `https://www.crunchyroll.com/watch/${match[1]}`;
      }
    }

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

    if (host.includes('tv.apple.com')) {
      const cleanPath = url.pathname.replace(/\/+$/, '');
      if (cleanPath && cleanPath !== '/') {
        return `https://tv.apple.com${cleanPath}`;
      }
    }

    if (host.includes('catchplay.com')) {
      const match = url.pathname.match(/\/(watch|play|video)\/([a-zA-Z0-9_-]+)/);
      if (match && match[1] && match[2]) {
        const ep = url.searchParams.get('ep') || url.searchParams.get('episode');
        return ep
          ? `https://www.catchplay.com/${match[1]}/${match[2]}?ep=${encodeURIComponent(ep)}`
          : `https://www.catchplay.com/${match[1]}/${match[2]}`;
      }
    }

    return buildCleanGenericUrl(url);
  } catch {
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

const KNOWN_VIDEO_PLATFORM_DOMAINS = [
  'youtube.com',
  'youtu.be',
  'netflix.com',
  'bilibili.com',
  'nicovideo.jp',
  'vimeo.com',
  'gamer.com.tw',
  'twitch.tv',
  'disneyplus.com',
  'primevideo.com',
  'amazon.com',
  'myvideo.net.tw',
  'linetv.tw',
  'kktv.me',
  'crunchyroll.com',
  'friday.tw',
  'max.com',
  'hbomax.com',
  'iq.com',
  'iqiyi.com',
  'tv.apple.com',
  'catchplay.com'
];

/**
 * 判斷網址是否為「尚未鎖定具體影片」之平台首頁、搜尋頁或瀏覽目錄頁 (例如 https://www.youtube.com/ 或 https://www.netflix.com/browse)
 */
export function isNonVideoBrowsePage(rawUrl?: string): boolean {
  if (!rawUrl || !rawUrl.trim()) return true;
  const id = getVideoIdentifier(rawUrl);
  if (!id) return true;

  if (id.startsWith('http://') || id.startsWith('https://')) {
    try {
      const host = new URL(rawUrl.trim()).hostname.toLowerCase();
      if (KNOWN_VIDEO_PLATFORM_DOMAINS.some((p) => host.includes(p))) {
        return true;
      }
    } catch {
      return true;
    }
  }
  return false;
}
