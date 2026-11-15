/**
 * Syncine 伺服器端雙維度連線頻率限制器 (Socket ID + Client IP Sliding Window Rate Limiter)
 * 防止廣播風暴、斷線重連繞過刷房與 DoS 耗竭攻擊
 */

interface SocketRateRecord {
  syncTimestamps: number[];
  sensitiveTimestamps: number[];
  totalTimestamps: number[];
}

interface IpRateRecord {
  sensitiveTimestamps: number[];
  totalTimestamps: number[];
  lastSeenAt: number;
}

export interface RateLimitCheckResult {
  allowed: boolean;
  isMalicious: boolean;
  reason?: 'RATE_LIMIT_SYNC' | 'RATE_LIMIT_SENSITIVE' | 'DOS_ATTACK';
}

export class RateLimiter {
  private records: Map<string, SocketRateRecord> = new Map();
  private ipRecords: Map<string, IpRateRecord> = new Map();
  private socketToIp: Map<string, string> = new Map();

  private readonly MAX_SYNC_PER_SEC = 15;
  private readonly MAX_SENSITIVE_PER_10SEC = 6;
  private readonly MAX_IP_SENSITIVE_PER_10SEC = 12;
  private readonly MALICIOUS_BURST_PER_SEC = 50;
  private readonly MAX_IP_BURST_PER_SEC = 100;
  private readonly IP_RECORD_TTL_MS = 60_000;

  /**
   * 綁定 Socket 與來源 IP 映射，便於防止以頻繁重連更換 socket.id 繞過敏感操作限流
   */
  public registerSocketIp(socketId: string, clientIp: string): void {
    if (clientIp && clientIp !== 'unknown') {
      this.socketToIp.set(socketId, clientIp);
    }
  }

  private getRecord(socketId: string): SocketRateRecord {
    let rec = this.records.get(socketId);
    if (!rec) {
      rec = {
        syncTimestamps: [],
        sensitiveTimestamps: [],
        totalTimestamps: []
      };
      this.records.set(socketId, rec);
    }
    return rec;
  }

  private getIpRecord(clientIp: string, now: number): IpRateRecord {
    // 定期淘汰逾時 IP 記錄，避免 256MB 容器記憶體累積
    if (this.ipRecords.size > 500) {
      for (const [ip, entry] of this.ipRecords.entries()) {
        if (now - entry.lastSeenAt > this.IP_RECORD_TTL_MS) {
          this.ipRecords.delete(ip);
        }
      }
    }
    let rec = this.ipRecords.get(clientIp);
    if (!rec) {
      rec = {
        sensitiveTimestamps: [],
        totalTimestamps: [],
        lastSeenAt: now
      };
      this.ipRecords.set(clientIp, rec);
    }
    rec.lastSeenAt = now;
    return rec;
  }

  /**
   * 檢查並記錄一般事件 (Socket 與 IP 雙層防洪)
   */
  public checkGeneral(socketId: string, now: number = Date.now(), clientIp?: string): RateLimitCheckResult {
    const rec = this.getRecord(socketId);
    rec.totalTimestamps = rec.totalTimestamps.filter((t) => now - t < 1000);
    rec.totalTimestamps.push(now);

    if (rec.totalTimestamps.length > this.MALICIOUS_BURST_PER_SEC) {
      return { allowed: false, isMalicious: true, reason: 'DOS_ATTACK' };
    }

    const resolvedIp = clientIp || this.socketToIp.get(socketId);
    if (resolvedIp && resolvedIp !== 'unknown') {
      const ipRec = this.getIpRecord(resolvedIp, now);
      ipRec.totalTimestamps = ipRec.totalTimestamps.filter((t) => now - t < 1000);
      ipRec.totalTimestamps.push(now);
      if (ipRec.totalTimestamps.length > this.MAX_IP_BURST_PER_SEC) {
        return { allowed: false, isMalicious: true, reason: 'DOS_ATTACK' };
      }
    }

    return { allowed: true, isMalicious: false };
  }

  /**
   * 檢查並記錄高頻同步事件 (SYNC_STATE)
   */
  public checkSync(socketId: string, now: number = Date.now(), clientIp?: string): RateLimitCheckResult {
    const general = this.checkGeneral(socketId, now, clientIp);
    if (general.isMalicious) return general;

    const rec = this.getRecord(socketId);
    rec.syncTimestamps = rec.syncTimestamps.filter((t) => now - t < 1000);

    if (rec.syncTimestamps.length >= this.MAX_SYNC_PER_SEC) {
      return { allowed: false, isMalicious: false, reason: 'RATE_LIMIT_SYNC' };
    }

    rec.syncTimestamps.push(now);
    return { allowed: true, isMalicious: false };
  }

  /**
   * 檢查並記錄低頻敏感操作 (CREATE_ROOM / JOIN_ROOM)，同時受 Socket 與來源 IP 限流約束
   */
  public checkSensitive(socketId: string, now: number = Date.now(), clientIp?: string): RateLimitCheckResult {
    const general = this.checkGeneral(socketId, now, clientIp);
    if (general.isMalicious) return general;

    const rec = this.getRecord(socketId);
    rec.sensitiveTimestamps = rec.sensitiveTimestamps.filter((t) => now - t < 10000);

    if (rec.sensitiveTimestamps.length >= this.MAX_SENSITIVE_PER_10SEC) {
      return { allowed: false, isMalicious: false, reason: 'RATE_LIMIT_SENSITIVE' };
    }

    const resolvedIp = clientIp || this.socketToIp.get(socketId);
    if (resolvedIp && resolvedIp !== 'unknown') {
      const ipRec = this.getIpRecord(resolvedIp, now);
      ipRec.sensitiveTimestamps = ipRec.sensitiveTimestamps.filter((t) => now - t < 10000);
      if (ipRec.sensitiveTimestamps.length >= this.MAX_IP_SENSITIVE_PER_10SEC) {
        return { allowed: false, isMalicious: false, reason: 'RATE_LIMIT_SENSITIVE' };
      }
      ipRec.sensitiveTimestamps.push(now);
    }

    rec.sensitiveTimestamps.push(now);
    return { allowed: true, isMalicious: false };
  }

  /**
   * Socket 斷線時清理記憶體（IP 記錄依滑動視窗保留，待 TTL 自動清理）
   */
  public removeSocket(socketId: string): void {
    this.records.delete(socketId);
    this.socketToIp.delete(socketId);
  }

  /**
   * 取得當前追蹤的 Socket 數量
   */
  public getTrackedCount(): number {
    return this.records.size;
  }
}
