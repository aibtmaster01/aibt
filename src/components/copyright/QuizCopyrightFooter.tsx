import React from 'react';
import { COPYRIGHT_COPY } from '../../constants/copyrightCopy';

/**
 * Quiz 전용 하단 저작권 고지.
 * - xl 미만: 1줄 (단일 열·모바일/태블릿과 Quiz.tsx max-xl 스크롤 구간과 일치)
 * - xl 이상: 2줄 · 중앙 정렬 · compact
 * 상단 중복 고지와 동시에 쓰지 않는다.
 */
export const QuizCopyrightFooter: React.FC<{ className?: string }> = ({ className = '' }) => (
  <footer
    className={`shrink-0 border-t border-slate-100/70 bg-slate-50/35 px-3 py-1 md:px-4 xl:px-8 xl:py-1.5 ${className}`.trim()}
    role="note"
    aria-label="저작권 안내"
  >
    <p className="xl:hidden text-[10px] sm:text-[10px] leading-[1.35] text-slate-400/95 text-center font-normal">
      {COPYRIGHT_COPY.quizFooterSingleLine}
    </p>
    <div className="hidden xl:block text-center text-[11px] leading-snug text-slate-400/95 max-w-3xl mx-auto font-normal space-y-0.5">
      <p>{COPYRIGHT_COPY.quizFooterPcLine1}</p>
      <p>{COPYRIGHT_COPY.quizFooterPcLine2}</p>
    </div>
  </footer>
);
