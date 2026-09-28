import { Peer, DataConnection } from 'peerjs';
import { P2PStatus, ExtensionMessage, JoinRequest } from '../types/protocol';
import { getStandaloneText } from '../locales';

console.log('[Syncine Offscreen] WebRTC Offscreen Document (PeerJS Engine) 已啟動');

const PEER_CONFIG = {
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' }
    ],
    iceCandidatePoolSize: 10
  }
};

class PeerJSWebRTCManager {
  private role: 'HOST' | 'GUEST' | null = null;
  private roomId: string = '';
  private userId: string = '';
  private status: P2PStatus = 'DISCONNECTED';
  private peer: Peer | null = null;

  // 房主專屬：待審核入房申請佇列 (Key: conn.peer / requestId)
  private pendingRequests: Map<string, DataConnection> = new Map();
  // 房主專屬：已批准之成員 ID 集合 (防止 DataChannel 未開啟前發送遺失)
  private approvedRequestIds: Set<string> = new Set();
  // 房主專屬：已批准的活躍連線清單 (Key: conn.peer)
  private activeConnections: Map<string, DataConnection> = new Map();
  private hostCurrentUrl?: string;

  // 觀眾專屬：與房主的直連通道
  private guestConnection: DataConnection | null = null;
  private guestPollTimer?: ReturnType<typeof setInterval>;

