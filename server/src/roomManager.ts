import { RoomState, RoomMember, ConnectionMode } from './types';
import { sanitizeLog } from './utils';

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
   * 產生 6 碼大寫英數字 Room ID
   */
  private generateRoomId(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    do {
      result = '';
      for (let i = 0; i < 6; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
      }
    } while (this.rooms.has(result));
    return result;
  }

  /**
   * 建立新房間
   */
  public createRoom(
    socketId: string,
    userId: string,
    currentUrl: string,
    isSelfHosted: boolean,
    mode: ConnectionMode = 'DEFAULT'
  ): RoomState {
    const roomId = this.generateRoomId();
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
      currentUrl,
      allowGuestControl: false,
      isSelfHosted,
      mode,
      members: new Map([[socketId, hostMember]])
    };

    this.rooms.set(roomId, room);
    this.socketToRoom.set(socketId, roomId);

    console.log(`[RoomManager] 房間建立成功: ${sanitizeLog(roomId)} (Host: ${sanitizeLog(userId)}, Socket: ${sanitizeLog(socketId)})`);
    return room;
  }

  /**
   * 觀眾加入或斷線回魂加入房間
   */
  public joinRoom(
    roomId: string,
    socketId: string,
    userId: string
  ): { success: boolean; room?: RoomState; error?: string } {
    const room = this.rooms.get(roomId.toUpperCase());
    if (!room) {
      return { success: false, error: '房間不存在或已關閉' };
    }

    // 若房間正在處於全空 60 秒寬限倒數，有成員重連進來時立即解除倒數
    if (room.emptyRoomTimer) {
      clearTimeout(room.emptyRoomTimer);
      room.emptyRoomTimer = undefined;
      console.log(`[RoomManager] 成員回歸房間 ${sanitizeLog(room.roomId)}，取消空房銷毀倒數`);
    }

    // 若為原 Host 重連，取消 Host 離線計時器並恢復 hostSocketId
    if (userId === room.hostUserId) {
      if (room.hostDisconnectTimer) {
        clearTimeout(room.hostDisconnectTimer);
        room.hostDisconnectTimer = undefined;
        console.log(`[RoomManager] 房主重連，取消離線倒數: ${sanitizeLog(room.roomId)}`);
      }
      room.hostSocketId = socketId;
    } else if (!room.members.has(room.hostSocketId) && !room.hostDisconnectTimer) {
      // 若原房主不在線且尚未啟動 30 秒替換計時器，啟動 30 秒倒數準備提升 Guest 為 Host
      this.startHostDisconnectTimer(room);
    }

    const isHost = userId === room.hostUserId;
    const member: RoomMember = {
      socketId,
      userId,
      isHost,
      joinedAt: Date.now()
    };

    room.members.set(socketId, member);
    this.socketToRoom.set(socketId, room.roomId);

    console.log(`[RoomManager] 使用者 ${sanitizeLog(userId)} (${isHost ? 'Host' : 'Guest'}) 加入房間 ${sanitizeLog(room.roomId)} (當前人數: ${room.members.size})`);
    return { success: true, room };
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
        console.log(`[RoomManager] 30秒逾時！房間 ${sanitizeLog(room.roomId)} 新 Host 提升為: ${sanitizeLog(newHost.userId)}`);
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
