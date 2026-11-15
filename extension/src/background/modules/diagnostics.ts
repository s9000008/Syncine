import { PlaybackConflictState, RoomStateInfo } from '../../types/protocol';
import { maskIdentifier, sanitizeIp } from '../../utils/p2pLogger';
import { sanitizeLog } from '../../utils/sanitize';

const MAX_DIAGNOSTIC_EVENTS = 40;
const CONTENTION_ERROR_CODE = 'ERR_PLAYBACK_CONTENTION';

export interface BackgroundDiagnosticEvent {
  timestamp: string;
  category: 'CONTENTION' | 'SYNC' | 'SESSION' | 'SYSTEM';
  event: string;
  detail?: string;
}

export interface UnifiedDiagnosticReport {
  markdownReport: string;
  githubIssueUrl: string;
  errorCode: string;
  contentionDetected: boolean;
}

const diagnosticBuffer: BackgroundDiagnosticEvent[] = [];
let lastContentionLoggedAt = 0;

function redactSensitiveStrings(text: string): string {
  const ipMasked = sanitizeIp(text);
  const redactedUrls = ipMasked.replace(
    /https?:\/\/([^/\s?#]+)(?:[^\s]*)?/gi,
    (_m, host) => `https://${host}/[REDACTED]`
  );
  return redactedUrls.replace(
    /\b(token|auth|key|pass(?:word)?|secret|cred|cookie|session)=([^\s&;,]+)/gi,
    '$1=[REDACTED]'
  );
}

function sanitizeTextForDiagnostic(raw: unknown, maxLen = 160): string {
  return sanitizeLog(redactSensitiveStrings(String(raw ?? '')), maxLen);
}

/**
 * 記錄脫敏的 Background 系統/同步診斷事件 (Zero Console Scraping / Zero Privileged Info)
 */
export function recordDiagnosticEvent(
  category: BackgroundDiagnosticEvent['category'],
  event: string,
  detail?: string
): void {
  const entry: BackgroundDiagnosticEvent = {
    timestamp: new Date().toISOString(),
    category,
    event: sanitizeTextForDiagnostic(event, 80),
    detail: detail ? sanitizeTextForDiagnostic(detail, 180) : undefined
  };

  if (diagnosticBuffer.length >= MAX_DIAGNOSTIC_EVENTS) {
    diagnosticBuffer.shift();
  }
  diagnosticBuffer.push(entry);
}

/**
 * 記錄來自 Content Script 的純淨行為級控制權衝突遙測 (僅網域/狀態機旗標)
 */
export function recordContentionDiagnostic(conflict: PlaybackConflictState): void {
  if (!conflict || conflict.lastDetectedAt === lastContentionLoggedAt) {
    return;
  }
  lastContentionLoggedAt = conflict.lastDetectedAt;

  const cleanHost = sanitizeTextForDiagnostic(conflict.hostname || 'unknown', 64);
  const cleanPlatform = sanitizeTextForDiagnostic(conflict.platformId || 'unknown', 32);
  recordDiagnosticEvent(
    'CONTENTION',
    conflict.circuitBreakerActive ? 'CIRCUIT_BREAKER_ACTIVE' : 'PLAYBACK_CONTENTION',
    `host=${cleanHost} platform=${cleanPlatform} reversals=${conflict.reversalCount}`
  );
}

export function getDiagnosticEventsSnapshot(): BackgroundDiagnosticEvent[] {
  return [...diagnosticBuffer];
}

export function clearDiagnosticEventsForTest(): void {
  diagnosticBuffer.length = 0;
  lastContentionLoggedAt = 0;
}

function getRoomRoleLabel(roomState: RoomStateInfo | null): string {
  if (!roomState) return 'Idle (Not in room)';
  if (roomState.isHost) return 'Host';
  return roomState.allowGuestControl ? 'Guest (Interactive)' : 'Guest (Controlled)';
}

function getSafeExtensionVersion(): string {
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime?.getManifest) {
      return chrome.runtime.getManifest().version || '2.x';
    }
  } catch {
    // 測試環境無 chrome.runtime 時退回預設標記
  }
  return '2.x';
}