  // 30 秒定期心跳檢測計時器 (全模式通用校準)
  private heartbeat30sTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.start30sHeartbeat();
  }

  // ----------------------------------------------------
  // 30 秒定期心跳與人數動態校準
  // ----------------------------------------------------
  private start30sHeartbeat() {
    if (this.heartbeat30sTimer) clearInterval(this.heartbeat30sTimer);
    this.heartbeat30sTimer = setInterval(() => {
      if (this.role === 'HOST') {
        // 1. 探測並剔除已關閉的非活躍連線
        this.activeConnections.forEach((conn, peerId) => {
          if (!conn.open) {
            console.log(`[Syncine 30s Heartbeat] 偵測到成員 ${peerId} 通道已失效，自動剔除`);
            try {
              conn.close();
            } catch (e) {}
            this.activeConnections.delete(peerId);
            this.approvedRequestIds.delete(peerId);
          }
        });

        const activeCount = this.getConnectedPeerCount();
        console.log(`[Syncine 30s Heartbeat] 房主發起全房人數校準，當前在線人數: ${activeCount} 人`);

        // 2. 廣播最新人數給所有在線觀眾
        this.activeConnections.forEach((conn) => {
          if (conn.open) {
            conn.send({
              type: 'MEMBER_COUNT_UPDATE',
              count: activeCount
            });
          }
        });

        // 3. 通知 Background 更新本機狀態
        this.updateStatus(this.status);
      }
    }, 30000);
  }

  private updateStatus(newStatus: P2PStatus) {
    this.status = newStatus;
    const peerCount = this.getConnectedPeerCount();
    chrome.runtime.sendMessage({
      type: 'OFFSCREEN_P2P_STATUS',
      payload: {
        status: this.status,
        peerCount
      }
    } as ExtensionMessage).catch(() => {});
  }

  public getConnectedPeerCount(): number {
    if (this.role === 'HOST') {
      let openCount = 1; // 房主本人
      this.activeConnections.forEach((conn) => {
        if (conn.open) openCount++;
      });
      return openCount;
    } else if (this.role === 'GUEST') {
      return this.guestConnection && this.guestConnection.open ? 2 : 1;
    }
    return 1;
  }

  // 通知 Background 待審核清單變更
  private notifyJoinRequestsChanged() {
    const list: JoinRequest[] = [];
    this.pendingRequests.forEach((conn, requestId) => {
      list.push({
        requestId,
        guestName: conn.metadata?.guestName || `訪客 (${requestId.slice(-4)})`,
        timestamp: conn.metadata?.timestamp || Date.now()
      });
    });

    chrome.runtime.sendMessage({
      type: 'CS_JOIN_REQUESTS_UPDATED',
      payload: { pendingRequests: list }
    } as ExtensionMessage).catch(() => {});
  }

  // ----------------------------------------------------
  // 1. 房主建房 (統一 6 碼邀請碼，可邀請多人，無人數上限)
  // ----------------------------------------------------
  public createRoom(userId: string): Promise<{ roomId: string }> {
    return new Promise((resolve, reject) => {
      this.close();
      this.userId = userId;
      this.role = 'HOST';

      // 產生 6 碼英數字代碼
      const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
      this.roomId = roomId;

      console.log(`[Syncine P2P Host] 正在向信令網路註冊房間 ID: ${roomId}...`);
      const peerId = `syncine-${roomId}`;
      const peer = new Peer(peerId, PEER_CONFIG);
      this.peer = peer;

      peer.on('open', (id) => {
        console.log(`[Syncine P2P Host] 🎉 房間建立成功！房間代碼: ${roomId} (PeerID: ${id})`);
        this.updateStatus('CONNECTED');
        resolve({ roomId });
      });

      peer.on('connection', (conn: DataConnection) => {
        const requestId = conn.peer;
        const guestName = conn.metadata?.guestName || `訪客 (${requestId.slice(-4)})`;
        console.log(`[Syncine P2P Host] 收到新成員入房申請: ${guestName} (${requestId})`);

        this.pendingRequests.set(requestId, conn);
        this.notifyJoinRequestsChanged();

        // 綁定連線狀態事件
        conn.on('open', () => {
          console.log(`[Syncine P2P Host] 與成員 ${requestId} 之 DataChannel 已成功 open (open=${conn.open})`);
          // 若房主已預先核准，立即補發核准訊息
          if (this.approvedRequestIds.has(requestId)) {
            this.sendApprovalSignal(conn, requestId);
          }
        });

        conn.on('data', (data: any) => {
          // 若觀眾端送來狀態查詢請求且房主已批准，立即回送批准
          if (data?.type === 'GUEST_POLL_APPROVAL') {
            if (this.approvedRequestIds.has(requestId)) {
              console.log(`[Syncine P2P Host] 收到成員 ${requestId} 之核准狀態查詢，回送 JOIN_APPROVED`);
              this.sendApprovalSignal(conn, requestId);
            }
          }
        });

        conn.on('close', () => {
          console.log(`[Syncine P2P Host] 成員連線關閉: ${requestId}`);
          this.pendingRequests.delete(requestId);
          this.activeConnections.delete(requestId);
          this.approvedRequestIds.delete(requestId);
          this.notifyJoinRequestsChanged();
          this.updateStatus(this.status);
        });

        conn.on('error', (err) => {
          console.error(`[Syncine P2P Host] 成員 ${requestId} 連線異常:`, err);
        });
      });

      peer.on('error', (err) => {
        console.error('[Syncine P2P Host] 信令伺服器錯誤:', err);
        if (err.type === 'unavailable-id') {
          this.createRoom(userId).then(resolve).catch(reject);
        } else {
          reject(new Error(err.message || '建立 P2P 房間失敗'));
        }
      });
    });
  }

  // 房主專屬：安全發送核准信號 (保證在通道 open 狀態下送達)
  private sendApprovalSignal(conn: DataConnection, requestId: string) {
    if (!conn.open) {
      console.warn(`[Syncine P2P Host] conn 尚未 open，暫緩發送核准信號: ${requestId}`);
      return;
    }
    try {
      conn.send({
        type: 'JOIN_APPROVED',
        hostCurrentUrl: this.hostCurrentUrl,
        memberCount: this.getConnectedPeerCount()
      });
      console.log(`[Syncine P2P Host] 🎉 成功送達 JOIN_APPROVED 給成員: ${requestId}`);
    } catch (e) {
      console.error('[Syncine P2P Host] 發送 JOIN_APPROVED 失敗:', e);
    }
  }

  // ----------------------------------------------------
  // 2. 房主審核處理 (批准 / 拒絕)
  // ----------------------------------------------------
  public approveJoinRequest(requestId: string, hostCurrentUrl?: string) {
    this.hostCurrentUrl = hostCurrentUrl;
    this.approvedRequestIds.add(requestId);

    const conn = this.pendingRequests.get(requestId) || this.activeConnections.get(requestId);
    if (!conn) {
      console.warn(`[Syncine P2P Host] 找不到對應的審核申請: ${requestId}`);
      return;
    }

    this.pendingRequests.delete(requestId);
    this.activeConnections.set(requestId, conn);

    // 綁定已批准連線的同步事件
    conn.on('data', (data: any) => {
      try {
        if (data?.type === 'GUEST_POLL_APPROVAL') {
          this.sendApprovalSignal(conn, requestId);
          return;
        }

        console.log(`[Syncine P2P Host] 收到來自成員 ${requestId} 之同步指令:`, data);
        chrome.runtime.sendMessage({
          type: 'OFFSCREEN_DATA_RECEIVED',
          payload: data
        } as ExtensionMessage).catch(() => {});

        // 星狀拓撲：房主自動轉發廣播給其餘所有在線成員
        this.broadcastExcept(requestId, data);
      } catch (e) {}
    });

    // 若當前已 open 立即發送，否則註冊 once('open')
    if (conn.open) {
      this.sendApprovalSignal(conn, requestId);
    } else {
      conn.once('open', () => {
        this.sendApprovalSignal(conn, requestId);
      });
    }

    // 額外保險計時重試發送，避免底層通道開啟競爭延遲
    setTimeout(() => this.sendApprovalSignal(conn, requestId), 300);
    setTimeout(() => this.sendApprovalSignal(conn, requestId), 800);
    setTimeout(() => this.sendApprovalSignal(conn, requestId), 1500);

    console.log(`[Syncine P2P Host] ✅ 已核准成員 ${requestId} 入房！(目前人數: ${this.getConnectedPeerCount()} 人)`);
    this.notifyJoinRequestsChanged();
    this.updateStatus('CONNECTED');
  }

  public rejectJoinRequest(requestId: string) {
    const conn = this.pendingRequests.get(requestId);
    if (!conn) return;

    this.pendingRequests.delete(requestId);
    this.approvedRequestIds.delete(requestId);
    try {
      conn.send({ type: 'JOIN_REJECTED' });
      setTimeout(() => conn.close(), 300);
    } catch (e) {}

    console.log(`[Syncine P2P Host] ❌ 已拒絕成員 ${requestId} 的入房申請`);
    this.notifyJoinRequestsChanged();
  }

  // ----------------------------------------------------
  // 3. 觀眾加入房間 (只需同一組 6 碼代碼，送出申請等審核)
  // ----------------------------------------------------
  public joinRoom(roomId: string, userId: string): Promise<{ roomId: string }> {
    return new Promise((resolve, reject) => {
      this.close();
      this.userId = userId;
      this.role = 'GUEST';
      this.roomId = roomId.toUpperCase();
      this.updateStatus('CONNECTING');

      const peer = new Peer(PEER_CONFIG);
      this.peer = peer;

      peer.on('open', () => {
        const targetHostPeerId = `syncine-${this.roomId}`;
        console.log(`[Syncine P2P Guest] 正在向房主 ${targetHostPeerId} 送出入房申請...`);

        const conn = peer.connect(targetHostPeerId, {
          metadata: {
            userId: this.userId,
            guestName: `訪客 (${this.userId.slice(-4)})`,
            timestamp: Date.now()
          }
        });
        this.guestConnection = conn;

        conn.on('open', () => {
          console.log('[Syncine P2P Guest] 通道已打通，等待房主確認核准中...');
          // 主動告知房主通道已就緒並查詢核准狀態
          try {
            conn.send({ type: 'GUEST_POLL_APPROVAL' });
          } catch (e) {}

          // 定時輪詢查詢核准狀態，直到收到 JOIN_APPROVED
          if (this.guestPollTimer) clearInterval(this.guestPollTimer);
          this.guestPollTimer = setInterval(() => {
            if (this.status === 'CONNECTED' || !conn.open) {
              if (this.guestPollTimer) clearInterval(this.guestPollTimer);
            } else {
              try {
                conn.send({ type: 'GUEST_POLL_APPROVAL' });
              } catch (e) {}
            }
          }, 1000);

          resolve({ roomId: this.roomId });
        });

        conn.on('data', (data: any) => {
          if (data?.type === 'JOIN_APPROVED') {
            console.log('[Syncine P2P Guest] 🎉 收到房主 JOIN_APPROVED 核准通知！立即解鎖開播');
            if (this.guestPollTimer) clearInterval(this.guestPollTimer);
            this.updateStatus('CONNECTED');

            // 關鍵：直接通知 Background 更新房間狀態，解鎖轉圈狀態
            chrome.runtime.sendMessage({
              type: 'BG_P2P_GUEST_APPROVED',
              payload: {
                roomId: this.roomId,
                hostCurrentUrl: data.hostCurrentUrl,
                memberCount: data.memberCount || 2
              }
            } as ExtensionMessage).catch(() => {});

            if (data.hostCurrentUrl) {
              chrome.runtime.sendMessage({
                type: 'BG_REDIRECT_ROOM',
                payload: { targetUrl: data.hostCurrentUrl }
              } as ExtensionMessage).catch(() => {});
            }
          } else if (data?.type === 'JOIN_REJECTED') {
            console.warn('[Syncine P2P Guest] 房主已婉拒您的加入申請');
            if (this.guestPollTimer) clearInterval(this.guestPollTimer);
            this.close();
            chrome.runtime.sendMessage({
              type: 'CS_ROOM_STATE_CHANGED',
              payload: null
            } as ExtensionMessage).catch(() => {});
            alert(getStandaloneText('ERR_AUDIT_REJECTED', '房主已婉拒您的入房申請。'));
          } else if (data?.type === 'MEMBER_COUNT_UPDATE') {
            console.log(`[Syncine P2P Guest] 收到 30 秒人數校準更新: ${data.count} 人`);
            chrome.runtime.sendMessage({
              type: 'OFFSCREEN_P2P_STATUS',
              payload: {
                status: this.status,
                peerCount: data.count
              }
            } as ExtensionMessage).catch(() => {});
          } else {
            // 一般影音同步指令 (PLAY / PAUSE / SEEK / REDIRECT)
            chrome.runtime.sendMessage({
              type: 'OFFSCREEN_DATA_RECEIVED',
              payload: data
            } as ExtensionMessage).catch(() => {});
          }
        });

        conn.on('close', () => {
          console.log('[Syncine P2P Guest] 與房主的連線已斷開');
          if (this.guestPollTimer) clearInterval(this.guestPollTimer);
          this.updateStatus('DISCONNECTED');
        });

        conn.on('error', (err) => {
          console.error('[Syncine P2P Guest] 與房主連線異常:', err);
        });
      });

      peer.on('error', (err) => {
        console.error('[Syncine P2P Guest] 信令連線失敗:', err);
        this.updateStatus('DISCONNECTED');
        if (err.type === 'peer-unavailable') {
          reject(new Error('找不到該房間，請確認邀請碼是否正確，或房主是否仍在線上。'));
        } else {
          reject(new Error(err.message || '加入房間失敗'));
        }
      });
    });
  }

  // ----------------------------------------------------
  // 4. 資料廣播與轉發
  // ----------------------------------------------------
  public sendData(data: any) {
    if (this.role === 'HOST') {
      this.activeConnections.forEach((conn) => {
        if (conn.open) {
          conn.send(data);
        }
      });
    } else if (this.role === 'GUEST') {
      if (this.guestConnection && this.guestConnection.open) {
        this.guestConnection.send(data);
      }
    }
  }

  private broadcastExcept(exceptPeerId: string, data: any) {
    this.activeConnections.forEach((conn, peerId) => {
      if (peerId !== exceptPeerId && conn.open) {
        conn.send(data);
      }
    });
  }

  // ----------------------------------------------------
  // 5. 關閉與釋放資源
  // ----------------------------------------------------
  public close() {
    if (this.guestPollTimer) {
      clearInterval(this.guestPollTimer);
      this.guestPollTimer = undefined;
    }

    this.activeConnections.forEach((conn) => {
      try {
        conn.close();
      } catch (e) {}
    });
    this.activeConnections.clear();
    this.approvedRequestIds.clear();

    this.pendingRequests.forEach((conn) => {
      try {
        conn.close();
      } catch (e) {}
    });
    this.pendingRequests.clear();

    if (this.guestConnection) {
      try {
        this.guestConnection.close();
      } catch (e) {}
      this.guestConnection = null;
    }

    if (this.peer) {
      try {
        this.peer.destroy();
      } catch (e) {}
      this.peer = null;
    }

    this.role = null;
    this.roomId = '';
    this.updateStatus('DISCONNECTED');
    this.notifyJoinRequestsChanged();
  }
}

const manager = new PeerJSWebRTCManager();

// 監聽來自 Background / Popup 的訊息
chrome.runtime.onMessage.addListener((request: ExtensionMessage, _sender, sendResponse) => {
  const { type, payload } = request;

  switch (type) {
    case 'OFFSCREEN_PEER_CREATE_ROOM':
      manager
        .createRoom(payload.userId)
        .then((res) => sendResponse({ success: true, ...res }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;

    case 'OFFSCREEN_PEER_JOIN_ROOM':
      manager
        .joinRoom(payload.roomId, payload.userId)
        .then((res) => sendResponse({ success: true, ...res }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;

    case 'OFFSCREEN_APPROVE_JOIN_REQUEST':
      manager.approveJoinRequest(payload.requestId, payload.hostCurrentUrl);
      sendResponse({ success: true });
      break;

    case 'OFFSCREEN_REJECT_JOIN_REQUEST':
      manager.rejectJoinRequest(payload.requestId);
      sendResponse({ success: true });
      break;

    case 'OFFSCREEN_SEND_DATA':
      manager.sendData(payload);
      sendResponse({ success: true });
      break;

    case 'OFFSCREEN_CLOSE_P2P':
      manager.close();
      sendResponse({ success: true });
      break;
  }
  return true;
});
