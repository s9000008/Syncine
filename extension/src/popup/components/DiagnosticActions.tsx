import React from 'react';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { NON_REPORTABLE_ERROR_CODES } from '../constants';

interface DiagnosticActionsProps {
  errorMessage: string | null;
  lastErrorCode: string | null;
  diagnosticToast: boolean;
  onDismiss: () => void;
  onReportToGitHub: () => void;
  onCopyDiagnosticReport: () => void;
  labels: {
    reportIssueGithub: string;
    copyDiagnosticReport: string;
    reportCopiedToast: string;
  };
}

export const DiagnosticActions: React.FC<DiagnosticActionsProps> = ({
  errorMessage,
  lastErrorCode,
  diagnosticToast,
  onDismiss,
  onReportToGitHub,
  onCopyDiagnosticReport,
  labels
}) => {
  if (!errorMessage) return null;

  const isReportable = lastErrorCode !== 'ERR_AUDIT_REJECTED' && !NON_REPORTABLE_ERROR_CODES.has(lastErrorCode || '');

  return (
    <div className="mb-3 p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-xs space-y-2 shadow-lg">
      <div className="flex items-start justify-between gap-2">
        <span className="leading-relaxed font-medium">{errorMessage}</span>
        <button onClick={onDismiss} className="text-red-400 hover:text-red-300 px-1 font-bold cursor-pointer">
          ✕
        </button>
      </div>

      {isReportable && (
        <>
          <div className="pt-1.5 border-t border-red-500/20 flex items-center gap-2">
            <button
              onClick={onReportToGitHub}
              className="flex-1 py-1.5 px-2 bg-red-950/60 hover:bg-red-900/60 text-red-200 border border-red-500/40 rounded-lg text-[11px] font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-sm"
            >
              <ExternalLink className="w-3 h-3 text-red-300" />
              <span>{labels.reportIssueGithub}</span>
            </button>
            <button
              onClick={onCopyDiagnosticReport}
              className="py-1.5 px-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-600 rounded-lg text-[11px] font-medium flex items-center justify-center gap-1 transition-all cursor-pointer shadow-sm"
              title={labels.copyDiagnosticReport}
            >
              <Copy className="w-3 h-3 text-slate-400" />
              <span>{labels.copyDiagnosticReport}</span>
            </button>
          </div>

          {diagnosticToast && (
            <div className="text-[10px] text-emerald-400 bg-emerald-950/80 p-1.5 rounded border border-emerald-500/40 text-center animate-fade-in flex items-center justify-center gap-1 font-semibold">
              <Check className="w-3 h-3 text-emerald-400" />
              <span>{labels.reportCopiedToast}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
};
