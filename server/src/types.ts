export type ConnectionMode = 'DEFAULT' | 'CUSTOM_IP' | 'P2P';

// 伺服器端目標網址安全白名單 (縱深防禦：防範惡意 Host 廣播釣魚或偽協定網址)
export const SERVER_HOST_WHITELIST: RegExp[] = [
  /^https:\/\/www\.youtube\.com\/watch\?.*v=[a-zA-Z0-9_-]+/,
  /^https:\/\/www\.youtube\.com\/watch\?v=[a-zA-Z0-9_-]+/,
  /^https:\/\/www\.bilibili\.com\/video\/[a-zA-Z0-9]+/,
  /^https:\/\/www\.bilibili\.com\/bangumi\/play\/(ep|ss)[0-9]+/,
  /^https:\/\/www\.nicovideo\.jp\/watch\/[a-zA-Z0-9]+/,
  /^https:\/\/anime1\.me\/.+/
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

