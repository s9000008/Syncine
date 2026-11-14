import React from 'react';
import { Bell, Check, Clock, Copy, ExternalLink, Loader2, LogOut, Shield, UserCheck, Users, UserX } from 'lucide-react';
import { ConnectionMode, RoomStateInfo } from '../../types/protocol';
import { DEFAULT_SERVER_URL } from '../../config';
import { formatShareCode } from '../../utils/connectionParser';

interface ActiveRoomPanelProps {
  roomState: RoomStateInfo;
  compositeCode: string;
  connectionMode: ConnectionMode;
  customServerUrl: string;
  copied: boolean;
  onCopyCode: (code: string) => void;
  onApproveRequest: (requestId: string) => void;
  onRejectRequest: (requestId: string) => void;
  onApproveAll: () => void;
  onTogglePermission: (allow: boolean) => void;
  onSyncCurrentTab: () => void;
  onLeaveRoom: () => void;
  t: any;
}

export const ActiveRoomPanel: React.FC<ActiveRoomPanelProps> = ({
  roomState,
  compositeCode,
  connectionMode,
  customServerUrl,
  copied,
  onCopyCode,
  onApproveRequest,
  onRejectRequest,
  onApproveAll,
  onTogglePermission,
  onSyncCurrentTab,
  onLeaveRoom,
  t
}) => {
  const pendingRequests = roomState.pendingJoinRequests || [];
  const isGuestWaitingApproval = !roomState.isHost && roomState.guestAwaitingApproval;
  const currentMemberCount = roomState.connectedPeerCount || 1;

  if (isGuestWaitingApproval) {
    return (
      <div className="space-y-3.5 bg-slate-800/90 p-5 rounded-xl border border-teal-500/50 shadow-xl text-center">
        <div className="w-12 h-12 bg-teal-500/10 rounded-full flex items-center justify-center mx-auto border border-teal-500/30">
          <Loader2 className="w-6 h-6 animate-spin text-teal-400" />
        </div>
        <div>
          <h3 className="text-sm font-bold text-teal-300">{t.roomUi.awaitingTitle}</h3>
          <p className="text-xs text-slate-300 mt-1 leading-relaxed">{t.roomUi.awaitingDesc}</p>
        </div>
        <div className="p-2.5 bg-slate-900/80 rounded-lg border border-slate-700 text-xs font-mono text-slate-400 flex items-center justify-center gap-2">
          <Clock className="w-3.5 h-3.5 text-teal-400" />
          <span>
            {t.roomUi.roomCodeLabel}: <strong className="text-teal-300">{roomState.roomId}</strong>
          </span>
        </div>
        <button
          onClick={onLeaveRoom}
          className="w-full text-center text-xs text-slate-400 hover:text-red-400 pt-1 cursor-pointer"
        >
          {t.roomUi.cancelAndBack}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
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

          <button
            id="btn-copy-room-code"
            onClick={() => {
              const codeToCopy =
                compositeCode ||
                roomState.compositeCode ||
                formatShareCode(
                  roomState.mode || connectionMode || 'P2P',
                  roomState.roomId,
                  roomState.serverUrl || (connectionMode === 'CUSTOM_IP' ? customServerUrl : DEFAULT_SERVER_URL)
                );
              onCopyCode(codeToCopy);
            }}
            className="bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-emerald-300 px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5 transition active:scale-95 font-semibold cursor-pointer shadow-sm"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? t.roomUi.copiedCode : t.roomUi.copyCode}
          </button>
        </div>

        <div className="text-[11px] text-slate-400 flex items-center justify-between border-t border-slate-700/60 pt-2">
          <span className="flex items-center gap-1 font-medium text-slate-300">
            <Users className="w-3.5 h-3.5 text-emerald-400" />
            {t.roomUi.membersPrefix}{' '}
            <strong className="text-emerald-400 text-xs">{t.roomUi.membersCount(currentMemberCount)}</strong>
          </span>
          <span className="text-emerald-400 font-semibold flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
            {roomState.mode === 'P2P' ? t.connectionModes.p2p.roomStatus : t.connectionModes.default.roomStatus}
          </span>
        </div>
      </div>

      {roomState.isHost && pendingRequests.length > 0 && (
        <div className="bg-amber-950/40 border border-amber-500/50 p-3 rounded-xl space-y-2 shadow-lg animate-in fade-in slide-in-from-top-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
              <Bell className="w-4 h-4 text-amber-400 animate-bounce" />
              {t.roomUi.auditRequestTitle} ({t.roomUi.auditWaitingSuffix(pendingRequests.length)})
            </span>
            {pendingRequests.length > 1 && (
              <button onClick={onApproveAll} className="text-[10px] text-emerald-400 font-bold hover:underline cursor-pointer">
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
                    {req.guestShortId
                      ? t.roomUi.defaultGuestName(req.guestShortId)
                      : t.roomUi.defaultGuestName(req.requestId.slice(-4))}
                  </span>
                  <span className="text-[9px] text-slate-500">
                    {t.roomUi.appliedAt(new Date(req.timestamp).toLocaleTimeString())}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => onApproveRequest(req.requestId)}
                    className="px-2 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-[10px] font-bold flex items-center gap-0.5 shadow transition cursor-pointer"
                  >
                    <UserCheck className="w-3 h-3" />
                    {t.roomUi.approve}
                  </button>
                  <button
                    onClick={() => onRejectRequest(req.requestId)}
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

      {roomState.isHost && (
        <div className="bg-slate-800/50 p-3 rounded-xl border border-slate-800 space-y-2.5">
          <h3 className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5 text-emerald-400" /> {t.roomUi.hostPermissionTitle}
          </h3>

          <div className="flex items-center justify-between p-2 bg-slate-900/70 rounded-lg border border-slate-800">
            <span className="text-xs text-slate-300">{t.roomUi.allowGuestControl}</span>
            <button
              onClick={() => onTogglePermission(!roomState.allowGuestControl)}
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

          <button
            onClick={onSyncCurrentTab}
            className="w-full bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 font-medium py-2 rounded-lg text-xs transition flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            {t.roomUi.forceSyncTab}
          </button>
        </div>
      )}

      <div className="pt-1">
        <button
          onClick={onLeaveRoom}
          className="w-full py-2.5 px-3 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg text-xs transition flex items-center justify-center gap-1.5 font-medium cursor-pointer"
        >
          <LogOut className="w-3.5 h-3.5" />
          {t.roomUi.leaveRoom}
        </button>
      </div>
    </div>
  );
};
