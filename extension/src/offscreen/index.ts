import { Peer, DataConnection } from 'peerjs';
import { P2PStatus, ExtensionMessage, JoinRequest, P2PDiagnosticData, validateSyncData } from '../types/protocol';
import { P2PLogger } from '../utils/p2pLogger';
import { sanitizeLog } from '../utils/sanitize';
import { APP_VERSION } from '../version';

console.log('[Syncine Offscreen] WebRTC Offscreen Document (PeerJS Engine) 已啟動');

const PEER_CONFIG = {
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' }
    ],
    iceCandidatePoolSize: 10
  }
};

/**
 * 密碼學安全隨機字元產生器 (消除模數偏差 Modulus Bias)
 */
function generateSecureRoomCode(length: number = 6): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  const buffer = new Uint8Array(1);
  while (result.length < length) {
    crypto.getRandomValues(buffer);
    const val = buffer[0];
    if (val < 252) { // 256 - (256 % 36) = 252
      result += chars[val % chars.length];
    }
  }
  return result;
}

export class PeerJSWebRTCManager {
  private role: 'HOST' | 'GUEST' | null = null;
  private lastRole: 'HOST' | 'GUEST' | null = null;
  private roomId: string = '';
  private lastRoomId: string = '';
  private userId: string = '';
  private status: P2PStatus = 'DISCONNECTED';
  private peer: Peer | null = null;
  private allowGuestControl: boolean = false;

  // 房主專屬：待審核入房申請佇列 (Key: conn.peer / requestId) 與本機接收時間戳 (不信任遠端時間戳)
  private pendingRequests: Map<string, DataConnection> = new Map();
  private pendingReceivedAt: Map<string, number> = new Map();
  // 房主專屬：已批准之成員 ID 集合 (防止 DataChannel 未開啟前發送遺失)
  private approvedRequestIds: Set<string> = new Set();
  // 房主專屬：已批准的活躍連線清單 (Key: conn.peer)
  private activeConnections: Map<string, DataConnection> = new Map();
  private dataListenerBoundIds: Set<string> = new Set();
  private hostCurrentUrl?: string;

  // 診斷日誌與重試追蹤
  private logger = P2PLogger.getInstance();
  private retryCount: number = 0;

  // 觀眾專屬：與房主的直連通道
  private guestConnection: DataConnection | null = null;
  private guestKnownMemberCount: number = 2;
  private guestPollTimer?: ReturnType<typeof setInterval>;

  // 30 秒定期心跳檢測計時器 (全模式通用校準)
  private heartbeat30sTimer: ReturnType<typeof setInterval> | null = null;

  constructor(autoStartHeartbeat = true) {
    if (autoStartHeartbeat) {
      this.start30sHeartbeat();
    }
  }

  private attachIceLogger(conn: DataConnection) {
    try {
      const bindPc = () => {
        const pc = (conn as any)?.peerConnection as RTCPeerConnection | undefined;
        if (!pc || (pc as any).__syncineIceLogged) return;
        (pc as any).__syncineIceLogged = true;
        pc.addEventListener('icecandidate', (event: RTCPeerConnectionIceEvent) => {
          const cand = event.candidate?.candidate;
          if (!cand) return;
          const match = cand.match(/\btyp\s+(host|srflx|relay)\b/i);
          const type = (match ? match[1].toLowerCase() : 'host') as 'host' | 'srflx' | 'relay';
          this.logger.record('STUN_GATHER', `ICE 候選者 (${type})`, 'INFO', { type });
        });
      };
      bindPc();
      setTimeout(bindPc, 50);
    } catch (e) {}
  }

  public getDiagnosticData(errorCode?: string): P2PDiagnosticData {
    const version = (typeof chrome !== 'undefined' && chrome?.runtime?.getManifest?.()?.version)
      ? `v${chrome.runtime.getManifest().version}`
      : APP_VERSION;
    const effectiveRoomId = this.roomId || this.lastRoomId;
    const effectiveRole = this.role || this.lastRole || undefined;
    const report = this.logger.generateMarkdownReport({
      version,
      roomId: effectiveRoomId,
      role: effectiveRole,
      status: this.status,
      retryCount: this.retryCount,
      errorCode
    });
    const githubUrl = this.logger.generateGitHubIssueUrl({
      errorCode,
      markdownReport: report
    });
    return {
      version,
      roomId: effectiveRoomId,
      role: effectiveRole,
      status: this.status,
      retryCount: this.retryCount,
      candidatesSummary: this.logger.getCandidatesSummary(),
      recentLogs: this.logger.getRecentLogs(30),
      markdownReport: report,
      githubIssueUrl: githubUrl
    };
  }

