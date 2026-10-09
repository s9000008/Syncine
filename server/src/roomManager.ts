import crypto from 'crypto';
import { RoomState, RoomMember, ConnectionMode } from './types';
import { sanitizeLog } from './utils';

export const MAX_ROOM_MEMBERS = 100;

export class RoomManager {
  private rooms: Map<string, RoomState> = new Map();
  private socketToRoom: Map<string, string> = new Map();
  private onHostTimeoutCallback?: (room: RoomState) => void;

  /**
   * 設定房主逾時轉移時的回呼函式
   */
  public setHostTimeoutCallback(cb: (room: RoomState) => void) {
    this.onHostTimeoutCallback = cb;
  }

  /**
   * 產生 6 碼大寫英數字 Room ID (使用密碼學安全隨機亂數)
   */
  private generateRoomId(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    do {
      result = '';
      for (let i = 0; i < 6; i++) {
        result += chars.charAt(crypto.randomInt(0, chars.length));
      }
    } while (this.rooms.has(result));
    return result;
  }

  /**
   * 簽發不可預測之 48 位元 hex 房主身分安全憑證
   */
  public generateResumeToken(): string {
    return crypto.randomBytes(24).toString('hex');
  }

  /**
   * 建立新房間
   */
  public createRoom(
    socketId: string,
    userId: string,
    currentUrl: string,
    isSelfHosted: boolean,
    mode: ConnectionMode = 'DEFAULT',
    hostLanguage?: string
  ): RoomState {
    const roomId = this.generateRoomId();
    const hostResumeToken = this.generateResumeToken();
    const hostMember: RoomMember = {
      socketId,
      userId,
      isHost: true,
      joinedAt: Date.now()
    };

    const room: RoomState = {
      roomId,
      hostSocketId: socketId,
      hostUserId: userId,
      hostResumeToken,
      hostLanguage,
      currentUrl,
      allowGuestControl: false,
      isSelfHosted,
      mode,
      members: new Map([[socketId, hostMember]])
    };

    this.rooms.set(roomId, room);
    this.socketToRoom.set(socketId, roomId);

    const langStr = hostLanguage ? `語系: ${sanitizeLog(hostLanguage)}` : '語系: 未提供';
    console.log(`[RoomManager] 房間建立成功: ${sanitizeLog(roomId)} (Host: ${sanitizeLog(userId)}, Socket: ${sanitizeLog(socketId)}, ${langStr})`);
    return room;
  }