export function buildUnifiedDiagnosticReport(params: {
  roomState: RoomStateInfo | null;
  errorCode?: string;
  extensionVersion?: string;
  p2pMarkdown?: string;
}): UnifiedDiagnosticReport {
  const { roomState } = params;
  const conflict = roomState?.playbackConflict;
  const contentionDetected = Boolean(conflict?.detected);

  const rawCode =
    params.errorCode ||
    (contentionDetected ? CONTENTION_ERROR_CODE : roomState?.mode === 'P2P' ? 'ERR_P2P_TIMEOUT' : 'DIAGNOSTIC_SNAPSHOT');
  const errorCode = sanitizeLog(rawCode, 48) || 'DIAGNOSTIC_SNAPSHOT';
  const version = sanitizeLog(params.extensionVersion || getSafeExtensionVersion(), 24);
  const mode = roomState?.mode || 'DEFAULT';
  const maskedRoom = roomState?.roomId ? maskIdentifier(roomState.roomId) : 'N/A';

  const lines: string[] = [
    '### 🛠️ Syncine 綜合診斷報告 (Diagnostic Report)',
    `- **擴充套件版本**: Syncine v${version} (Chrome MV3)`,
    `- **連線模式**: ${mode}`,
    `- **房間角色**: ${getRoomRoleLabel(roomState)}`,
    `- **房間識別碼**: ${maskedRoom}`,
    `- **觸發代碼**: ${errorCode}`,
    `- **時間戳**: ${new Date().toISOString()}`,
    ''
  ];

  if (conflict && (conflict.detected || conflict.reversalCount > 0)) {
    const cleanHost = sanitizeTextForDiagnostic(conflict.hostname || 'unknown', 64);
    const cleanPlatform = sanitizeTextForDiagnostic(conflict.platformId || 'unknown', 32);
    lines.push('#### ⚠️ 播放控制權衝突遙測 (Playback Contention Telemetry)');
    lines.push(
      `- **保護狀態**: ${conflict.circuitBreakerActive ? '斷路器已啟動 (Circuit Breaker Active)' : '監測中 (Monitoring)'}`
    );
    lines.push(`- **目標網域 (僅 Hostname)**: ${cleanHost} (${cleanPlatform})`);
    lines.push(`- **短時間狀態反轉次數**: ${conflict.reversalCount}`);
    lines.push(
      '- **可能原因與建議**: 疑似頁面存在其他第三方同步／播放控制擴充套件同時操作 `<video>`，建議暫時停用其他同類擴充套件後重新整理分頁。'
    );

    const recentEvents = Array.isArray(conflict.recentEvents) ? conflict.recentEvents.slice(-10) : [];
    if (recentEvents.length > 0) {
      lines.push('');
      lines.push('```text');
      for (const evt of recentEvents) {
        const timeStr = new Date(evt.timestamp).toISOString().split('T')[1]?.slice(0, 8) || '00:00:00';
        const evtType = sanitizeLog(evt.type, 32);
        const evtAction = sanitizeLog(evt.observedAction, 12);
        const evtExpected = sanitizeLog(evt.expectedState, 12);
        lines.push(
          `[${timeStr}] ${evtType} | observed=${evtAction} expected=${evtExpected} | delta=${Math.max(0, Math.round(evt.deltaMs))}ms | userInput=${evt.hadRecentUserInput ? 'Y' : 'N'}`
        );
      }
      lines.push('```');
    }
    lines.push('');
  } else {
    lines.push('- **播放控制衝突狀態**: 正常 (未偵測到異常播放反轉)');
    lines.push('');
  }

  const recentBgEvents = diagnosticBuffer.slice(-15);
  if (recentBgEvents.length > 0) {
    lines.push('#### 📋 背景狀態機事件軌跡 (Sanitized Events)');
    lines.push('```text');
    for (const evt of recentBgEvents) {
      const timeStr = evt.timestamp.split('T')[1]?.slice(0, 8) || evt.timestamp;
      lines.push(`[${timeStr}] [${evt.category}] ${evt.event}${evt.detail ? ` — ${evt.detail}` : ''}`);
    }
    lines.push('```');
    lines.push('');
  }

  if (params.p2pMarkdown && params.p2pMarkdown.trim()) {
    lines.push('#### 🔗 WebRTC / P2P 補充遙測');
    lines.push(redactSensitiveStrings(params.p2pMarkdown.trim()));
    lines.push('');
  }

  lines.push(
    '> 🔒 隱私保護聲明：Syncine 採用零額外權限架構，絕不讀取頁面 Console、Cookie 或完整網址查詢參數；上述資料僅為本機脫敏之狀態機遙測。'
  );

  const markdownReport = lines.join('\n');

  const repoBase = 'https://github.com/s9000008/Syncine/issues/new';
  const isContentionIssue = contentionDetected || errorCode === CONTENTION_ERROR_CODE;
  const issueTitle = isContentionIssue
    ? `[Playback Contention] ${sanitizeTextForDiagnostic(conflict?.hostname || 'video-site', 40)} 播放控制權衝突回報`
    : `[Diagnostic Issue] ${errorCode} 異常回報`;
  const labels = isContentionIssue ? 'bug,compatibility' : mode === 'P2P' ? 'bug,p2p' : 'bug';

  const body = [
    '### 📌 問題現象描述',
    isContentionIssue
      ? '觀看影片期間發生播放／暫停反覆跳動，Syncine 已偵測到疑似第三方控制權衝突並觸發保護性節流。'
      : '使用 Syncine 同步觀影期間遇到連線或同步異常。',
    '',
    markdownReport
  ].join('\n');

  const query = new URLSearchParams({
    title: issueTitle,
    labels,
    body
  });

  return {
    markdownReport,
    githubIssueUrl: `${repoBase}?${query.toString()}`,
    errorCode,
    contentionDetected
  };
}