  public updatePermission(allowGuestControl: boolean) {
    this.allowGuestControl = allowGuestControl;
    console.log(`[Syncine P2P Host] 更新觀眾控制權限: ${allowGuestControl}`);
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
            this.dataListenerBoundIds.delete(peerId);
          }
        });

        // 1.1 清理超過 30 秒未批准的過期懸掛申請 (一律以房主本機接收時間 pendingReceivedAt 判斷，防範遠端偽造未來時間戳)
        const now = Date.now();
        let pendingCleaned = false;
        this.pendingRequests.forEach((conn, reqId) => {
          const receivedAt = this.pendingReceivedAt.get(reqId) ?? now;
          if (!conn.open && now - receivedAt > 30000) {
            console.log(`[Syncine 30s Heartbeat] 清理過期未連通入房申請: ${sanitizeLog(reqId)}`);
            try { conn.close(); } catch {}
            this.pendingRequests.delete(reqId);
            this.pendingReceivedAt.delete(reqId);
            pendingCleaned = true;
          }
        });
        if (pendingCleaned) {
          this.notifyJoinRequestsChanged();
        }

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
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({
        type: 'OFFSCREEN_P2P_STATUS',
        payload: {
          status: this.status,
          peerCount
        }
      } as ExtensionMessage).catch(() => {});
    }
  }

  public getConnectedPeerCount(): number {
    if (this.role === 'HOST') {
      let openCount = 1; // 房主本人
      this.activeConnections.forEach((conn) => {
        if (conn.open) openCount++;
      });
      return openCount;
    } else if (this.role === 'GUEST') {
      return this.guestConnection && this.guestConnection.open ? Math.max(2, this.guestKnownMemberCount) : 1;
    }
    return 1;
  }

  // 通知 Background 待審核清單變更
  private notifyJoinRequestsChanged() {
    const list: JoinRequest[] = [];
    this.pendingRequests.forEach((conn, requestId) => {
      const shortId = requestId.slice(-4);
      const safeName = sanitizeLog(conn.metadata?.guestName, 32) || shortId;
      list.push({
        requestId,
        guestName: safeName,
        guestShortId: shortId,
        timestamp: this.pendingReceivedAt.get(requestId) ?? Date.now()
      });
    });

    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({
        type: 'CS_JOIN_REQUESTS_UPDATED',
        payload: { pendingRequests: list }
      } as ExtensionMessage).catch(() => {});
    }
  }

  // ----------------------------------------------------
  // 1. 房主建房 (統一 6 碼邀請碼，可邀請多人，無人數上限)
  // ----------------------------------------------------
  public createRoom(userId: string, idRetryCount: number = 0): Promise<{ roomId: string }> {
    return new Promise((resolve, reject) => {
      this.close();
      this.userId = userId;
      this.role = 'HOST';
      this.lastRole = 'HOST';

      // 產生 6 碼英數字代碼 (密碼學安全隨機亂數 CSPRNG)
      const roomId = generateSecureRoomCode(6);
      this.roomId = roomId;
      this.lastRoomId = roomId;
      this.logger.record('INIT', '建立房間', 'INFO', { roomId });

      console.log(`[Syncine P2P Host] 正在向信令網路註冊房間 ID: ${roomId}...`);
      const peerId = `syncine-${roomId}`;
      const peer = new Peer(peerId, PEER_CONFIG);
      this.peer = peer;

      peer.on('open', (id) => {
        console.log(`[Syncine P2P Host] 🎉 房間建立成功！房間代碼: ${roomId} (PeerID: ${id})`);
        this.logger.record('SIGNALING', '信令註冊就緒', 'INFO', { peerId: id });
        this.updateStatus('CONNECTED');
        resolve({ roomId });
      });

      peer.on('connection', (conn: DataConnection) => {
        const requestId = conn.peer;
        const shortId = requestId.slice(-4);
        const guestName = conn.metadata?.guestName || shortId;
        console.log(`[Syncine P2P Host] 收到新成員入房申請: ${guestName} (${requestId})`);
        this.logger.record('AUDIT', '收到入房申請', 'INFO', { requestId });
        this.attachIceLogger(conn);

        if (!this.pendingRequests.has(requestId) && !this.activeConnections.has(requestId) && this.pendingRequests.size >= 30) {
          console.warn(`[Syncine P2P Host] 待審核申請佇列已滿 (30)，自動拒絕超額請求: ${requestId}`);
          try { conn.close(); } catch (_) {}
          return;
        }

        this.pendingRequests.set(requestId, conn);
        this.pendingReceivedAt.set(requestId, Date.now());
        this.notifyJoinRequestsChanged();

        // 綁定連線狀態事件
        conn.on('open', () => {
          console.log(`[Syncine P2P Host] 與成員 ${requestId} 之 DataChannel 已成功 open (open=${conn.open})`);
          this.logger.record('DATA_CHANNEL', 'DataChannel 已建立', 'INFO', { requestId });
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
          console.log(`[Syncine P2P Host] 成員連線關閉: ${sanitizeLog(requestId)}`);
          this.pendingRequests.delete(requestId);
          this.pendingReceivedAt.delete(requestId);
          this.activeConnections.delete(requestId);
          this.approvedRequestIds.delete(requestId);
          this.dataListenerBoundIds.delete(requestId);
          this.notifyJoinRequestsChanged();
          this.updateStatus(this.status);
        });

        conn.on('error', (err) => {
          console.error(`[Syncine P2P Host] 成員 ${requestId} 連線異常:`, err);
          this.logger.record('ERROR', '觀眾連線異常', 'ERROR', { requestId, error: err.message });
        });
      });

      peer.on('error', (err) => {
        console.error('[Syncine P2P Host] 信令伺服器錯誤:', err);
        this.logger.record('ERROR', `信令錯誤 (${err.type || 'unknown'})`, 'ERROR', { type: err.type, error: err.message });
        if (err.type === 'unavailable-id' && idRetryCount < 5) {
          this.createRoom(userId, idRetryCount + 1).then(resolve).catch(reject);
        } else {
          reject(new Error(err.message || 'ERR_P2P_SIGNAL_FAILED'));
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
    this.pendingReceivedAt.delete(requestId);
    this.activeConnections.set(requestId, conn);

    // 綁定已批准連線的同步事件 (確保每個成員僅綁定一次，避免重複轉發)
    if (!this.dataListenerBoundIds.has(requestId)) {
      this.dataListenerBoundIds.add(requestId);
      conn.on('data', (data: any) => {
        try {
          if (data?.type === 'GUEST_POLL_APPROVAL') {
            this.sendApprovalSignal(conn, requestId);
            return;
          }

          // 0. 觀眾頁面就緒後請求初始時間軸狀態：單向轉交房主 Background，不轉廣播給其他觀眾
          if (data?.type === 'REQUEST_INIT_SYNC') {
            const now = Date.now();
            const lastReq = (conn as any).__lastInitSyncAt || 0;
            if (now - lastReq > 1000) {
              (conn as any).__lastInitSyncAt = now;
              chrome.runtime.sendMessage({
                type: 'OFFSCREEN_DATA_RECEIVED',
                payload: { type: 'REQUEST_INIT_SYNC', requesterPeerId: requestId }
              } as ExtensionMessage).catch(() => {});
            }
            return;
          }

          // 1. 嚴格阻絕特權指令：觀眾端嚴禁發起 REDIRECT_ROOM 或 TOGGLE_PERMISSION
          if (data?.type === 'REDIRECT_ROOM' || data?.type === 'TOGGLE_PERMISSION') {
            console.warn(`[P2P Security Drop] 阻絕來自成員 ${sanitizeLog(requestId)} 的特權指令:`, sanitizeLog(data?.type));
            return;
          }

          // 2. 播放動作權限與 Schema 檢查：若房主未開放觀眾控制或 Payload 違規（含 Guest 偽造 HEARTBEAT），直接丟棄
          if (data?.action) {
            if (!this.allowGuestControl) {
              console.warn(`[P2P Security Drop] 房主已關閉觀眾控制，丟棄來自 ${sanitizeLog(requestId)} 的 ${sanitizeLog(data.action)} 操作`);
              return;
            }
            const cleanData = validateSyncData(data, false);
            if (!cleanData) {
              console.warn(`[P2P Security Drop] 丟棄來自 ${sanitizeLog(requestId)} 的無效或越權 SYNC_STATE 封包`);
              return;
            }
            chrome.runtime.sendMessage({
              type: 'OFFSCREEN_DATA_RECEIVED',
              payload: cleanData
            } as ExtensionMessage).catch(() => {});
            this.broadcastExcept(requestId, cleanData);
            return;
          }
        } catch {}
      });
    }

    // 單次確定送達：已 open 立即發送，否則註冊 once('open') (由觀眾端 GUEST_POLL_APPROVAL 輪詢補位)
    if (conn.open) {
      this.sendApprovalSignal(conn, requestId);
    } else {
      conn.once('open', () => {
        this.sendApprovalSignal(conn, requestId);
      });
    }

    console.log(`[Syncine P2P Host] ✅ 已核准成員 ${sanitizeLog(requestId)} 入房！(目前人數: ${this.getConnectedPeerCount()} 人)`);
    this.notifyJoinRequestsChanged();
    this.updateStatus('CONNECTED');
  }

  public rejectJoinRequest(requestId: string) {
    const conn = this.pendingRequests.get(requestId);
    if (!conn) return;

    this.pendingRequests.delete(requestId);
    this.pendingReceivedAt.delete(requestId);
    this.approvedRequestIds.delete(requestId);
    try {
      conn.send({ type: 'JOIN_REJECTED' });
      setTimeout(() => conn.close(), 300);
    } catch {}

    console.log(`[Syncine P2P Host] ❌ 已拒絕成員 ${requestId} 的入房申請`);
    this.notifyJoinRequestsChanged();
  }

  // ----------------------------------------------------
  // 3. 觀眾加入房間 (只需同一組 6 碼代碼，送出申請等審核，支援 2 次退避重試)
  // ----------------------------------------------------
  public joinRoom(roomId: string, userId: string, retryCount: number = 0): Promise<{ roomId: string }> {
    return new Promise((resolve, reject) => {
      this.close();
      this.userId = userId;
      this.role = 'GUEST';
      this.lastRole = 'GUEST';
      this.roomId = roomId.toUpperCase();
      this.lastRoomId = this.roomId;
      this.retryCount = retryCount;
      this.updateStatus('CONNECTING');
      this.logger.record('INIT', '發起入房', 'INFO', { roomId: this.roomId, retryCount });

      const MAX_RETRIES = 2;
      const handleRetry = (reason: string, error: Error) => {
        this.logger.record('RETRY', `重試 (${reason})`, 'WARN', { retryCount: retryCount + 1, error: error.message });
        if (retryCount < MAX_RETRIES) {
          const delayMs = retryCount === 0 ? 1500 : 3000;
          console.warn(`[Syncine P2P Guest] 握手/ICE 未就緒 (${reason})，正在啟動第 ${retryCount + 1}/${MAX_RETRIES} 次自動重試 (退避 ${delayMs}ms)...`);
          this.close();
          setTimeout(() => {
            this.joinRoom(roomId, userId, retryCount + 1)
              .then(resolve)
              .catch(reject);
          }, delayMs);
        } else {
          console.error(`[Syncine P2P Guest] 重試已達上限 (${MAX_RETRIES} 次)，P2P 穿透失敗，建議改用官方伺服器中繼模式`);
          this.logger.record('ERROR', '重試達上限，穿透失敗', 'ERROR');
          this.close();
          reject(error);
        }
      };

      const peer = new Peer(PEER_CONFIG);
      this.peer = peer;

      peer.on('open', (id) => {
        const targetHostPeerId = `syncine-${this.roomId}`;
        console.log(`[Syncine P2P Guest] 正在向房主 ${targetHostPeerId} 送出入房申請 (嘗試: ${retryCount + 1})...`);
        this.logger.record('SIGNALING', '信令就緒，發起握手', 'INFO', { peerId: id, roomId: this.roomId });

        let isSettled = false;
        const connectTimeoutTimer = setTimeout(() => {
          if (!isSettled) {
            isSettled = true;
            console.warn('[Syncine P2P Guest] WebRTC DataChannel 握手連線逾時 (10s)');
            handleRetry('握手逾時', new Error('ERR_P2P_TIMEOUT'));
          }
        }, 10000);

        const shortId = this.userId.slice(-4);
        const conn = peer.connect(targetHostPeerId, {
          reliable: true,
          metadata: {
            userId: this.userId,
            guestShortId: shortId,
            guestName: shortId,
            timestamp: Date.now()
          }
        });
        this.guestConnection = conn;
        this.attachIceLogger(conn);

        conn.on('open', () => {
          if (isSettled) return;
          isSettled = true;
          clearTimeout(connectTimeoutTimer);
          console.log('[Syncine P2P Guest] 通道已打通，等待房主確認核准中...');
          this.logger.record('DATA_CHANNEL', '通道打通，待審核', 'INFO');
          // 主動告知房主通道已就緒並查詢核准狀態
          try {
            conn.send({ type: 'GUEST_POLL_APPROVAL' });
          } catch (e) {}

          // 定時輪詢查詢核准狀態，直到收到 JOIN_APPROVED (15 秒審核超時)
          if (this.guestPollTimer) clearInterval(this.guestPollTimer);
          let pollSeconds = 0;
          this.guestPollTimer = setInterval(() => {
            pollSeconds++;
            if (this.status === 'CONNECTED') {
              if (this.guestPollTimer) clearInterval(this.guestPollTimer);
              return;
            }

            if (pollSeconds > 15) {
              if (this.guestPollTimer) clearInterval(this.guestPollTimer);
              console.warn('[Syncine P2P Guest] 等待房主審核逾時 (15s)');
              this.logger.record('ERROR', '審核逾時 (15s)', 'ERROR');
              this.close();
              chrome.runtime.sendMessage({
                type: 'CS_ROOM_STATE_CHANGED',
                payload: null
              } as ExtensionMessage).catch(() => {});
              chrome.runtime.sendMessage({
                type: 'CS_CONNECTION_STATUS_CHANGED',
                payload: { error: 'ERR_P2P_TIMEOUT', code: 'ERR_P2P_TIMEOUT' }
              } as ExtensionMessage).catch(() => {});
              return;
            }

            if (conn.open) {
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
            this.logger.record('CONNECTED', '核准通過，直連就緒', 'INFO');
            if (typeof data.memberCount === 'number' && data.memberCount >= 2) {
              this.guestKnownMemberCount = data.memberCount;
            }
            if (this.guestPollTimer) clearInterval(this.guestPollTimer);
            this.updateStatus('CONNECTED');

            // 關鍵：直接通知 Background 更新房間狀態並自動導航至房主當前影片，解鎖轉圈狀態
            chrome.runtime.sendMessage({
              type: 'BG_P2P_GUEST_APPROVED',
              payload: {
                roomId: this.roomId,
                hostCurrentUrl: data.hostCurrentUrl,
                memberCount: data.memberCount || 2
              }
            } as ExtensionMessage).catch(() => {});
          } else if (data?.type === 'JOIN_REJECTED') {
            console.warn('[Syncine P2P Guest] 房主已婉拒您的加入申請');
            this.logger.record('AUDIT', '房主拒絕申請', 'WARN');
            if (this.guestPollTimer) clearInterval(this.guestPollTimer);
            this.close();
            chrome.runtime.sendMessage({
              type: 'CS_ROOM_STATE_CHANGED',
              payload: null
            } as ExtensionMessage).catch(() => {});
            chrome.runtime.sendMessage({
              type: 'CS_CONNECTION_STATUS_CHANGED',
              payload: { error: 'ERR_AUDIT_REJECTED', code: 'ERR_AUDIT_REJECTED' }
            } as ExtensionMessage).catch(() => {});
          } else if (data?.type === 'MEMBER_COUNT_UPDATE') {
            if (typeof data.count === 'number' && data.count >= 1) {
              this.guestKnownMemberCount = data.count;
            }
            console.log(`[Syncine P2P Guest] 收到 30 秒人數校準更新: ${data.count} 人`);
            chrome.runtime.sendMessage({
              type: 'OFFSCREEN_P2P_STATUS',
              payload: {
                status: this.status,
                peerCount: data.count
              }
            } as ExtensionMessage).catch(() => {});
          } else if (data?.action) {
            const cleanData = validateSyncData(data, true);
            if (!cleanData) return;
            chrome.runtime.sendMessage({
              type: 'OFFSCREEN_DATA_RECEIVED',
              payload: cleanData
            } as ExtensionMessage).catch(() => {});
          } else if (data?.type === 'REDIRECT_ROOM' || data?.type === 'TOGGLE_PERMISSION') {
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
          this.logger.record('ERROR', 'DataChannel 異常', 'ERROR', { error: err.message });
          if (!isSettled) {
            isSettled = true;
            clearTimeout(connectTimeoutTimer);
            handleRetry('連線異常', new Error('ERR_P2P_SIGNAL_FAILED'));
          }
        });
      });

      peer.on('error', (err) => {
        console.error('[Syncine P2P Guest] 信令連線失敗:', err);
        this.logger.record('ERROR', `信令錯誤 (${err.type || 'unknown'})`, 'ERROR', { type: err.type, error: err.message });
        this.updateStatus('DISCONNECTED');
        if (err.type === 'peer-unavailable') {
          reject(new Error('ERR_ROOM_NOT_FOUND'));
        } else {
          handleRetry(err.type || '信令錯誤', new Error(err.message || 'ERR_P2P_SIGNAL_FAILED'));
        }
      });
    });
  }

  // ----------------------------------------------------
  // 4. 資料廣播與轉發
  // ----------------------------------------------------
  public sendData(data: any) {
    if (this.role === 'HOST') {
      let sentCount = 0;
      this.activeConnections.forEach((conn) => {
        if (conn.open) {
          conn.send(data);
          sentCount++;
        }
      });
      console.log(`[Syncine Offscreen Host] sendData (${data?.action || data?.type}): 已發送至 ${sentCount} 個 Peer (連線池總數: ${this.activeConnections.size})`);
    } else if (this.role === 'GUEST') {
      if (this.guestConnection && this.guestConnection.open) {
        this.guestConnection.send(data);
        console.log(`[Syncine Offscreen Guest] sendData (${data?.action || data?.type}): 已發送至 Host`);
      } else {
        console.warn(`[Syncine Offscreen Guest] sendData 失敗: 與 Host 連線未開啟 (open=${this.guestConnection?.open})`);
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
    this.dataListenerBoundIds.clear();

    this.pendingRequests.forEach((conn) => {
      try {
        conn.close();
      } catch {}
    });
    this.pendingRequests.clear();
    this.pendingReceivedAt.clear();

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
    this.guestKnownMemberCount = 2;
    this.updateStatus('DISCONNECTED');
    this.notifyJoinRequestsChanged();
  }
}

const isRuntimeContext = typeof chrome !== 'undefined' && Boolean(chrome?.runtime?.onMessage);
const manager = isRuntimeContext ? new PeerJSWebRTCManager(true) : null;

// 監聽來自 Background / Popup 的訊息
if (isRuntimeContext && manager) {
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

      case 'OFFSCREEN_UPDATE_PERMISSION':
        manager.updatePermission(Boolean(payload?.allowGuestControl));
        sendResponse({ success: true });
        break;

      case 'OFFSCREEN_CLOSE_P2P':
        manager.close();
        sendResponse({ success: true });
        break;

      case 'OFFSCREEN_GET_DIAGNOSTIC':
        sendResponse({ success: true, data: manager.getDiagnosticData(payload?.errorCode) });
        break;
    }
    return true;
  });
}
