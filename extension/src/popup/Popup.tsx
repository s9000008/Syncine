import React, { useState, useEffect, useRef } from 'react';
import { MessageSquarePlus, Tv } from 'lucide-react';
import { RoomStateInfo, ConnectionMode, DetectedShareCodeType, getCanonicalVideoUrl } from '../types/protocol';
import {
  isPlatformActive,
  isPlatformDomainPermitted,
  isUniversalSupportedUrl,
  getPlatformByUrl,
  getHighRiskPlatform
} from '../platforms';
import { DEFAULT_SERVER_URL } from '../config';
import { useTranslation } from '../locales';
import { LanguageSelector } from '../components/LanguageSelector';
import { parseConnectionCode } from '../utils/connectionParser';
import { CHROME_STORE_URL, PLATFORM_TAB_STATUS_KEY_MAP } from './constants';
import { TabStatusBanner } from './components/TabStatusBanner';
import { DiagnosticActions } from './components/DiagnosticActions';
import { ContentionAlertBanner } from './components/ContentionAlertBanner';
import { ConnectionModeCard } from './components/ConnectionModeCard';
import { ActiveRoomPanel } from './components/ActiveRoomPanel';

export default function Popup() {
  const { t, translateReturnCode, language } = useTranslation();

  const [activeTab, setActiveTab] = useState<'create' | 'join'>('join');
  const [roomState, setRoomState] = useState<RoomStateInfo | null>(null);
  const [, setUserId] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  // 連線選項模組狀態 (預設為 P2P 端對端直連)
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>('P2P');
  const [customServerUrl, setCustomServerUrl] = useState<string>('');
  const [shareCodeInput, setShareCodeInput] = useState<string>('');
  const [compositeCode, setCompositeCode] = useState<string>('');
  const [detectedCodeInfo, setDetectedCodeInfo] = useState<{
    detectedType: DetectedShareCodeType;
    isLegacy: boolean;
  } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastErrorCode, setLastErrorCode] = useState<string | null>(null);
  const [diagnosticToast, setDiagnosticToast] = useState<boolean>(false);
  const [activeTabUrl, setActiveTabUrl] = useState<string>('');
  const [serverHealth, setServerHealth] = useState<'CHECKING' | 'ONLINE' | 'OFFLINE'>('CHECKING');
  const [candidatesUnlocked, setCandidatesUnlocked] = useState<boolean>(false);
  const [, setVersionClicks] = useState<number>(0);
  const [unlockToast, setUnlockToast] = useState<string | null>(null);
  const [isVersionHovered, setIsVersionHovered] = useState<boolean>(false);

  const versionClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unlockToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
      chrome.storage.local.get(['syncine_unlock_candidates'], (res) => {
        if (res && typeof res.syncine_unlock_candidates === 'boolean') {
          setCandidatesUnlocked(res.syncine_unlock_candidates);
        }
      });
    }
    if (typeof chrome !== 'undefined' && chrome?.storage?.onChanged) {
      const listener = (changes: any, area: string) => {
        if (area === 'local' && changes.syncine_unlock_candidates) {
          setCandidatesUnlocked(Boolean(changes.syncine_unlock_candidates.newValue));
        }
      };
      chrome.storage.onChanged.addListener(listener);
      return () => chrome.storage.onChanged.removeListener(listener);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (versionClickTimerRef.current) clearTimeout(versionClickTimerRef.current);
      if (unlockToastTimerRef.current) clearTimeout(unlockToastTimerRef.current);
    };
  }, []);

  const handleVersionTripleClick = () => {
    if (versionClickTimerRef.current) {
      clearTimeout(versionClickTimerRef.current);
      versionClickTimerRef.current = null;
    }

    setVersionClicks((prev) => {
      const next = prev + 1;
      if (next >= 3) {
        const newUnlocked = !candidatesUnlocked;
        setCandidatesUnlocked(newUnlocked);
        if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
          chrome.storage.local.set({ syncine_unlock_candidates: newUnlocked });
        }
        setUnlockToast(newUnlocked ? t.tabStatus.unlockToastOn : t.tabStatus.unlockToastOff);
        if (unlockToastTimerRef.current) clearTimeout(unlockToastTimerRef.current);
        unlockToastTimerRef.current = setTimeout(() => {
          setUnlockToast(null);
          unlockToastTimerRef.current = null;
        }, 2500);
        return 0;
      }

      versionClickTimerRef.current = setTimeout(() => {
        setVersionClicks(0);
        versionClickTimerRef.current = null;
      }, 1500);
      return next;
    });
  };

  const getVersion = (): string => {
    if (typeof chrome !== 'undefined' && chrome?.runtime?.getManifest) {
      const manifestVersion = chrome.runtime.getManifest()?.version;
      if (manifestVersion) return `v${manifestVersion}`;
    }
    return t.app.defaultVersion;
  };

  // 僅在使用者選擇「預設中繼伺服器 (DEFAULT)」時才探測官方伺服器健康狀態，杜絕非必要背景連線
  useEffect(() => {
    if (connectionMode !== 'DEFAULT') return;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);
    setServerHealth('CHECKING');

    fetch(`${DEFAULT_SERVER_URL}/health`, { signal: controller.signal })
      .then((res) => {
        setServerHealth(res.ok ? 'ONLINE' : 'OFFLINE');
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setServerHealth('OFFLINE');
        }
      })
      .finally(() => {
        clearTimeout(timeoutId);
      });

    return () => {
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, [connectionMode]);

  useEffect(() => {
    chrome.tabs?.query?.({ active: true, currentWindow: true }, (tabs) => {
      const curTab = tabs[0];
      if (curTab?.url) {
        setActiveTabUrl(curTab.url);
        if (curTab.id && (curTab.url.startsWith('http://') || curTab.url.startsWith('https://'))) {
          chrome.storage?.local?.get(['syncine_unlock_candidates'], (res) => {
            if (
              res?.syncine_unlock_candidates &&
              curTab.id &&
              curTab.url &&
              (isUniversalSupportedUrl(curTab.url) || isPlatformDomainPermitted(curTab.url))
            ) {
              chrome.tabs.sendMessage(curTab.id, { type: 'CS_PING' }, (pingRes) => {
                if (chrome.runtime.lastError || !pingRes) {
                  if ((chrome as any)?.scripting?.executeScript) {
                    (chrome as any).scripting
                      .executeScript({
                        target: { tabId: curTab.id },
                        files: ['content.js']
                      })
                      .then(() => {
                        setTimeout(() => {
                          chrome.tabs.sendMessage(curTab.id!, { type: 'CS_ACTIVATE_UNIVERSAL' }).catch(() => {});
                        }, 120);
                      })
                      .catch(() => {});
                  }
                }
              });
            }
          });
        }
      }
    });

    chrome.runtime?.sendMessage?.({ type: 'GET_ROOM_STATE' }, (res) => {
      if (res?.roomState) {
        setRoomState(res.roomState);
        if (res.roomState.compositeCode) {
          setCompositeCode(res.roomState.compositeCode);
        }
      }
      if (res?.compositeCode) {
        setCompositeCode(res.compositeCode);
      }
      if (res?.userId) {
        setUserId(res.userId);
      }
    });

    const handleMessage = (msg: any) => {
      if (msg.type === 'CS_ROOM_STATE_CHANGED') {
        setRoomState(msg.payload);
        if (msg.payload?.compositeCode) {
          setCompositeCode(msg.payload.compositeCode);
        }
      } else if (msg.type === 'CS_CONNECTION_STATUS_CHANGED') {
        if (msg.payload?.error || msg.payload?.code) {
          const code = msg.payload.code || msg.payload.error;
          setLastErrorCode(code);
          setErrorMessage(translateReturnCode(code));
        }
      }
    };
    chrome.runtime?.onMessage?.addListener(handleMessage);
    return () => {
      chrome.runtime?.onMessage?.removeListener(handleMessage);
    };
  }, [translateReturnCode]);

  const currentPlatform = getPlatformByUrl(activeTabUrl);
  const isTargetSite = isPlatformActive(activeTabUrl, candidatesUnlocked);
  const activeStatusKey = isTargetSite && currentPlatform ? PLATFORM_TAB_STATUS_KEY_MAP[currentPlatform.id] : undefined;
  let displaySiteName = currentPlatform ? currentPlatform.name : '';
  if (!displaySiteName && activeTabUrl) {
    const highRisk = getHighRiskPlatform(activeTabUrl);
    if (highRisk) {
      displaySiteName = highRisk.name;
    } else {
      try {
        const parsed = new URL(activeTabUrl);
        displaySiteName = parsed.hostname.replace(/^www\./, '');
      } catch {
        displaySiteName = 'Universal';
      }
    }
  }

  const tabStatusLabel = isTargetSite
    ? activeStatusKey
      ? t.tabStatus[activeStatusKey]
      : t.tabStatus.genericModeConnected(displaySiteName)
    : t.tabStatus.notSupported;
  const tabStatusTooltip = isTargetSite ? tabStatusLabel : t.tabStatus.supportedTooltip;

  const safeSendMessage = (message: any, callback?: (res: any) => void) => {
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      try {
        chrome.runtime.sendMessage(message, callback);
      } catch (e) {
        console.warn('[Popup] sendMessage 失敗:', e);
        if (callback) callback({ success: false, error: 'ERR_SEND_MESSAGE_FAILED' });
      }
    } else if (callback) {
      callback({ success: true, roomState: null });
    }
  };

  const handleCreateRoom = () => {
    setLoading(true);
    setErrorMessage(null);
    setLastErrorCode(null);

    let targetServerUrl = DEFAULT_SERVER_URL;
    if (connectionMode === 'CUSTOM_IP') {
      let input = customServerUrl.trim();
      if (!input) {
        setLastErrorCode('ERR_CUSTOM_IP_REQUIRED');
        setErrorMessage(translateReturnCode('ERR_CUSTOM_IP_REQUIRED'));
        setLoading(false);
        return;
      }
      if (!input.startsWith('http://') && !input.startsWith('https://')) {
        input = (input.includes('localhost') || input.includes('127.0.0.1') ? 'http://' : 'https://') + input;
      }
      targetServerUrl = input;
    }

    const isValidWebUrl = activeTabUrl && (activeTabUrl.startsWith('http://') || activeTabUrl.startsWith('https://'));
    safeSendMessage(
      {
        type: 'BG_CREATE_ROOM',
        payload: {
          currentUrl: isValidWebUrl ? getCanonicalVideoUrl(activeTabUrl) : '',
          mode: connectionMode,
          customServerUrl: connectionMode === 'CUSTOM_IP' ? targetServerUrl : undefined,
          language,
          allowUniversal: candidatesUnlocked
        }
      },
      (res) => {
        setLoading(false);
        if (res?.success) {
          setRoomState(res.roomState);
          setCompositeCode(res.compositeCode);
        } else {
          const code = res?.code || res?.error || 'ERR_P2P_SIGNAL_FAILED';
          setLastErrorCode(code);
          setErrorMessage(translateReturnCode(code, t.returnCodes.ERR_P2P_SIGNAL_FAILED));
        }
      }
    );
  };

  const handleShareCodeChange = (input: string) => {
    setShareCodeInput(input);
    if (errorMessage) {
      setErrorMessage(null);
      setLastErrorCode(null);
    }
    if (!input.trim()) {
      setDetectedCodeInfo(null);
      return;
    }

    const parsed = parseConnectionCode(input, connectionMode, DEFAULT_SERVER_URL);
    setDetectedCodeInfo({
      detectedType: parsed.detectedType,
      isLegacy: parsed.isLegacy
    });

    if (parsed.detectedType === 'P2P') {
      if (connectionMode !== 'P2P') setConnectionMode('P2P');
    } else if (parsed.detectedType === 'DEFAULT') {
      if (connectionMode !== 'DEFAULT') setConnectionMode('DEFAULT');
    } else if (parsed.detectedType === 'CUSTOM_IP' || parsed.detectedType === 'LEGACY_COMPOSITE') {
      if (parsed.mode === 'CUSTOM_IP') {
        if (connectionMode !== 'CUSTOM_IP') setConnectionMode('CUSTOM_IP');
        if (parsed.serverUrl && parsed.serverUrl !== DEFAULT_SERVER_URL) {
          setCustomServerUrl(parsed.serverUrl);
        }
      } else if (parsed.mode === 'DEFAULT') {
        if (connectionMode !== 'DEFAULT') setConnectionMode('DEFAULT');
      }
    }
  };

  const handleJoinRoom = () => {
    const input = shareCodeInput.trim();
    if (!input) return;

    const parsed = parseConnectionCode(input, connectionMode, DEFAULT_SERVER_URL);
    if (!parsed.roomId || !/^[A-Z0-9]{6}$/i.test(parsed.roomId)) {
      setLastErrorCode('ERR_INVALID_CODE');
      setErrorMessage(translateReturnCode('ERR_INVALID_CODE'));
      return;
    }

    setLoading(true);
    setErrorMessage(null);
    setLastErrorCode(null);

    safeSendMessage(
      {
        type: 'BG_JOIN_ROOM',
        payload: { shareCode: input, mode: parsed.mode }
      },
      (res) => {
        setLoading(false);
        if (res?.success) {
          setRoomState(res.roomState);
        } else {
          const code = res?.code || res?.error || 'ERR_INVALID_CODE';
          setLastErrorCode(code);
          setErrorMessage(translateReturnCode(code, t.returnCodes.ERR_INVALID_CODE));
        }
      }
    );
  };

  const handleApproveRequest = (requestId: string) => {
    safeSendMessage({ type: 'BG_APPROVE_JOIN_REQUEST', payload: { requestId } });
  };

  const handleRejectRequest = (requestId: string) => {
    safeSendMessage({ type: 'BG_REJECT_JOIN_REQUEST', payload: { requestId } });
  };

  const handleApproveAll = () => {
    if (!roomState?.pendingJoinRequests) return;
    roomState.pendingJoinRequests.forEach((req) => handleApproveRequest(req.requestId));
  };

  const handleLeaveRoom = () => {
    safeSendMessage({ type: 'BG_LEAVE_ROOM' }, () => {
      setRoomState(null);
      setCompositeCode('');
      setShareCodeInput('');
      setActiveTab('join');
    });
  };

  const handleTogglePermission = (allow: boolean) => {
    safeSendMessage({ type: 'BG_TOGGLE_PERMISSION', payload: { allowGuestControl: allow } }, () => {
      if (roomState) {
        setRoomState({ ...roomState, allowGuestControl: allow });
      }
    });
  };

  const handleSyncCurrentTab = () => {
    if (!activeTabUrl || (!activeTabUrl.startsWith('http://') && !activeTabUrl.startsWith('https://'))) return;
    safeSendMessage({
      type: 'BG_REDIRECT_ROOM',
      payload: {
        targetUrl: getCanonicalVideoUrl(activeTabUrl),
        allowUniversal: candidatesUnlocked
      }
    });
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const fetchDiagnosticReport = (
    callback: (data: { markdownReport: string; githubIssueUrl: string }) => void,
    overrideErrorCode?: string
  ) => {
    const effectiveCode =
      overrideErrorCode ||
      lastErrorCode ||
      (roomState?.playbackConflict?.detected ? 'ERR_PLAYBACK_CONTENTION' : undefined);

    safeSendMessage(
      {
        type: 'GET_DIAGNOSTIC_REPORT',
        payload: { errorCode: effectiveCode }
      },
      (res) => {
        if (res?.success && res.data) {
          callback(res.data);
        } else {
          const fallbackCode = effectiveCode || 'ERR_UNKNOWN';
          const fallbackDetail = errorMessage || translateReturnCode(fallbackCode);
          const conflictLine = roomState?.playbackConflict?.detected
            ? `- **Playback Contention**: ${roomState.playbackConflict.hostname} (${roomState.playbackConflict.reversalCount} reversals)`
            : null;
          const fallbackReport = [
            t.roomUi.diagnosticFallbackTitle,
            `- **${t.roomUi.diagnosticVersionLabel}**: Syncine ${getVersion()} (Chrome MV3)`,
            `- **${t.roomUi.diagnosticModeLabel}**: ${connectionMode}`,
            `- **${t.roomUi.diagnosticErrorCodeLabel}**: ${fallbackCode}`,
            ...(conflictLine ? [conflictLine] : []),
            `- **${t.roomUi.diagnosticTimestampLabel}**: ${new Date().toISOString()}`,
            '',
            `> 💡 ${t.roomUi.diagnosticDetailPrefix}: ${fallbackDetail}`
          ].join('\n');
          const repoBase = 'https://github.com/s9000008/Syncine/issues/new';
          const query = new URLSearchParams({
            title: `[Connection Issue] ${fallbackCode}`,
            labels: fallbackCode === 'ERR_PLAYBACK_CONTENTION' ? 'bug,compatibility' : 'bug,p2p',
            body: fallbackReport
          });
          callback({
            markdownReport: fallbackReport,
            githubIssueUrl: `${repoBase}?${query.toString()}`
          });
        }
      }
    );
  };

  const handleCopyContentionReport = () => {
    fetchDiagnosticReport((data) => {
      navigator.clipboard?.writeText(data.markdownReport).catch(() => {});
    }, 'ERR_PLAYBACK_CONTENTION');
  };

  const handleReportContentionGithub = () => {
    fetchDiagnosticReport((data) => {
      chrome.tabs?.create?.({ url: data.githubIssueUrl });
    }, 'ERR_PLAYBACK_CONTENTION');
  };

  const handleDismissContention = () => {
    safeSendMessage({ type: 'BG_DISMISS_PLAYBACK_CONFLICT' }, () => {
      setRoomState((prev) =>
        prev?.playbackConflict
          ? { ...prev, playbackConflict: { ...prev.playbackConflict, dismissed: true } }
          : prev
      );
    });
  };

  const handleReportToGitHub = () => {
    fetchDiagnosticReport(({ markdownReport, githubIssueUrl }) => {
      navigator.clipboard.writeText(markdownReport).catch(() => {});
      chrome.tabs?.create?.({ url: githubIssueUrl });
      setDiagnosticToast(true);
      setTimeout(() => setDiagnosticToast(false), 3000);
    });
  };

  const handleCopyDiagnosticReport = () => {
    fetchDiagnosticReport(({ markdownReport }) => {
      navigator.clipboard.writeText(markdownReport).then(() => {
        setDiagnosticToast(true);
        setTimeout(() => setDiagnosticToast(false), 2500);
      });
    });
  };

  const currentFooterMode = roomState ? roomState.mode : connectionMode;

  return (
    <div className="w-[380px] bg-slate-900 text-slate-100 p-4 font-sans border border-slate-800 rounded-xl shadow-2xl flex flex-col justify-between min-h-[460px]">
      <div>
        <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-3 gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-2 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl text-white shadow-lg shadow-emerald-500/25 flex-shrink-0">
              <Tv className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <h1 className="font-bold text-base tracking-wide bg-gradient-to-r from-emerald-400 via-teal-300 to-sky-300 bg-clip-text text-transparent truncate">
                  {t.app.name}
                </h1>
                <span
                  onClick={handleVersionTripleClick}
                  onMouseEnter={() => setIsVersionHovered(true)}
                  onMouseLeave={() => setIsVersionHovered(false)}
                  data-testid="version-badge"
                  className={`px-1.5 py-0.5 text-[9px] font-semibold rounded bg-slate-800 border flex-shrink-0 cursor-pointer select-none transition ${
                    candidatesUnlocked
                      ? 'text-amber-300 border-amber-500/80 shadow-[0_0_8px_rgba(245,158,11,0.4)]'
                      : 'text-slate-300 border-slate-700 hover:border-amber-400/60 hover:text-amber-200'
                  }`}
                  title={candidatesUnlocked ? t.tabStatus.unlockBadgeTooltip : t.tabStatus.versionHoverHint}
                >
                  {getVersion()}
                </span>
              </div>
              {isVersionHovered ? (
                <p
                  data-testid="version-hover-hint"
                  className="text-[10px] text-amber-300 flex items-center gap-1 mt-0.5 truncate animate-fade-in"
                >
                  <span className="truncate">
                    {candidatesUnlocked ? t.tabStatus.unlockBadgeTooltip : t.tabStatus.versionHoverHint}
                  </span>
                </p>
              ) : (
                <p className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5">
                  <span
                    className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                      roomState?.connectionStatus === 'RECONNECTING'
                        ? 'bg-amber-400 animate-ping'
                        : roomState?.connectionStatus === 'DISCONNECTED'
                        ? 'bg-rose-500'
                        : 'bg-emerald-400 animate-pulse'
                    }`}
                  ></span>
                  <span
                    className="truncate"
                    title={
                      roomState?.connectionStatus === 'RECONNECTING'
                        ? t.connectionStatus.reconnecting
                        : roomState?.connectionStatus === 'DISCONNECTED'
                        ? t.connectionStatus.disconnected
                        : t.connectionStatus.ready
                    }
                  >
                    {roomState?.connectionStatus === 'RECONNECTING'
                      ? t.connectionStatus.reconnecting
                      : roomState?.connectionStatus === 'DISCONNECTED'
                      ? t.connectionStatus.disconnected
                      : t.connectionStatus.ready}
                  </span>
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5 flex-shrink-0">
            <LanguageSelector />
            {roomState && (
              <span
                className={`px-2.5 py-1 text-xs font-semibold rounded-full border shadow-sm ${
                  roomState.isHost
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                    : 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30'
                }`}
              >
                {roomState.isHost ? t.roles.host : t.roles.guest}
              </span>
            )}
          </div>
        </div>

        <TabStatusBanner
          unlockToast={unlockToast}
          roomState={roomState}
          isTargetSite={isTargetSite}
          currentPlatformId={currentPlatform?.id}
          candidatesUnlocked={candidatesUnlocked}
          tabStatusLabel={tabStatusLabel}
          tabStatusTooltip={tabStatusTooltip}
          bannersText={{
            reconnecting: t.banners.reconnecting,
            disconnected: t.banners.disconnected
          }}
          tabBadgeText={{
            supported: t.tabStatus.supportBadge,
            unsupported: t.tabStatus.unsupportedBadge,
            supportedListBtn: t.tabStatus.supportedListBtn,
            supportedListTitle: t.tabStatus.supportedListTitle,
            supportedListUniversalNote: t.tabStatus.supportedListUniversalNote,
            supportedListUniversalActive: t.tabStatus.supportedListUniversalActive
          }}
        />

        <DiagnosticActions
          errorMessage={errorMessage}
          lastErrorCode={lastErrorCode}
          diagnosticToast={diagnosticToast}
          onDismiss={() => {
            setErrorMessage(null);
            setLastErrorCode(null);
          }}
          onReportToGitHub={handleReportToGitHub}
          onCopyDiagnosticReport={handleCopyDiagnosticReport}
          labels={{
            reportIssueGithub: t.roomUi.reportIssueGithub,
            copyDiagnosticReport: t.roomUi.copyDiagnosticReport,
            reportCopiedToast: t.roomUi.reportCopiedToast
          }}
        />

        {!roomState ? (
          <ConnectionModeCard
            activeTab={activeTab}
            onTabChange={(tab) => {
              setActiveTab(tab);
              setErrorMessage(null);
              setLastErrorCode(null);
            }}
            connectionMode={connectionMode}
            onConnectionModeChange={setConnectionMode}
            customServerUrl={customServerUrl}
            onCustomServerUrlChange={setCustomServerUrl}
            shareCodeInput={shareCodeInput}
            onShareCodeChange={handleShareCodeChange}
            detectedCodeInfo={detectedCodeInfo}
            serverHealth={serverHealth}
            loading={loading}
            onJoinRoom={handleJoinRoom}
            onCreateRoom={handleCreateRoom}
            t={t}
          />
        ) : (
          <div className="space-y-3">
            {roomState.playbackConflict?.detected && !roomState.playbackConflict.dismissed && (
              <ContentionAlertBanner
                conflict={roomState.playbackConflict}
                onCopyReport={handleCopyContentionReport}
                onReportGithub={handleReportContentionGithub}
                onDismiss={handleDismissContention}
                t={t}
              />
            )}
            <ActiveRoomPanel
              roomState={roomState}
              compositeCode={compositeCode}
              connectionMode={connectionMode}
              customServerUrl={customServerUrl}
              copied={copied}
              onCopyCode={copyToClipboard}
              onApproveRequest={handleApproveRequest}
              onRejectRequest={handleRejectRequest}
              onApproveAll={handleApproveAll}
              onTogglePermission={handleTogglePermission}
              onSyncCurrentTab={handleSyncCurrentTab}
              onLeaveRoom={handleLeaveRoom}
              t={t}
            />
          </div>
        )}
      </div>

      <div className="mt-4 pt-2.5 border-t border-slate-800/80 text-center text-[10px] text-slate-500 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={handleReportToGitHub}
            className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-emerald-300 transition px-2 py-0.5 rounded bg-slate-800/90 hover:bg-slate-700/90 border border-slate-700/60 cursor-pointer flex-shrink-0 shadow-sm"
            title={t.roomUi.footerFeedbackTooltip}
          >
            <MessageSquarePlus className="w-3 h-3 text-slate-400" />
            <span>{t.roomUi.footerFeedbackBtn}</span>
          </button>

          <span
            className="cursor-pointer hover:text-slate-300 transition truncate text-[10px] text-slate-500"
            title={t.tabStatus.supportedTooltip}
            onClick={() => chrome.tabs?.create?.({ url: CHROME_STORE_URL })}
          >
            {t.app.engineLabel}
          </span>
        </div>

        <span className="font-mono text-emerald-400 font-semibold text-[10px] flex-shrink-0">
          {t.connectionModes.footerPrefix}
          {currentFooterMode === 'P2P'
            ? t.connectionModes.p2p.footerLabel
            : currentFooterMode === 'CUSTOM_IP'
            ? t.connectionModes.customIp.footerLabel
            : t.connectionModes.default.footerLabel}
        </span>
      </div>
    </div>
  );
}
