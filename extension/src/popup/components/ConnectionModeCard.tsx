import React from 'react';
import { Check, ChevronDown, Loader2, Plus, Server, Shield, Users, Zap } from 'lucide-react';
import { ConnectionMode, DetectedShareCodeType } from '../../types/protocol';

interface ConnectionModeCardProps {
  activeTab: 'create' | 'join';
  onTabChange: (tab: 'create' | 'join') => void;
  connectionMode: ConnectionMode;
  onConnectionModeChange: (mode: ConnectionMode) => void;
  customServerUrl: string;
  onCustomServerUrlChange: (url: string) => void;
  shareCodeInput: string;
  onShareCodeChange: (code: string) => void;
  detectedCodeInfo: { detectedType: DetectedShareCodeType; isLegacy: boolean } | null;
  serverHealth: 'CHECKING' | 'ONLINE' | 'OFFLINE';
  loading: boolean;
  onJoinRoom: () => void;
  onCreateRoom: () => void;
  t: any;
}

export const ConnectionModeCard: React.FC<ConnectionModeCardProps> = ({
  activeTab,
  onTabChange,
  connectionMode,
  onConnectionModeChange,
  customServerUrl,
  onCustomServerUrlChange,
  shareCodeInput,
  onShareCodeChange,
  detectedCodeInfo,
  serverHealth,
  loading,
  onJoinRoom,
  onCreateRoom,
  t
}) => {
  const renderServerHealthLabel = () => {
    if (serverHealth === 'ONLINE') return t.connectionModes.default.serverOnline;
    if (serverHealth === 'OFFLINE') return t.connectionModes.default.serverOffline;
    return t.connectionModes.default.serverProbing;
  };

  return (
    <div>
      <div className="grid grid-cols-2 p-1 bg-slate-950/60 rounded-xl border border-slate-800 mb-3.5">
        <button
          onClick={() => onTabChange('join')}
          className={`py-2 text-xs font-semibold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
            activeTab === 'join'
              ? 'bg-teal-600 text-white shadow-md shadow-teal-600/30 font-bold'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          {t.roomUi.joinTab}
        </button>

        <button
          onClick={() => onTabChange('create')}
          className={`py-2 text-xs font-semibold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
            activeTab === 'create'
              ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30 font-bold'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Plus className="w-3.5 h-3.5" />
          {t.roomUi.createTab}
        </button>
      </div>

      {activeTab === 'join' && (
        <div className="space-y-3 bg-slate-800/50 p-3.5 rounded-xl border border-slate-700/60">
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
                onChange={(e) => onConnectionModeChange(e.target.value as ConnectionMode)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-teal-500 transition appearance-none cursor-pointer pr-8 font-medium"
              >
                <option value="P2P">{t.connectionModes.p2p.selectOptionJoin}</option>
                <option value="DEFAULT">{t.connectionModes.default.selectOption}</option>
                <option value="CUSTOM_IP">{t.connectionModes.customIp.selectOption}</option>
              </select>
              <ChevronDown className="w-4 h-4 text-slate-400 absolute right-2.5 top-2 pointer-events-none" />
            </div>

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
                    ? `🟢 ${renderServerHealthLabel()}`
                    : serverHealth === 'OFFLINE'
                    ? `🔴 ${renderServerHealthLabel()}`
                    : `🟡 ${renderServerHealthLabel()}`}
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
              onChange={(e) => onShareCodeChange(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-teal-500 transition font-mono tracking-wider"
            />
            <p className="text-[10px] text-slate-400 mt-1">
              {connectionMode === 'P2P'
                ? t.connectionModes.p2p.inputHint
                : connectionMode === 'CUSTOM_IP'
                ? t.connectionModes.customIp.inputHint
                : t.connectionModes.default.inputHint}
            </p>

            {detectedCodeInfo && shareCodeInput.trim() && (
              <div className="mt-2 text-[10px] space-y-1">
                {detectedCodeInfo.detectedType === 'P2P' && (
                  <div className="bg-emerald-950/70 border border-emerald-500/40 text-emerald-300 w-full rounded-md p-1.5 flex items-center gap-1.5 shadow-sm">
                    <Zap className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span>{t.connectionModes.smartDetection?.p2pDetected}</span>
                  </div>
                )}
                {detectedCodeInfo.detectedType === 'DEFAULT' && (
                  <div className="bg-teal-950/70 border border-teal-500/40 text-teal-300 w-full rounded-md p-1.5 flex items-center gap-1.5 shadow-sm">
                    <Server className="w-3.5 h-3.5 text-teal-400 shrink-0" />
                    <span>{t.connectionModes.smartDetection?.defaultDetected}</span>
                  </div>
                )}
                {detectedCodeInfo.detectedType === 'CUSTOM_IP' && (
                  <div className="bg-blue-950/70 border border-blue-500/40 text-blue-300 w-full rounded-md p-1.5 flex items-center gap-1.5 shadow-sm">
                    <Server className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                    <span>{t.connectionModes.smartDetection?.customIpDetected}</span>
                  </div>
                )}
                {detectedCodeInfo.detectedType === 'LEGACY_COMPOSITE' && (
                  <div className="bg-cyan-950/70 border border-cyan-500/40 text-cyan-300 w-full rounded-md p-1.5 flex items-center gap-1.5 shadow-sm">
                    <Check className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                    <span>{t.connectionModes.smartDetection?.legacyCompositeHint}</span>
                  </div>
                )}
                {detectedCodeInfo.detectedType === 'LEGACY_RAW' && (
                  <div className="bg-amber-950/70 border border-amber-500/40 text-amber-300 w-full rounded-md p-1.5 flex items-center gap-1.5 shadow-sm">
                    <Shield className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span>
                      {(t.connectionModes.smartDetection?.legacyRawHint || '').replace(
                        '{mode}',
                        connectionMode === 'P2P'
                          ? t.connectionModes.p2p.footerLabel
                          : connectionMode === 'DEFAULT'
                          ? t.connectionModes.default.footerLabel
                          : t.connectionModes.customIp.footerLabel
                      )}
                    </span>
                  </div>
                )}
              </div>
            )}

            <button
              id="btn-join-room"
              onClick={onJoinRoom}
              disabled={loading || !shareCodeInput.trim()}
              className="w-full mt-3 py-2.5 px-4 bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white font-bold rounded-xl text-xs shadow-lg shadow-teal-600/30 transition-all flex items-center justify-center gap-2 border border-teal-400/30 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
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
                onChange={(e) => onConnectionModeChange(e.target.value as ConnectionMode)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-emerald-500 transition appearance-none cursor-pointer pr-8"
              >
                <option value="P2P">{t.connectionModes.p2p.selectOptionCreate}</option>
                <option value="DEFAULT">{t.connectionModes.default.selectOption}</option>
                <option value="CUSTOM_IP">{t.connectionModes.customIp.selectOption}</option>
              </select>
              <ChevronDown className="w-4 h-4 text-slate-400 absolute right-2.5 top-2.5 pointer-events-none" />
            </div>
          </div>

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
              <p className="text-[10px] text-slate-300 leading-relaxed">{t.connectionModes.p2p.description}</p>
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
                  {renderServerHealthLabel()}
                </span>
              </div>
              <p className="text-[10px] text-slate-400">{t.connectionModes.default.description}</p>
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
                onChange={(e) => onCustomServerUrlChange(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500 transition"
              />
            </div>
          )}

          <button
            id="btn-create-room"
            onClick={onCreateRoom}
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
    </div>
  );
};
