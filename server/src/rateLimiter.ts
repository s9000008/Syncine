/**
 * Syncine 伺服器端連線頻率限制器 (In-Memory Sliding Window Rate Limiter)
 * 防止廣播風暴、惡意刷房與 DoS 耗竭攻擊
 */

interface SocketRateRecord {
  // 高頻事件時間戳 (例如 SYNC_STATE) - 窗口 1 秒
  syncTimestamps: number[];
  // 敏感操作時間戳 (CREATE_ROOM / JOIN_ROOM) - 窗口 10 秒
  sensitiveTimestamps: number[];
  // 全域累積時間戳 (偵測 DoS 爆破) - 窗口 1 秒
  totalTimestamps: number[];
}

export interface RateLimitCheckResult {
  allowed: boolean;
  isMalicious: boolean;
  reason?: 'RATE_LIMIT_SYNC' | 'RATE_LIMIT_SENSITIVE' | 'DOS_ATTACK';
}

export class RateLimiter {
  private records: Map<string, SocketRateRecord> = new Map();

  // 配置閾值
  private readonly MAX_SYNC_PER_SEC = 15;
  private readonly MAX_SENSITIVE_PER_10SEC = 6;
  private readonly MALICIOUS_BURST_PER_SEC = 50;

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

  /**
   * 檢查並記錄一般事件 (全域防洪)
   */
  public checkGeneral(socketId: string, now: number = Date.now()): RateLimitCheckResult {
    const rec = this.getRecord(socketId);
    rec.totalTimestamps = rec.totalTimestamps.filter((t) => now - t < 1000);
    rec.totalTimestamps.push(now);

    if (rec.totalTimestamps.length > this.MALICIOUS_BURST_PER_SEC) {
      return { allowed: false, isMalicious: true, reason: 'DOS_ATTACK' };
    }
    return { allowed: true, isMalicious: false };
  }

  /**
   * 檢查並記錄高頻同步事件 (SYNC_STATE)
   */
  public checkSync(socketId: string, now: number = Date.now()): RateLimitCheckResult {
    const general = this.checkGeneral(socketId, now);
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
   * 檢查並記錄低頻敏感操作 (CREATE_ROOM / JOIN_ROOM)
   */
  public checkSensitive(socketId: string, now: number = Date.now()): RateLimitCheckResult {
    const general = this.checkGeneral(socketId, now);
    if (general.isMalicious) return general;

    const rec = this.getRecord(socketId);
    rec.sensitiveTimestamps = rec.sensitiveTimestamps.filter((t) => now - t < 10000);

    if (rec.sensitiveTimestamps.length >= this.MAX_SENSITIVE_PER_10SEC) {
      return { allowed: false, isMalicious: false, reason: 'RATE_LIMIT_SENSITIVE' };
    }

    rec.sensitiveTimestamps.push(now);
    return { allowed: true, isMalicious: false };
  }

  /**
   * Socket 斷線時清理記憶體
   */
  public removeSocket(socketId: string): void {
    this.records.delete(socketId);
  }

  /**
   * 取得當前追蹤的 Socket 數量
   */
  public getTrackedCount(): number {
    return this.records.size;
  }
}