  /**
   * 觀眾加入或斷線回魂加入房間
   */
  public joinRoom(
    roomId: string,
    socketId: string,
    userId: string,
    resumeToken?: string
  ): { success: boolean; room?: RoomState; error?: string; code?: string; isHost?: boolean } {
    const room = this.rooms.get(roomId.toUpperCase());
    if (!room) {
      return { success: false, error: '房間不存在或已關閉', code: 'ERR_ROOM_NOT_FOUND' };
    }

    // 檢查是否為合法持有效 Token 之 Host 重連回魂
    const isAuthenticHost = Boolean(
      room.hostResumeToken &&
      resumeToken &&
      resumeToken === room.hostResumeToken
    );

    // 檢查房間人數上限 (上限 100 人，若為原房成員或合法房主重連回魂則不受限制)
    const isExistingMember = room.members.has(socketId) || isAuthenticHost;
    if (!isExistingMember && room.members.size >= MAX_ROOM_MEMBERS) {
      console.warn(`[RoomManager] 房間 ${sanitizeLog(room.roomId)} 已達人數上限 (${MAX_ROOM_MEMBERS} 人)，拒絕新成員加入: ${sanitizeLog(userId)}`);
      return { success: false, error: '房間已滿員，無法加入。', code: 'ERR_ROOM_FULL' };
    }

    // 若房間正在處於全空 60 秒寬限倒數，有成員重連進來時立即解除倒數
    if (room.emptyRoomTimer) {
      clearTimeout(room.emptyRoomTimer);
      room.emptyRoomTimer = undefined;
      console.log(`[RoomManager] 成員回歸房間 ${sanitizeLog(room.roomId)}，取消空房銷毀倒數`);
    }

    // P1 防劫持：只有持有效 resumeToken 者方可申領/恢復 Host 身分
    if (isAuthenticHost) {
      if (room.hostDisconnectTimer) {
        clearTimeout(room.hostDisconnectTimer);
        room.hostDisconnectTimer = undefined;
        console.log(`[RoomManager] 房主驗證憑證成功，取消離線倒數並恢復房主身分: ${sanitizeLog(room.roomId)}`);
      }
      room.hostSocketId = socketId;
      room.hostUserId = userId;
    } else if (userId === room.hostUserId && !isAuthenticHost) {
      console.warn(`[Security Alert] 偵測到未持有效憑證之使用者 ${sanitizeLog(userId)} 嘗試以房主 ID 入房，強制降級為普通觀眾`);
      if (!room.members.has(room.hostSocketId) && !room.hostDisconnectTimer) {
        this.startHostDisconnectTimer(room);
      }
    } else if (!room.members.has(room.hostSocketId) && !room.hostDisconnectTimer) {
      // 若原房主不在線且尚未啟動 30 秒替換計時器，啟動 30 秒倒數準備提升 Guest 為 Host
      this.startHostDisconnectTimer(room);
    }

    const isHost = isAuthenticHost;
    const member: RoomMember = {
      socketId,
      userId,
      isHost,
      joinedAt: Date.now()
    };

    room.members.set(socketId, member);
    this.socketToRoom.set(socketId, room.roomId);

    console.log(`[RoomManager] 使用者 ${sanitizeLog(userId)} (${isHost ? 'Host' : 'Guest'}) 加入房間 ${sanitizeLog(room.roomId)} (當前人數: ${room.members.size})`);
    return { success: true, room, isHost };
  }

  /**
   * 取得特定 Socket 所屬房間
   */
  public getRoomBySocketId(socketId: string): RoomState | undefined {
    const roomId = this.socketToRoom.get(socketId);
    if (!roomId) return undefined;
    return this.rooms.get(roomId);
  }

  /**
   * 取得特定 Room ID 之房間
   */
  public getRoom(roomId: string): RoomState | undefined {
    return this.rooms.get(roomId.toUpperCase());
  }

  /**
   * 切換房間權限 (僅 Host 可操作)
   */
  public togglePermission(
    socketId: string,
    allowGuestControl: boolean
  ): { success: boolean; room?: RoomState; error?: string } {
    const room = this.getRoomBySocketId(socketId);
    if (!room) return { success: false, error: '找不到對應房間' };

    if (room.hostSocketId !== socketId) {
      console.warn(`[RoomManager Security Warning] 非 Host 嘗試修改權限 (Socket: ${sanitizeLog(socketId)})`);
      return { success: false, error: '權限不足：僅房主可修改權限' };
    }

    room.allowGuestControl = allowGuestControl;
    console.log(`[RoomManager] 房間 ${sanitizeLog(room.roomId)} 權限更新: allowGuestControl = ${allowGuestControl}`);
    return { success: true, room };
  }

  /**
   * 驗證 Socket 是否具備操作權限 (Host 或允許 Guest 控制)
   */
  public canExecuteAction(socketId: string): boolean {
    const room = this.getRoomBySocketId(socketId);
    if (!room) return false;
    if (room.hostSocketId === socketId) return true;
    return room.allowGuestControl;
  }

