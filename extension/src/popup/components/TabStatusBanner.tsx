import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Sparkles, Video } from 'lucide-react';
import { RoomStateInfo } from '../../types/protocol';
import { PLATFORM_REGISTRY } from '../../platforms';

interface TabStatusBannerProps {
  unlockToast: string | null;
  roomState: RoomStateInfo | null;
  isTargetSite: boolean;
  currentPlatformId?: string;
  candidatesUnlocked?: boolean;
  tabStatusLabel: string;
  tabStatusTooltip: string;
  bannersText: {
    reconnecting: string;
    disconnected: string;
  };
  tabBadgeText: {
    supported: string;
    unsupported: string;
    supportedListBtn: string;
    supportedListTitle: string;
    supportedListUniversalNote: string;
    supportedListUniversalActive: string;
  };
}

export const TabStatusBanner: React.FC<TabStatusBannerProps> = ({
  unlockToast,
  roomState,
  isTargetSite,
  currentPlatformId,
  candidatesUnlocked,
  tabStatusLabel,
  tabStatusTooltip,
  bannersText,
  tabBadgeText
}) => {
  const [showSupportedList, setShowSupportedList] = useState(false);
  const officialPlatforms = PLATFORM_REGISTRY.filter((p) => p.enabled);

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

      <div className="mb-3">
        <div
          onClick={() => setShowSupportedList((prev) => !prev)}
          data-testid="tab-status-banner"
          className={`p-2 rounded-lg text-[11px] flex items-center justify-between border transition cursor-pointer select-none ${
            isTargetSite
              ? 'bg-emerald-950/40 text-emerald-300 border-emerald-800/50 hover:border-emerald-700/70'
              : 'bg-rose-950/25 text-rose-300 border-rose-900/40 hover:border-rose-800/60'
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
          <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setShowSupportedList((prev) => !prev);
              }}
              data-testid="toggle-supported-list-btn"
              className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 border border-slate-700/70 flex items-center gap-0.5 transition"
            >
              <span>{tabBadgeText.supportedListBtn}</span>
              {showSupportedList ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
            <span
              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${
                isTargetSite
                  ? 'text-emerald-400 bg-emerald-900/60 border-emerald-700/50'
                  : 'text-rose-400 bg-rose-950/70 border-rose-800/60'
              }`}
            >
              {isTargetSite ? tabBadgeText.supported : tabBadgeText.unsupported}
            </span>
          </div>
        </div>

        {showSupportedList && (
          <div
            data-testid="supported-platforms-panel"
            className="mt-1.5 p-2.5 rounded-lg bg-slate-950/90 border border-slate-800 text-[10px] text-slate-300 shadow-inner space-y-2"
          >
            <div className="font-semibold text-slate-200 flex items-center justify-between">
              <span>{tabBadgeText.supportedListTitle}</span>
            </div>
            <div className="grid grid-cols-3 gap-1">
              {officialPlatforms.map((platform) => {
                const isCurrent = currentPlatformId === platform.id;
                return (
                  <div
                    key={platform.id}
                    className={`px-1.5 py-1 rounded border truncate text-center font-medium ${
                      isCurrent
                        ? 'bg-emerald-950/70 text-emerald-300 border-emerald-600/60'
                        : 'bg-slate-900/80 text-slate-300 border-slate-800/80'
                    }`}
                    title={platform.name}
                  >
                    {platform.name}
                  </div>
                );
              })}
            </div>
            <div
              className={`pt-1.5 border-t border-slate-800/80 text-[10px] leading-snug ${
                candidatesUnlocked ? 'text-amber-300' : 'text-slate-400'
              }`}
            >
              {candidatesUnlocked ? tabBadgeText.supportedListUniversalActive : tabBadgeText.supportedListUniversalNote}
            </div>
          </div>
        )}
      </div>
    </>
  );
};
