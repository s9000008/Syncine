import { PlaybackConflictEvent, PlaybackConflictState } from '../types/protocol';

const BURST_WINDOW_MS = 6000;
const CONTENTION_PAIR_WINDOW_MS = 2500;
const CONTENTION_THRESHOLD = 3;
const CIRCUIT_BREAKER_COOLDOWN_MS = 2000;
const USER_INPUT_FRESH_MS = 1200;
const REPORT_THROTTLE_MS = 5000;
const MAX_CONFLICT_LOGS = 25;

export type PlaybackExpectedState = 'PLAYING' | 'PAUSED' | 'IDLE';
export type ObservedMediaAction = 'PLAY' | 'PAUSE' | 'SEEK';

export function sanitizeHostnameOnly(rawHostname?: string): string {
  if (!rawHostname || typeof rawHostname !== 'string') return 'unknown';
  const cleaned = rawHostname
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.-]/g, '')
    .slice(0, 80);
  return cleaned || 'unknown';
}

export class PlaybackContentionDetector {
  private lastUserInteractionAt = 0;
  private lastEnforcement: {
    expectedState: PlaybackExpectedState;
    timestamp: number;
    isRollback: boolean;
  } | null = null;

  private burstTimestamps: number[] = [];
  private recentEvents: PlaybackConflictEvent[] = [];
  private conflictDetected = false;
  private totalReversalCount = 0;
  private lastRollbackActionAt = 0;
  private lastReportedAt = 0;
  private platformId = 'unknown';
  private hostname = 'unknown';

  constructor(platformId = 'unknown', hostname = 'unknown') {
    this.updateContext(platformId, hostname);
  }

  public updateContext(platformId: string, hostname: string): void {
    this.platformId = (platformId || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) || 'unknown';
    this.hostname = sanitizeHostnameOnly(hostname);
  }

  public markUserInteraction(now = Date.now()): void {
    this.lastUserInteractionAt = now;
  }

  public hasRecentUserInteraction(now = Date.now()): boolean {
    return this.lastUserInteractionAt > 0 && now - this.lastUserInteractionAt <= USER_INPUT_FRESH_MS;
  }

  /**
   * 記錄 Syncine 主動強制設定或回滾之播放狀態
   */
  public recordSyncineEnforcement(
    expectedState: PlaybackExpectedState,
    isRollback: boolean = false,
    now = Date.now()
  ): void {
    this.lastEnforcement = {
      expectedState,
      timestamp: now,
      isRollback
    };
    if (isRollback) {
      this.lastRollbackActionAt = now;
    } else {
      // 收到來自房主的新遠端同步指令時，解除被動冷卻讓遠端指令即刻生效
      this.lastRollbackActionAt = 0;
    }
  }

  /**
   * 檢查是否處於 Ping-Pong 斷路器冷卻期（僅對無權限觀眾之重複被動回滾節流，絕不影響房主主動指令）
   */
  public shouldThrottleRollback(now = Date.now()): boolean {
    if (!this.conflictDetected || this.lastRollbackActionAt === 0) {
      return false;
    }
    return now - this.lastRollbackActionAt < CIRCUIT_BREAKER_COOLDOWN_MS;
  }

  /**
   * 觀察到非 Syncine 程式化觸發的媒體事件時呼叫，判定是否發生控制權反覆拉扯衝突
   * 回傳若非 null，代表達到上報條件，應立即向 Background 回報純淨脫敏衝突狀態
   */
  public recordObservedMediaFlip(
    observedAction: ObservedMediaAction,
    isGuestWithoutControl: boolean,
    now = Date.now()
  ): PlaybackConflictState | null {
    if (!this.lastEnforcement) return null;

    const deltaMs = now - this.lastEnforcement.timestamp;
    if (deltaMs < 0 || deltaMs > CONTENTION_PAIR_WINDOW_MS) {
      return null;
    }

    const expected = this.lastEnforcement.expectedState;
    const isOppositeFlip =
      (expected === 'PAUSED' && observedAction === 'PLAY') ||
      (expected === 'PLAYING' && observedAction === 'PAUSE') ||
      (this.lastEnforcement.isRollback && observedAction === 'SEEK');

    if (!isOppositeFlip) {
      return null;
    }

    const hadRecentInput = this.hasRecentUserInteraction(now);

    // 若使用者剛有明確手動交互，且當前為無權限觀眾偶發單次誤點，不直接視為腳本衝突；
    // 但在極短時間內無互動跳變，或無權限觀眾短時間連續遭到反向拉扯，即列入打架滑動計數
    if (!isGuestWithoutControl && hadRecentInput) {
      return null;
    }

    this.burstTimestamps = this.burstTimestamps.filter((ts) => now - ts <= BURST_WINDOW_MS);
    this.burstTimestamps.push(now);
    this.totalReversalCount++;

    const eventType: PlaybackConflictEvent['type'] = isGuestWithoutControl
      ? 'GUEST_ROLLBACK_BURST'
      : 'UNPROMPTED_STATE_FLIP';

    this.pushLogEvent({
      timestamp: now,
      type: eventType,
      platformId: this.platformId,
      hostname: this.hostname,
      expectedState: expected,
      observedAction,
      deltaMs,
      hadRecentUserInput: hadRecentInput
    });

    if (this.burstTimestamps.length >= CONTENTION_THRESHOLD) {
      const wasConflictDetected = this.conflictDetected;
      this.conflictDetected = true;

      if (!wasConflictDetected) {
        this.pushLogEvent({
          timestamp: now,
          type: 'CIRCUIT_BREAKER_ENGAGED',
          platformId: this.platformId,
          hostname: this.hostname,
          expectedState: expected,
          observedAction,
          deltaMs,
          hadRecentUserInput: hadRecentInput
        });
      }

      if (!wasConflictDetected || now - this.lastReportedAt >= REPORT_THROTTLE_MS) {
        this.lastReportedAt = now;
        return this.getConflictState(now);
      }
    }

    return null;
  }

  private pushLogEvent(entry: PlaybackConflictEvent): void {
    if (this.recentEvents.length >= MAX_CONFLICT_LOGS) {
      this.recentEvents.shift();
    }
    this.recentEvents.push(entry);
  }

  public getConflictState(now = Date.now()): PlaybackConflictState {
    return {
      detected: this.conflictDetected,
      platformId: this.platformId,
      hostname: this.hostname,
      reversalCount: this.totalReversalCount,
      circuitBreakerActive: this.conflictDetected,
      lastDetectedAt: this.recentEvents.length > 0 ? this.recentEvents[this.recentEvents.length - 1].timestamp : now,
      recentEvents: this.recentEvents.slice(-15)
    };
  }

  public isConflictDetected(): boolean {
    return this.conflictDetected;
  }

  public reset(): void {
    this.lastEnforcement = null;
    this.burstTimestamps = [];
    this.recentEvents = [];
    this.conflictDetected = false;
    this.totalReversalCount = 0;
    this.lastRollbackActionAt = 0;
    this.lastReportedAt = 0;
  }
}