  /**
   * 啟動房主離線 30 秒換人計時器
   */
  private startHostDisconnectTimer(room: RoomState) {
    if (room.hostDisconnectTimer) return;
    console.log(`[RoomManager] 房主離線，啟動 30 秒等待重新連線計時器: ${sanitizeLog(room.roomId)}`);
    room.hostDisconnectTimer = setTimeout(() => {
      const currentRoom = this.rooms.get(room.roomId);
      if (!currentRoom) return;

      currentRoom.hostDisconnectTimer = undefined;

      // 若 30 秒內 Host 沒重連，自動尋找最先加入的 Guest 提升為新 Host
      const remainingMembers = Array.from(currentRoom.members.values()).sort(
        (a, b) => a.joinedAt - b.joinedAt
      );

      if (remainingMembers.length > 0) {
        const newHost = remainingMembers[0];
        newHost.isHost = true;
        currentRoom.hostSocketId = newHost.socketId;
        currentRoom.hostUserId = newHost.userId;
        currentRoom.hostResumeToken = this.generateResumeToken();
        console.log(`[RoomManager] 30秒逾時！房間 ${sanitizeLog(room.roomId)} 新 Host 提升為: ${sanitizeLog(newHost.userId)} (已簽發新憑證)`);
        if (this.onHostTimeoutCallback) {
          this.onHostTimeoutCallback(currentRoom);
        }
      }
    }, 30000);
  }

  /**
   * 處理成員離線邏輯 (支援意外斷線的 60 秒保留寬限期，與主動退出的即時銷毀)
   */
  public handleDisconnect(
    socketId: string,
    onHostTimeout?: (room: RoomState) => void,
    isExplicitLeave = false
  ): { roomId?: string; isHost: boolean; roomClosed: boolean } {
    if (onHostTimeout) {
      this.onHostTimeoutCallback = onHostTimeout;
    }

    const roomId = this.socketToRoom.get(socketId);
    if (!roomId) return { isHost: false, roomClosed: false };

    const room = this.rooms.get(roomId);
    this.socketToRoom.delete(socketId);

    if (!room) return { roomId, isHost: false, roomClosed: false };

    const member = room.members.get(socketId);
    const isHost = member?.isHost || room.hostSocketId === socketId;
    room.members.delete(socketId);

    console.log(`[RoomManager] Socket ${sanitizeLog(socketId)} 離開房間 ${sanitizeLog(roomId)} (剩餘人數: ${room.members.size})`);

    // 處理全空狀態
    if (room.members.size === 0) {
      // 若為主動點選退出 (Explicit Leave)，直接立即清理
      if (isExplicitLeave) {
        if (room.hostDisconnectTimer) clearTimeout(room.hostDisconnectTimer);
        if (room.emptyRoomTimer) clearTimeout(room.emptyRoomTimer);
        this.rooms.delete(roomId);
        console.log(`[RoomManager] 房間 ${sanitizeLog(roomId)} 主動退出且無成員，立即銷毀`);
        return { roomId, isHost, roomClosed: true };
      }

      // 若為突發斷線 (網路抖動、伺服器重啟)，啟動 60 秒房間保留寬限期 (Grace Period)
      console.log(`[RoomManager] 房間 ${sanitizeLog(roomId)} 成員數為 0，啟動 60 秒保留寬限期 (Grace Period)`);
      if (room.hostDisconnectTimer) {
        clearTimeout(room.hostDisconnectTimer);
        room.hostDisconnectTimer = undefined;
      }
      if (room.emptyRoomTimer) {
        clearTimeout(room.emptyRoomTimer);
      }
      room.emptyRoomTimer = setTimeout(() => {
        const currentRoom = this.rooms.get(roomId);
        if (currentRoom && currentRoom.members.size === 0) {
          this.rooms.delete(roomId);
          console.log(`[RoomManager] 房間 ${sanitizeLog(roomId)} 60 秒寬限期結束且無成員重連，自動銷毀`);
        }
      }, 60000);

      return { roomId, isHost, roomClosed: false };
    }

    // 若房主離線且房內還有其他成員，啟動 30 秒換人倒數
    if (isHost) {
      this.startHostDisconnectTimer(room);
    }

    return { roomId, isHost, roomClosed: false };
  }
}
