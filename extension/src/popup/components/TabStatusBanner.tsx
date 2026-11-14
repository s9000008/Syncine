import React from 'react';
import { Sparkles, Video } from 'lucide-react';
import { RoomStateInfo } from '../../types/protocol';

interface TabStatusBannerProps {
  unlockToast: string | null;
  roomState: RoomStateInfo | null;
  isTargetSite: boolean;
  tabStatusLabel: string;
  tabStatusTooltip: string;
  bannersText: {
    reconnecting: string;
    disconnected: string;
  };
  tabBadgeText: {
    supported: string;
    unsupported: string;
  };
}

export const TabStatusBanner: React.FC<TabStatusBannerProps> = ({
  unlockToast,
  roomState,
  isTargetSite,
  tabStatusLabel,
  tabStatusTooltip,
  bannersText,
  tabBadgeText
}) => {
  return (
    <>
      {unlockToast && (
        <div className="mb-2.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium flex items-center gap-1.5 border bg-amber-950/50 text-amber-200 border-amber-500/40 shadow-sm">
          <Sparkles className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
          <span className="truncate">{unlockToast}</span>
        </div>
      )}

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
            {roomState.connectionStatus === 'RECONNECTING' ? bannersText.reconnecting : bannersText.disconnected}
          </span>
        </div>
      )}

      <div
        className={`mb-3 p-2 rounded-lg text-[11px] flex items-center justify-between border transition cursor-help ${
          isTargetSite
            ? 'bg-emerald-950/40 text-emerald-300 border-emerald-800/50'
            : 'bg-rose-950/25 text-rose-300 border-rose-900/40'
        }`}
        title={tabStatusTooltip}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span
            className={`w-2 h-2 rounded-full flex-shrink-0 ${
              isTargetSite
                ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)] animate-pulse'
                : 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.9)]'
            }`}
          />
          <Video className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="truncate">{tabStatusLabel}</span>
        </div>
        <span
          className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border flex-shrink-0 ml-2 ${
            isTargetSite
              ? 'text-emerald-400 bg-emerald-900/60 border-emerald-700/50'
              : 'text-rose-400 bg-rose-950/70 border-rose-800/60'
          }`}
        >
          {isTargetSite ? tabBadgeText.supported : tabBadgeText.unsupported}
        </span>
      </div>
    </>
  );
};
