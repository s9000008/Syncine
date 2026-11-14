/**
 * Syncine 後端通訊協定與共用工具轉匯出（對齊 shared/protocol.ts 與 shared/platforms.ts）
 */
import { HOST_WHITELIST } from './shared/platforms';

export const SERVER_HOST_WHITELIST: RegExp[] = HOST_WHITELIST;

export {
  type ConnectionMode,
  type DetectedShareCodeType,
  type ParsedConnectionInfo,
  type P2PStatus,
  type SyncineEvent,
  type CoViewEvent,
  type SyncData,
  type JoinRequest,
  type ConnectionStatus,
  type RoomStateInfo,
  type RoomMember,
  type RoomState,
  type CreateRoomReq,
  type CreateRoomRes,
  type JoinRoomReq,
  type JoinRoomRes,
  type SyncStateMsg,
  type RedirectRoomMsg,
  type TogglePermissionMsg,
  type P2PDataMessage,
  validateSyncData,
  getVideoIdentifier,
  getCanonicalVideoUrl,
  isSameVideoOrWebsite
} from './shared/protocol';

export {
  isPrivateOrInternalHost,
  isUniversalSupportedUrl,
  isPlatformPermitted,
  isServerUrlAllowed
} from './shared/platforms';
