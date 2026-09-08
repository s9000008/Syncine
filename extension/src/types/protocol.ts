export type ConnectionMode = 'DEFAULT' | 'CUSTOM_IP' | 'P2P';

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
    | 'BG_P2P_GUEST_APPROVED'
    // 相容性保留
    | 'BG_SERVERLESS_CREATE_OFFER'
    | 'BG_SERVERLESS_ACCEPT_OFFER'
    | 'BG_SERVERLESS_ACCEPT_ANSWER'
    | 'OFFSCREEN_SERVERLESS_CREATE_OFFER'
    | 'OFFSCREEN_SERVERLESS_ACCEPT_OFFER'
    | 'OFFSCREEN_SERVERLESS_ACCEPT_ANSWER';
  payload?: any;
}

/**
 * 解析影片唯一標識 (Video Identifier)
 * YouTube: 提取 v 參數 (如: yt:dQw4w9WgXcQ)
 * Bilibili: 提取 BV 號 (如: bili:BV1xx411c7mD)
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

    // 2. Bilibili 影片辨識
    if (url.hostname.includes('bilibili.com')) {
      const match = url.pathname.match(/\/(BV[a-zA-Z0-9]+)/i);
      if (match && match[1]) {
        return `bili:${match[1]}`;
      }
    }

    // 其它網址以去除 query/hash 之 pathname 為識別
    return `${url.origin}${url.pathname}`;
  } catch (e) {
    return null;
  }
}
