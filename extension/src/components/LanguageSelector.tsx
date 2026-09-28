import React from 'react';
import { Globe } from 'lucide-react';
import { useTranslation, SupportedLanguage, SUPPORTED_LANGUAGES } from '../locales';

interface LanguageSelectorProps {
  className?: string;
}

export const LanguageSelector: React.FC<LanguageSelectorProps> = ({ className = '' }) => {
  const { language, setLanguage, t } = useTranslation();

  return (
    <div className={`relative inline-flex items-center ${className}`} title={t.languageSelector.label}>
      <Globe className="w-3.5 h-3.5 text-slate-400 absolute left-2 pointer-events-none transition-colors" />
      <select
        value={language}
        onChange={(e) => setLanguage(e.target.value as SupportedLanguage)}
        aria-label={t.languageSelector.label}
        className="bg-slate-800/90 hover:bg-slate-700/80 text-[11px] text-slate-200 pl-6 pr-2 py-1 rounded-lg border border-slate-700/80 hover:border-slate-600 focus:outline-none focus:border-emerald-500 cursor-pointer appearance-none font-medium transition shadow-sm"
      >
        {SUPPORTED_LANGUAGES.map((item) => (
          <option key={item.code} value={item.code} className="bg-slate-900 text-slate-200 py-1">
            {item.flag} {item.nativeName}
          </option>
        ))}
      </select>
    </div>
  );
};
