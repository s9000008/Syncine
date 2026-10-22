import { P2PLogEvent, P2PDiagnosticData, P2PStatus } from '../types/protocol';
import { APP_VERSION } from '../version';

/**
 * IP 位址遮蔽與隱私清毒 (Zero-Leakage Privacy Sanitizer)
 */
export function sanitizeIp(text: string): string {
  if (!text) return '';
  // 遮蔽 IPv4 後兩段: 192.168.1.100 -> 192.168.*.*
  let result = text.replace(/\b(\d{1,3}\.\d{1,3})\.\d{1,3}\.\d{1,3}\b/g, '$1.*.*');
  // 遮蔽 IPv6
  result = result.replace(/\b([0-9a-fA-F]{1,4}:[0-9a-fA-F]{1,4}:[0-9a-fA-F]{1,4}):[0-9a-fA-F:]+\b/g, '$1:****');
  // 遮蔽內嵌之 syncine-XXXXXX 房號
  result = result.replace(/\bsyncine-([A-Za-z0-9]{2})[A-Za-z0-9]+([A-Za-z0-9]{2})\b/g, 'syncine-$1***$2');
  return result;
}

/**
 * 遮蔽房號與使用者識別碼 (保留首尾碼供排查)
 */
export function maskIdentifier(id?: string): string {
  if (!id) return 'unknown';
  if (id.length <= 4) return '***' + id.slice(-1);
  return id.slice(0, 2) + '***' + id.slice(-2);
}

/**
 * 脫敏詳細細節物件 (防洩漏 Token、識別碼與真實 IP)
 */
export function sanitizeDetails(details?: Record<string, any>): Record<string, any> | undefined {
  if (!details) return undefined;
  const sanitized: Record<string, any> = {};
  for (const [k, v] of Object.entries(details)) {
    const lower = k.toLowerCase();
    if (
      lower.includes('token') ||
      lower.includes('auth') ||
      lower.includes('key') ||
      lower.includes('pass') ||
      lower.includes('secret') ||
      lower.includes('cred')
    ) {
      sanitized[k] = '[REDACTED]';
    } else if (
      (lower === 'roomid' || lower === 'peerid' || lower === 'userid' || lower === 'requestid') &&
      typeof v === 'string'
    ) {
      sanitized[k] = maskIdentifier(v);
    } else if (typeof v === 'string') {
      sanitized[k] = sanitizeIp(v);
    } else if (typeof v === 'object' && v !== null) {
      sanitized[k] = sanitizeDetails(v);
    } else {
      sanitized[k] = v;
    }
  }
  return sanitized;
}

/**
 * P2P 環形記憶體日誌管理器 (FIFO Ring Buffer)
 */
export class P2PLogger {
  private static instance: P2PLogger;
  private readonly MAX_LOGS = 60;
  private buffer: P2PLogEvent[] = [];
  private candidatesCount = { host: 0, srflx: 0, relay: 0 };
  private startTime = Date.now();

  public static getInstance(): P2PLogger {
    if (!P2PLogger.instance) {
      P2PLogger.instance = new P2PLogger();
    }
    return P2PLogger.instance;
  }

  public record(
    stage: P2PLogEvent['stage'],
    event: string,
    level: P2PLogEvent['level'] = 'INFO',
    details?: Record<string, any>
  ): void {
    const cleanDetails = sanitizeDetails(details);
    const entry: P2PLogEvent = {
      timestamp: Date.now(),
      stage,
      level,
      event: sanitizeIp(event),
      details: cleanDetails
    };

    if (this.buffer.length >= this.MAX_LOGS) {
      this.buffer.shift();
    }
    this.buffer.push(entry);

    // 統計候選者類型
    if (stage === 'STUN_GATHER' && cleanDetails?.type) {
      const type = cleanDetails.type as 'host' | 'srflx' | 'relay';
      if (type in this.candidatesCount) {
        this.candidatesCount[type]++;
      }
    }
  }

  public getRecentLogs(limit: number = 30): P2PLogEvent[] {
    return this.buffer.slice(-limit);
  }

  public getCandidatesSummary() {
    return { ...this.candidatesCount };
  }

  public reset(): void {
    this.buffer = [];
    this.candidatesCount = { host: 0, srflx: 0, relay: 0 };
    this.startTime = Date.now();
  }

  /**
   * 生成 Markdown 格式連線診斷報告 (完全脫敏)
   */
  public generateMarkdownReport(params: {
    version?: string;
    roomId?: string;
    role?: 'HOST' | 'GUEST';
    status?: P2PStatus;
    retryCount?: number;
    errorCode?: string;
  }): string {
    const {
      version = APP_VERSION,
      roomId,
      role = 'GUEST',
      status = 'DISCONNECTED',
      retryCount = 0,
      errorCode = 'ERR_P2P_TIMEOUT'
    } = params;

    const logs = this.getRecentLogs(15);
    const lines = [
      '### 🛠️ Syncine P2P 連線診斷報告',
      `- **版本**: Syncine ${version} (Chrome MV3)`,
      `- **模式**: WebRTC P2P (PeerJS DataChannel)`,
      `- **角色**: ${role}`,
      `- **房間**: ${maskIdentifier(roomId)}`,
      `- **狀態**: ${status}`,
      `- **錯誤碼**: ${errorCode}`,
      `- **重試**: ${retryCount} 次重試`,
      `- **ICE 候選者收集摘要**: host: ${this.candidatesCount.host}, srflx: ${this.candidatesCount.srflx}, relay: ${this.candidatesCount.relay}`,
      '',
      '#### 📜 日誌',
      '```text'
    ];

    logs.forEach((log) => {
      const timeStr = new Date(log.timestamp).toTimeString().split(' ')[0];
      const detailsStr = log.details ? ' ' + JSON.stringify(log.details) : '';
      lines.push(`[${timeStr}] [${log.level}] [${log.stage}] ${log.event}${detailsStr}`);
    });

    lines.push('```');
    lines.push('');
    lines.push('> 💡 備註：所有 IP 位址與機敏識別碼已通過本機零洩漏演算法脫敏。');

    return lines.join('\n');
  }

  /**
   * 建立 GitHub Issue 預填跳轉網址
   */
  public generateGitHubIssueUrl(params: {
    errorCode?: string;
    markdownReport: string;
  }): string {
    const repoBase = 'https://github.com/s9000008/Syncine/issues/new';
    const code = params.errorCode || 'ERR_P2P_TIMEOUT';
    const title = `[P2P Connection] ${code} 連線異常回報`;

    const body = [
      '### 📌 問題現象描述',
      'P2P 連線失敗或逾時。',
      '',
      params.markdownReport,
      '',
      '### 🖥️ 作業系統與瀏覽器環境',
      `- 系統: ${navigator.platform || 'Windows'}`,
      `- 瀏覽器: ${navigator.userAgent.includes('Edg') ? 'Microsoft Edge' : 'Google Chrome'}`
    ].join('\n');

    const query = new URLSearchParams({
      title,
      labels: 'bug,p2p',
      body
    });

    return `${repoBase}?${query.toString()}`;
  }
}
