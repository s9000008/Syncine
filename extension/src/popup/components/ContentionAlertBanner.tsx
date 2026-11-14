import React, { useState } from 'react';
import { AlertTriangle, Check, Copy, ExternalLink, X } from 'lucide-react';
import { PlaybackConflictState } from '../../types/protocol';
import { TranslationSchema } from '../../locales/schema';

interface ContentionAlertBannerProps {
  conflict: PlaybackConflictState;
  onCopyReport: () => void;
  onReportGithub: () => void;
  onDismiss: () => void;
  t: TranslationSchema;
}

export const ContentionAlertBanner: React.FC<ContentionAlertBannerProps> = ({
  conflict,
  onCopyReport,
  onReportGithub,
  onDismiss,
  t
}) => {
  const [copiedLocal, setCopiedLocal] = useState(false);

  if (!conflict.detected || conflict.dismissed) {
    return null;
  }

  const handleCopy = () => {
    onCopyReport();
    setCopiedLocal(true);
    setTimeout(() => setCopiedLocal(false), 2500);
  };

  return (
    <div
      data-testid="contention-alert-banner"
      className="bg-amber-950/60 border border-amber-500/40 rounded-xl p-3 space-y-2 shadow-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0">
          <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="min-w-0">
            <h4 className="text-xs font-bold text-amber-300 leading-snug">
              {t.roomUi.conflictAlertTitle}
            </h4>
            <p className="text-[11px] text-amber-100/85 leading-relaxed mt-1">
              {t.roomUi.conflictAlertDesc(conflict.hostname || 'unknown', conflict.reversalCount)}
            </p>
          </div>
        </div>
        <button
          onClick={onDismiss}
          title={t.roomUi.conflictDismissBtn}
          aria-label={t.roomUi.conflictDismissBtn}
          className="text-amber-300/70 hover:text-amber-200 p-0.5 rounded transition cursor-pointer flex-shrink-0"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex items-center gap-2 pt-0.5">
        <button
          onClick={handleCopy}
          className="flex-1 py-1.5 px-2.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/35 rounded-lg text-[11px] font-medium transition flex items-center justify-center gap-1 cursor-pointer"
        >
          {copiedLocal ? <Check className="w-3 h-3 text-emerald-300" /> : <Copy className="w-3 h-3" />}
          <span>{copiedLocal ? t.roomUi.reportCopiedToast : t.roomUi.conflictCopyReportBtn}</span>
        </button>

        <button
          onClick={onReportGithub}
          className="flex-1 py-1.5 px-2.5 bg-slate-800/90 hover:bg-slate-700/90 text-slate-200 border border-slate-600/60 rounded-lg text-[11px] font-medium transition flex items-center justify-center gap-1 cursor-pointer"
        >
          <ExternalLink className="w-3 h-3" />
          <span>{t.roomUi.conflictReportGithubBtn}</span>
        </button>
      </div>
    </div>
  );
};
