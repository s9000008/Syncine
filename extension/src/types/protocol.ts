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
  playbackRate?: number;
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
    | 'BG_REQUEST_INIT_SYNC'
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

    // 1. YouTube 影片辨識
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

    // 2. Bilibili 影片辨識 (支援單影片 BV/av、清單 ?bvid=、分 P 參數 ?p= 以及番劇 ep/ss)
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

    // 3. Niconico 影片辨識 (如: sm9, so43652101, nm12345, 純數字頻道影片 ID)
    if (url.hostname.includes('nicovideo.jp')) {
      const match = url.pathname.match(/\/watch\/([a-zA-Z0-9]+)/);
      if (match && match[1]) {
        return `nico:${match[1]}`;
      }
    }

    // 4. Anime1.me 影片辨識 (單集頁 /12345、番劇分類頁 /category/... 或 ?cat=1234)
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

    // 5. Netflix 影片辨識 (如: /watch/80057281)
    if (url.hostname.includes('netflix.com')) {
      const match = url.pathname.match(/\/watch\/([0-9]+)/);
      if (match && match[1]) {
        return `netflix:${match[1]}`;
      }
    }

    // 6. Vimeo 影片辨識 (優先提取 /video/<id> 以相容 showcase/.../video/<id> 與 player.vimeo.com)
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

    // 7. 巴哈姆特動畫瘋 (如: ani.gamer.com.tw/animeVideo.php?sn=38210)
    if (url.hostname.includes('gamer.com.tw')) {
      const sn = url.searchParams.get('sn');
      if (sn) {
        return `gamer:${sn}`;
      }
    }

    // 8. Twitch (VOD / Clip / Channel)
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

    // 9. Disney+ (如: /video/4b045e77... 或 /play/...)
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

    // 10. Prime Video / Amazon (如: primevideo.com/detail/0STG2N4Y... 或 /watch?gti=...)
    if (url.hostname.includes('primevideo.com') || url.hostname.includes('amazon.com')) {
      const primeId = extractPrimeVideoId(url);
      if (primeId) {
        return `prime:${primeId}`;
      }
    }

    // 11. MyVideo (如: myvideo.net.tw/details/0/123456 或 /player/123456)
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

    // 12. LINE TV (如: linetv.tw/drama/12345/eps/1 或 /en/drama/12345)
    if (url.hostname.includes('linetv.tw')) {
      const dramaMatch = url.pathname.match(/\/drama\/([0-9]+)(?:\/eps\/([0-9]+))?/);
      if (dramaMatch && dramaMatch[1]) {
        return dramaMatch[2] ? `linetv:${dramaMatch[1]}:${dramaMatch[2]}` : `linetv:${dramaMatch[1]}`;
      }
    }

    // 13. KKTV (如: kktv.me/play/01000187010001)
    if (url.hostname.includes('kktv.me')) {
      const match = url.pathname.match(/\/play\/([a-zA-Z0-9]+)/);
      if (match && match[1]) {
        return `kktv:${match[1]}`;
      }
    }

    // 14. Crunchyroll (如: crunchyroll.com/watch/GRDQ09WPY/the-day-it-began 或 /watch/GRDQ09WPY)
    if (url.hostname.includes('crunchyroll.com')) {
      const match = url.pathname.match(/\/watch\/([a-zA-Z0-9]+)/);
      if (match && match[1]) {
        return `crunchyroll:${match[1]}`;
      }
    }

    // 15. 遠傳 friDay 影音 (如: video.friday.tw/drama/detail/12345, /sn/12345, 或 /player)
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

    // 16. Max / HBO Max (如: play.max.com/video/watch/UUID, /player/UUID, /sport/watch/UUID)
    if (url.hostname.includes('max.com') || url.hostname.includes('hbomax.com')) {
      const match = url.pathname.match(/\/(?:video\/watch|player|watch)\/([a-zA-Z0-9_-]+)/);
      if (match && match[1]) {
        return `max:${match[1]}`;
      }
    }

    // 17. 愛奇藝 iQIYI (如: iq.com/play/UUID 或 iqiyi.com/v_12345.html / a_12345.html)
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

    // 18. Apple TV+ (如: tv.apple.com/.../episode/.../umc.cmc.4u280a... 或 /movie/.../umc.cmc....)
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

    // 19. CATCHPLAY+ (如: catchplay.com/tw/watch/ed8c3d70... 或 /watch/abc?ep=3)
    if (url.hostname.includes('catchplay.com')) {
      const match = url.pathname.match(/\/(?:watch|play|video)\/([a-zA-Z0-9_-]+)/);
      if (match && match[1]) {
        const ep = url.searchParams.get('ep') || url.searchParams.get('episode');
        return ep ? `catchplay:${match[1]}?ep=${ep}` : `catchplay:${match[1]}`;
      }
    }

    // 其它網址保留非追蹤型業務查詢參數 (如 ?id=, ?ep=) 作為唯一識別
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

    // 3. Bilibili: 僅保留純淨 /video/BV|av... 或 /bangumi/play/ep... (支援清單 ?bvid= 與分 P 參數 ?p=)
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

    // 9. Disney+: 保留實際路由 (/play/<id> 或 /video/<id>) 與 /series/<slug>/<id>，剔除語系前綴與追蹤參數
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

    // 10. Prime Video / Amazon: 精確保留 GTI/ASIN，避免被後方長 ref= 路徑段覆蓋
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

    // 16. Max: 保留純淨播放路徑 (支援 /video/watch, /player, /sport/watch 等)
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

    // 18. Apple TV+: 保留原始播放路徑 (/episode/..., /movie/..., /tw/movie/...) 並剝離追蹤查詢參數，避免電影被改寫為 /episode/ 造成 404
    if (host.includes('tv.apple.com')) {
      const cleanPath = url.pathname.replace(/\/+$/, '');
      if (cleanPath && cleanPath !== '/') {
        return `https://tv.apple.com${cleanPath}`;
      }
    }

    // 19. CATCHPLAY+: 保留標準 /watch/<id> 並保留分集參數 (?ep=)
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
  } catch (e) {
    return rawUrl.trim();
  }
}

/**
 * 比較兩組網址是否對應至同一個影片或頁面
 * 廣泛相容於原網址比對、影片唯一識別碼 (getVideoIdentifier) 以及純淨標準網址 (getCanonicalVideoUrl)
 */
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
