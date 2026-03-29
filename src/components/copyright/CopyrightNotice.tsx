import React from 'react';
import { COPYRIGHT_COPY } from '../../constants/copyrightCopy';
import { Shield } from 'lucide-react';

export type CopyrightNoticeVariant = 'inline' | 'banner' | 'toast';
export type CopyrightNoticeTone = 'soft' | 'warning';

export interface CopyrightNoticeProps {
  variant?: CopyrightNoticeVariant;
  tone?: CopyrightNoticeTone;
  /** Quiz는 강화 문구 포함, Result/목록은 짧게 */
  context?: 'quiz' | 'result' | 'list' | 'footer' | 'global';
  /** 한 줄 모드 (모바일 상단 등) */
  compact?: boolean;
  className?: string;
  /** 보조 링크 없음 — 우선 고지 중심 */
  id?: string;
}

function linesForContext(context: CopyrightNoticeProps['context'], tone: CopyrightNoticeTone, compact?: boolean): string[] {
  if (context === 'quiz') {
    if (compact) return [COPYRIGHT_COPY.quizFooterSingleLine];
    return [COPYRIGHT_COPY.quizFooterPcLine1, COPYRIGHT_COPY.quizFooterPcLine2];
  }
  if (context === 'result') {
    return [COPYRIGHT_COPY.lineSoft, COPYRIGHT_COPY.lineSecondary];
  }
  if (context === 'list' || context === 'footer') {
    return compact
      ? [`${COPYRIGHT_COPY.linePrimary} ${COPYRIGHT_COPY.lineSoft}`]
      : [COPYRIGHT_COPY.linePrimary, COPYRIGHT_COPY.lineSoft];
  }
  return [COPYRIGHT_COPY.linePrimary, COPYRIGHT_COPY.lineSecondary];
}

export const CopyrightNotice: React.FC<CopyrightNoticeProps> = ({
  variant = 'inline',
  tone = 'soft',
  context = 'global',
  compact = false,
  className = '',
  id,
}) => {
  const lines = linesForContext(context, tone, compact);
  const isWarning = tone === 'warning';

  const textColor = isWarning ? 'text-slate-600' : 'text-slate-500';
  const borderBanner = isWarning ? 'border-amber-200/80 bg-amber-50/50' : 'border-slate-200/80 bg-slate-50/60';

  if (variant === 'banner') {
    return (
      <aside
        id={id}
        role="note"
        className={`flex items-start gap-2 rounded-lg border px-2.5 py-2 ${borderBanner} ${className}`}
      >
        <Shield className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${isWarning ? 'text-amber-700/90' : 'text-slate-500'}`} aria-hidden />
        <div className={`text-[11px] sm:text-xs leading-snug ${textColor} space-y-1`}>
          {lines.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      </aside>
    );
  }

  if (variant === 'toast') {
    return (
      <p id={id} role="status" className={`text-xs leading-snug ${textColor} ${className}`}>
        {lines.join(' ')}
      </p>
    );
  }

  return (
    <div id={id} role="note" className={`text-[10px] sm:text-[11px] leading-relaxed ${textColor} ${className}`}>
      {lines.map((line, i) => (
        <p key={i} className={i > 0 ? 'mt-0.5' : undefined}>
          {line}
        </p>
      ))}
    </div>
  );
};
