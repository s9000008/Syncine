import React, { useState, useEffect } from 'react';
import {
  Tv,
  Users,
  Copy,
  Check,
  Shield,
  Server,
  LogOut,
  ExternalLink,
  Loader2,
  Plus,
  ChevronDown,
  Video,
  Zap,
  Bell,
  UserCheck,
  UserX,
  Clock
} from 'lucide-react';
import { RoomStateInfo, ConnectionMode } from '../types/protocol';
import { DEFAULT_SERVER_URL } from '../config';
import { useTranslation } from '../locales';
import { LanguageSelector } from '../components/LanguageSelector';

export default function Popup() {
  const { t, translateReturnCode } = useTranslation();

  const [activeTab, setActiveTab] = useState<'create' | 'join'>('create');
  const [roomState, setRoomState] = useState<RoomStateInfo | null>(null);
  const [userId, setUserId] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  // 連線選項模組狀態 (預設為 P2P 端對端直連)
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>('P2P');
  const [customServerUrl, setCustomServerUrl] = useState<string>('');
  const [shareCodeInput, setShareCodeInput] = useState<string>('');
  const [compositeCode, setCompositeCode] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeTabUrl, setActiveTabUrl] = useState<string>('');
  const [serverHealth, setServerHealth] = useState<'CHECKING' | 'ONLINE' | 'OFFLINE'>('CHECKING');

  const getVersion = (): string => {
    if (typeof chrome !== 'undefined' && chrome?.runtime?.getManifest) {
      const manifestVersion = chrome.runtime.getManifest()?.version;
      if (manifestVersion) return `v${manifestVersion}`;
    }
    return t.app.defaultVersion;
  };

  useEffect(() => {
    // 探測官方中繼伺服器 /health 連線健康狀態
    fetch(`${DEFAULT_SERVER_URL}/health`, { signal: AbortSignal.timeout(4000) })
      .then((res) => {
        if (res.ok) setServerHealth('ONLINE');
        else setServerHealth('OFFLINE');
      })
      .catch(() => {
        setServerHealth('OFFLINE');
      });

    // 獲取當前分頁網址
    chrome.tabs?.query?.({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.url) {
        setActiveTabUrl(tabs[0].url);
      }
    });

    // 獲取房間狀態
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

    // 監聽房間狀態即時變更
    const handleMessage = (msg: any) => {
      if (msg.type === 'CS_ROOM_STATE_CHANGED') {
        setRoomState(msg.payload);
        if (msg.payload?.compositeCode) {
          setCompositeCode(msg.payload.compositeCode);
        }
      }
    };
    chrome.runtime?.onMessage?.addListener(handleMessage);
    return () => {
      chrome.runtime?.onMessage?.removeListener(handleMessage);
    };
  }, []);

  const isYouTube = activeTabUrl.includes('youtube.com/watch');
  const isBilibili = activeTabUrl.includes('bilibili.com/video') || activeTabUrl.includes('bilibili.com/bangumi');
  const isTargetSite = isYouTube || isBilibili;

  const safeSendMessage = (message: any, callback?: (res: any) => void) => {
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      try {
        chrome.runtime.sendMessage(message, callback);
      } catch (e) {
        console.warn('[Popup] sendMessage 失敗:', e);
        if (callback) callback({ success: false, error: 'ERR_SEND_MESSAGE_FAILED' });
      }
    } else {
      console.log('[Popup Dev/Preview] 模擬 sendMessage 回應:', message);
      if (callback) callback({ success: true, roomState: null });
    }
  };

  // ----------------------------------------------------
  // 1. 建房處理 (支援同一邀請碼邀請多人群體加入)
  // ----------------------------------------------------
  const handleCreateRoom = () => {
    setLoading(true);
    setErrorMessage(null);

    let targetServerUrl = DEFAULT_SERVER_URL;
    if (connectionMode === 'CUSTOM_IP') {
      let input = customServerUrl.trim();
      if (!input) {
        setErrorMessage(translateReturnCode('ERR_CUSTOM_IP_REQUIRED'));
        setLoading(false);
        return;
      }
      // 自動補齊協定，若為 localhost 補 http://，否則一律自動補上 https://
      if (!input.startsWith('http://') && !input.startsWith('https://')) {
        input = (input.includes('localhost') || input.includes('127.0.0.1') ? 'http://' : 'https://') + input;
      }
      targetServerUrl = input;
    }

    safeSendMessage(
      {
        type: 'BG_CREATE_ROOM',
        payload: {
          currentUrl: activeTabUrl,
          mode: connectionMode,
          customServerUrl: connectionMode === 'CUSTOM_IP' ? targetServerUrl : undefined
        }
      },
      (res) => {
        setLoading(false);
        if (res?.success) {
          setRoomState(res.roomState);
          setCompositeCode(res.compositeCode);
        } else {
          setErrorMessage(translateReturnCode(res?.code || res?.error, t.returnCodes.ERR_P2P_SIGNAL_FAILED));
        }
      }
    );
  };

  // ----------------------------------------------------
  // 2. 加房處理 (貼入同一組邀請碼即可送出審核申請)
  // ----------------------------------------------------
  const handleJoinRoom = () => {
    const input = shareCodeInput.trim();
    if (!input) {
      setErrorMessage(translateReturnCode('ERR_INVALID_CODE'));
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    safeSendMessage(
      {
        type: 'BG_JOIN_ROOM',
        payload: { shareCode: input, mode: connectionMode }
      },
      (res) => {
        setLoading(false);
        if (res?.success) {
          setRoomState(res.roomState);
        } else {
          setErrorMessage(translateReturnCode(res?.code || res?.error, t.returnCodes.ERR_INVALID_CODE));
        }
      }
    );
  };

  // ----------------------------------------------------
  // 3. 房主審核處理 (批准 / 拒絕入房申請)
  // ----------------------------------------------------
  const handleApproveRequest = (requestId: string) => {
    safeSendMessage({
      type: 'BG_APPROVE_JOIN_REQUEST',
      payload: { requestId }
    });
  };

  const handleRejectRequest = (requestId: string) => {
    safeSendMessage({
      type: 'BG_REJECT_JOIN_REQUEST',
      payload: { requestId }
    });
  };

  const handleApproveAll = () => {
    if (!roomState?.pendingJoinRequests) return;
    roomState.pendingJoinRequests.forEach((req) => {
      handleApproveRequest(req.requestId);
    });
  };

  // ----------------------------------------------------
  // 4. 房內操作與控制
  // ----------------------------------------------------
  const handleLeaveRoom = () => {
    safeSendMessage({ type: 'BG_LEAVE_ROOM' }, () => {
      setRoomState(null);
      setCompositeCode('');
      setShareCodeInput('');
      setActiveTab('create');
    });
  };

  const handleTogglePermission = (allow: boolean) => {
    safeSendMessage(
      {
        type: 'BG_TOGGLE_PERMISSION',
        payload: { allowGuestControl: allow }
      },
      () => {
        if (roomState) {
          setRoomState({ ...roomState, allowGuestControl: allow });
        }
      }
    );
  };

  const handleSyncCurrentTab = () => {
    if (!activeTabUrl) return;
    safeSendMessage({
      type: 'BG_REDIRECT_ROOM',
      payload: { targetUrl: activeTabUrl }
    });
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const pendingRequests = roomState?.pendingJoinRequests || [];
  const isGuestWaitingApproval = roomState && !roomState.isHost && roomState.guestAwaitingApproval;
  const currentMemberCount = roomState?.connectedPeerCount || 1;

  return (
    <div className="w-[380px] bg-slate-900 text-slate-100 p-4 font-sans border border-slate-800 rounded-xl shadow-2xl flex flex-col justify-between min-h-[480px]">
      {/* 頂部 Header */}
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
                <span className="px-1.5 py-0.5 text-[9px] font-semibold rounded bg-slate-800 text-slate-300 border border-slate-700 flex-shrink-0">
                  {getVersion()}
                </span>
              </div>
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
                <span className="truncate">
                  {roomState?.connectionStatus === 'RECONNECTING'
                    ? t.connectionStatus.reconnecting
                    : roomState?.connectionStatus === 'DISCONNECTED'
                    ? t.connectionStatus.disconnected
                    : t.connectionStatus.ready}
                </span>
              </p>
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

        {/* 斷線與自動重連回魂中醒目橫幅 */}
        {roomState && roomState.connectionStatus && roomState.connectionStatus !== 'CONNECTED' && (
          <div
            className={`mb-3 p-2.5 rounded-lg text-xs flex items-center gap-2 border shadow-sm ${
              roomState.connectionStatus === 'RECONNECTING'
                ? 'bg-amber-950/40 text-amber-300 border-amber-600/50'
                : 'bg-rose-950/40 text-rose-300 border-rose-600/50'
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full flex-shrink-0 ${
                roomState.connectionStatus === 'RECONNECTING' ? 'bg-amber-400 animate-ping' : 'bg-rose-400'
              }`}
            />
            <span className="leading-snug">
              {roomState.connectionStatus === 'RECONNECTING'
                ? t.banners.reconnecting
                : t.banners.disconnected}
            </span>
          </div>
        )}

        {/* 當前分頁狀態提示條 */}
        <div
          className={`mb-2 p-2 rounded-lg text-[11px] flex items-center justify-between border ${
            isTargetSite
              ? 'bg-emerald-950/40 text-emerald-300 border-emerald-800/50'
              : 'bg-amber-950/30 text-amber-300 border-amber-800/40'
          }`}
        >
          <div className="flex items-center gap-1.5 truncate max-w-[280px]">
            <Video className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="truncate">
              {isYouTube
                ? t.tabStatus.youtubeConnected
                : isBilibili
                ? t.tabStatus.bilibiliConnected
                : t.tabStatus.notSupported}
            </span>
          </div>
          {isTargetSite && (
            <span className="text-[10px] text-emerald-400 font-semibold bg-emerald-900/60 px-1.5 py-0.5 rounded border border-emerald-700/50">
              {t.tabStatus.supportBadge}
            </span>
          )}
        </div>

        {/* 建議僅開啟單一分頁防護提示 */}
        <div className="mb-3 px-2.5 py-1.5 bg-slate-900/90 rounded-lg border border-slate-800 text-[10px] text-slate-400 flex items-center gap-1.5">
          <span className="text-amber-400 font-bold flex-shrink-0">{t.tabStatus.hintPrefix}</span>
          <span className="truncate">{t.tabStatus.singleTabHint}</span>
        </div>

        {/* 錯誤提示 */}
        {errorMessage && (
          <div className="mb-3 p-2.5 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-xs flex items-center justify-between">
            <span className="leading-relaxed">{errorMessage}</span>
            <button onClick={() => setErrorMessage(null)} className="text-red-400 hover:text-red-300 px-1 font-bold">
              ✕
            </button>
          </div>
        )}

        {/* ---------------------------------------------------- */}
        {/* 情境 A: 觀眾送出申請，等待房主審核中                 */}
        {/* ---------------------------------------------------- */}
        {isGuestWaitingApproval ? (
          <div className="space-y-3.5 bg-slate-800/90 p-5 rounded-xl border border-teal-500/50 shadow-xl text-center">
            <div className="w-12 h-12 bg-teal-500/10 rounded-full flex items-center justify-center mx-auto border border-teal-500/30">
              <Loader2 className="w-6 h-6 animate-spin text-teal-400" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-teal-300">{t.roomUi.awaitingTitle}</h3>
              <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                {t.roomUi.awaitingDesc}
              </p>
            </div>
            <div className="p-2.5 bg-slate-900/80 rounded-lg border border-slate-700 text-xs font-mono text-slate-400 flex items-center justify-center gap-2">
              <Clock className="w-3.5 h-3.5 text-teal-400" />
              <span>{t.roomUi.roomCodeLabel}: <strong className="text-teal-300">{roomState.roomId}</strong></span>
            </div>
            <button
              onClick={handleLeaveRoom}
              className="w-full text-center text-xs text-slate-400 hover:text-red-400 pt-1 cursor-pointer"
            >
              {t.roomUi.cancelAndBack}
            </button>
          </div>
        ) : !roomState ? (
          /* ---------------------------------------------------- */
          /* 情境 B: 未進入房間 (連線選項模組化面板)              */
          /* ---------------------------------------------------- */
          <div>
            {/* 分頁切換按鈕 */}
            <div className="grid grid-cols-2 p-1 bg-slate-950/60 rounded-xl border border-slate-800 mb-3.5">
              <button
                onClick={() => {
                  setActiveTab('create');
                  setErrorMessage(null);
                }}
                className={`py-2 text-xs font-semibold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                  activeTab === 'create'
                    ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30 font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Plus className="w-3.5 h-3.5" />
                {t.roomUi.createTab}
              </button>

              <button
                onClick={() => {
                  setActiveTab('join');
                  setErrorMessage(null);
                }}
                className={`py-2 text-xs font-semibold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                  activeTab === 'join'
                    ? 'bg-teal-600 text-white shadow-md shadow-teal-600/30 font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Users className="w-3.5 h-3.5" />
                {t.roomUi.joinTab}
              </button>
            </div>

            {/* TAB 1: 建立房間面板 */}
            {activeTab === 'create' && (
              <div className="space-y-3 bg-slate-800/50 p-3.5 rounded-xl border border-slate-700/60">
                <div>
                  <label className="text-[11px] font-semibold text-slate-300 block mb-1.5 flex items-center justify-between">
                    <span className="flex items-center gap-1">
                      <Server className="w-3.5 h-3.5 text-emerald-400" />
                      {t.connectionModes.modeLabel}
                    </span>
                  </label>

                  <div className="relative">
                    <select
                      value={connectionMode}
                      onChange={(e) => setConnectionMode(e.target.value as ConnectionMode)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-emerald-500 transition appearance-none cursor-pointer pr-8"
                    >
                      <option value="P2P">{t.connectionModes.p2p.selectOptionCreate}</option>
                      <option value="DEFAULT">{t.connectionModes.default.selectOption}</option>
                      <option value="CUSTOM_IP">{t.connectionModes.customIp.selectOption}</option>
                    </select>
                    <ChevronDown className="w-4 h-4 text-slate-400 absolute right-2.5 top-2.5 pointer-events-none" />
                  </div>
                </div>

                {/* 模式說明卡片 */}
                {connectionMode === 'P2P' && (
                  <div className="p-2.5 bg-emerald-950/30 border border-emerald-800/50 rounded-lg space-y-1.5">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-emerald-400 font-semibold flex items-center gap-1">
                        <Zap className="w-3.5 h-3.5" /> {t.connectionModes.p2p.cardTitle}
                      </span>
                      <span className="text-[10px] text-emerald-300 bg-emerald-900/60 px-1.5 py-0.5 rounded border border-emerald-700/50">
                        {t.connectionModes.p2p.cardBadge}
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-300 leading-relaxed">
                      {t.connectionModes.p2p.description}
                    </p>
                    <div className="text-[10px] text-amber-300/90 bg-amber-950/40 p-1.5 rounded border border-amber-800/40 mt-1 flex items-start gap-1">
                      <span className="flex-shrink-0">💡</span>
                      <span>{t.connectionModes.p2p.fallbackHint}</span>
                    </div>
                  </div>
                )}

                {connectionMode === 'DEFAULT' && (
                  <div className="p-2.5 bg-slate-950/70 border border-slate-800 rounded-lg space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-400">{t.connectionModes.default.serverStatusLabel}</span>
                      <span
                        className={`text-[10px] font-semibold flex items-center gap-1 ${
                          serverHealth === 'ONLINE'
                            ? 'text-emerald-400'
                            : serverHealth === 'OFFLINE'
                            ? 'text-rose-400'
                            : 'text-amber-400'
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            serverHealth === 'ONLINE'
                              ? 'bg-emerald-400 animate-pulse'
                              : serverHealth === 'OFFLINE'
                              ? 'bg-rose-500'
                              : 'bg-amber-400 animate-ping'
                          }`}
                        ></span>
                        {serverHealth === 'ONLINE'
                          ? t.connectionModes.default.serverOnline
                          : serverHealth === 'OFFLINE'
                          ? t.connectionModes.default.serverOffline
                          : t.connectionModes.default.serverProbing}
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-400">
                      {t.connectionModes.default.description}
                    </p>
                  </div>
                )}

                {connectionMode === 'CUSTOM_IP' && (
                  <div className="p-2.5 bg-slate-950/70 border border-blue-900/40 rounded-lg space-y-1.5">
                    <label className="text-[11px] text-slate-300 block font-medium">
                      {t.connectionModes.customIp.inputLabel}
                    </label>
                    <input
                      type="text"
                      placeholder={t.connectionModes.customIp.inputPlaceholder}
                      value={customServerUrl}
                      onChange={(e) => setCustomServerUrl(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500 transition"
                    />
                  </div>
                )}

                {/* 建立按鈕 */}
                <button
                  id="btn-create-room"
                  onClick={handleCreateRoom}
                  disabled={loading}
                  className="w-full mt-2 py-2.5 px-4 bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold rounded-xl text-xs shadow-lg shadow-emerald-600/30 transition-all flex items-center justify-center gap-2 border border-emerald-400/30 cursor-pointer disabled:opacity-50"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>{t.roomUi.creatingRoom}</span>
                    </>
                  ) : (
                    <>
                      <Zap className="w-4 h-4" />
                      <span className="text-sm">
                        {connectionMode === 'P2P' ? t.connectionModes.p2p.btnCreate : t.connectionModes.default.btnCreate}
                      </span>
                    </>
                  )}
                </button>
              </div>
            )}

            {/* TAB 2: 加入房間面板 */}
            {activeTab === 'join' && (
              <div className="space-y-3 bg-slate-800/50 p-3.5 rounded-xl border border-slate-700/60">
                {/* 當前連線方式狀態指示與即時切換區 */}
                <div className="p-2.5 bg-slate-950/80 rounded-xl border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5">
                      <Server className="w-3.5 h-3.5 text-teal-400" />
                      {t.connectionModes.modeLabel}:
                    </span>
                    <span className="text-[10px] text-teal-400 font-medium">{t.connectionModes.switchableHint}</span>
                  </div>

                  <div className="relative">
                    <select
                      value={connectionMode}
                      onChange={(e) => setConnectionMode(e.target.value as ConnectionMode)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-teal-500 transition appearance-none cursor-pointer pr-8 font-medium"
                    >
                      <option value="P2P">{t.connectionModes.p2p.selectOptionJoin}</option>
                      <option value="DEFAULT">{t.connectionModes.default.selectOption}</option>
                      <option value="CUSTOM_IP">{t.connectionModes.customIp.selectOption}</option>
                    </select>
                    <ChevronDown className="w-4 h-4 text-slate-400 absolute right-2.5 top-2 pointer-events-none" />
                  </div>

                  {/* 當前模式專屬狀態反饋與指引 */}
                  {connectionMode === 'P2P' && (
                    <div className="text-[10px] text-emerald-400/90 flex items-center gap-1 pt-0.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                      <span>{t.connectionModes.p2p.joinFeedback}</span>
                    </div>
                  )}
                  {connectionMode === 'DEFAULT' && (
                    <div className="text-[10px] text-teal-400/90 flex items-center justify-between pt-0.5">
                      <span className="flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-pulse"></span>
                        <span>{t.connectionModes.default.joinFeedback}</span>
                      </span>
                      <span className="text-[9px] text-slate-400">
                        {serverHealth === 'ONLINE'
                          ? `🟢 ${t.connectionModes.default.serverOnline}`
                          : serverHealth === 'OFFLINE'
                          ? `🔴 ${t.connectionModes.default.serverOffline}`
                          : `🟡 ${t.connectionModes.default.serverProbing}`}
                      </span>
                    </div>
                  )}
                  {connectionMode === 'CUSTOM_IP' && (
                    <div className="text-[10px] text-blue-400/90 flex items-center gap-1 pt-0.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse"></span>
                      <span>{t.connectionModes.customIp.joinFeedback}</span>
                    </div>
                  )}
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-slate-300 block mb-1.5 flex items-center gap-1">
                    <Users className="w-3.5 h-3.5 text-teal-400" />
                    {t.roomUi.pasteCodeLabel}
                  </label>
                  <input
                    type="text"
                    placeholder={
                      connectionMode === 'P2P'
                        ? t.connectionModes.p2p.placeholder
                        : connectionMode === 'CUSTOM_IP'
                        ? t.connectionModes.customIp.placeholder
                        : t.connectionModes.default.placeholder
                    }
                    value={shareCodeInput}
                    onChange={(e) => setShareCodeInput(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-teal-500 transition font-mono tracking-wider"
                  />
                  <p className="text-[10px] text-slate-400 mt-1">
                    {connectionMode === 'P2P'
                      ? t.connectionModes.p2p.inputHint
                      : connectionMode === 'CUSTOM_IP'
                      ? t.connectionModes.customIp.inputHint
                      : t.connectionModes.default.inputHint}
                  </p>

                  <button
                    id="btn-join-room"
                    onClick={handleJoinRoom}
                    disabled={loading}
                    className="w-full mt-3 py-2.5 px-4 bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white font-bold rounded-xl text-xs shadow-lg shadow-teal-600/30 transition-all flex items-center justify-center gap-2 border border-teal-400/30 cursor-pointer disabled:opacity-50"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>{t.roomUi.joiningRoom}</span>
                      </>
                    ) : (
                      <>
                        <Zap className="w-4 h-4" />
                        <span className="text-sm">{t.roomUi.btnJoin}</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* ---------------------------------------------------- */
          /* 情境 C: 統一觀影操作模組 (全模式通用，每30秒動態校準) */
          /* ---------------------------------------------------- */
          <div className="space-y-3">
            {/* 1. 統一頂部房間資訊卡片 */}
            <div className="bg-slate-800/80 p-3.5 rounded-xl border border-slate-700 space-y-2.5 shadow-xl">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[10px] text-slate-400 uppercase tracking-wider font-bold">
                    {t.roomUi.roomCodeLabel}
                  </span>
                  <p className="text-2xl font-mono font-extrabold text-emerald-400 tracking-wider mt-0.5">
                    {roomState.roomId}
                  </p>
                </div>

                {/* 複製分享碼按鈕 */}
                <button
                  id="btn-copy-room-code"
                  onClick={() => {
                    const codeToCopy =
                      roomState.mode === 'P2P'
                        ? roomState.roomId
                        : compositeCode ||
                          roomState.compositeCode ||
                          (roomState.mode === 'CUSTOM_IP'
                            ? `IP:${roomState.roomId}|${btoa(roomState.serverUrl)}`
                            : roomState.roomId);
                    copyToClipboard(codeToCopy);
                  }}
                  className="bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-emerald-300 px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5 transition active:scale-95 font-semibold cursor-pointer shadow-sm"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? t.roomUi.copiedCode : t.roomUi.copyCode}
                </button>
              </div>

              {/* 核心要求：全模式統一的人數顯示與 30 秒自動校準標示 */}
              <div className="text-[11px] text-slate-400 flex items-center justify-between border-t border-slate-700/60 pt-2">
                <span className="flex items-center gap-1 font-medium text-slate-300">
                  <Users className="w-3.5 h-3.5 text-emerald-400" />
                  {t.roomUi.membersPrefix} <strong className="text-emerald-400 text-xs">{t.roomUi.membersCount(currentMemberCount)}</strong>
                  <span className="text-[9px] text-slate-500 ml-1">{t.roomUi.autoCalibrateHint}</span>
                </span>
                <span className="text-emerald-400 font-semibold flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  {roomState.mode === 'P2P' ? t.connectionModes.p2p.roomStatus : t.connectionModes.default.roomStatus}
                </span>
              </div>
            </div>

            {/* 2. 房主審核通知佇列 (支援多位朋友同時申請) */}
            {roomState.isHost && pendingRequests.length > 0 && (
              <div className="bg-amber-950/40 border border-amber-500/50 p-3 rounded-xl space-y-2 shadow-lg animate-in fade-in slide-in-from-top-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                    <Bell className="w-4 h-4 text-amber-400 animate-bounce" />
                    {t.roomUi.auditRequestTitle} ({t.roomUi.auditWaitingSuffix(pendingRequests.length)})
                  </span>
                  {pendingRequests.length > 1 && (
                    <button
                      onClick={handleApproveAll}
                      className="text-[10px] text-emerald-400 font-bold hover:underline cursor-pointer"
                    >
                      {t.roomUi.approveAll}
                    </button>
                  )}
                </div>

                <div className="space-y-1.5 max-h-40 overflow-y-auto pr-0.5">
                  {pendingRequests.map((req) => (
                    <div
                      key={req.requestId}
                      className="flex items-center justify-between p-2 bg-slate-900/90 rounded-lg border border-slate-700/80"
                    >
                      <div className="truncate max-w-[170px]">
                        <span className="text-xs font-medium text-slate-200 block truncate">
                          {req.guestName}
                        </span>
                        <span className="text-[9px] text-slate-500">
                          {t.roomUi.appliedAt(new Date(req.timestamp).toLocaleTimeString())}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleApproveRequest(req.requestId)}
                          className="px-2 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-[10px] font-bold flex items-center gap-0.5 shadow transition cursor-pointer"
                        >
                          <UserCheck className="w-3 h-3" />
                          {t.roomUi.approve}
                        </button>
                        <button
                          onClick={() => handleRejectRequest(req.requestId)}
                          className="px-2 py-1 bg-red-600/70 hover:bg-red-600 text-white rounded text-[10px] font-bold flex items-center gap-0.5 transition cursor-pointer"
                        >
                          <UserX className="w-3 h-3" />
                          {t.roomUi.reject}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 3. 統一房主權限管理面板 */}
            {roomState.isHost && (
              <div className="bg-slate-800/50 p-3 rounded-xl border border-slate-800 space-y-2.5">
                <h3 className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5 text-emerald-400" /> {t.roomUi.hostPermissionTitle}
                </h3>

                {/* 允許觀眾操作切換 */}
                <div className="flex items-center justify-between p-2 bg-slate-900/70 rounded-lg border border-slate-800">
                  <span className="text-xs text-slate-300">{t.roomUi.allowGuestControl}</span>
                  <button
                    onClick={() => handleTogglePermission(!roomState.allowGuestControl)}
                    className={`w-10 h-5 flex items-center rounded-full p-1 transition duration-300 cursor-pointer ${
                      roomState.allowGuestControl ? 'bg-emerald-600' : 'bg-slate-700'
                    }`}
                  >
                    <div
                      className={`bg-white w-3.5 h-3.5 rounded-full shadow-md transform transition duration-300 ${
                        roomState.allowGuestControl ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                {/* 強制網頁跳轉同步 */}
                <button
                  onClick={handleSyncCurrentTab}
                  className="w-full bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 font-medium py-2 rounded-lg text-xs transition flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  {t.roomUi.forceSyncTab}
                </button>
              </div>
            )}

            {/* 4. 統一房內操作按鈕 */}
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                onClick={handleLeaveRoom}
                className="py-2 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-xs transition flex items-center justify-center gap-1.5 font-medium cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5 text-emerald-400" />
                {t.roomUi.newRoom}
              </button>

              <button
                onClick={handleLeaveRoom}
                className="py-2 px-3 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg text-xs transition flex items-center justify-center gap-1.5 font-medium cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                {t.roomUi.leaveRoom}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 底部 Footer */}
      <div className="mt-4 pt-2.5 border-t border-slate-800/80 text-center text-[10px] text-slate-500 flex items-center justify-between">
        <span>{t.app.engineLabel}</span>
        <span className="font-mono text-emerald-400 font-semibold text-[10px]">
          {t.connectionModes.footerPrefix}
          {(roomState ? roomState.mode : connectionMode) === 'P2P'
            ? t.connectionModes.p2p.footerLabel
            : (roomState ? roomState.mode : connectionMode) === 'CUSTOM_IP'
            ? t.connectionModes.customIp.footerLabel
            : t.connectionModes.default.footerLabel}
        </span>
      </div>
    </div>
  );
}
