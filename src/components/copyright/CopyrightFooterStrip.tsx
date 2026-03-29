import React from 'react';
import { CopyrightNotice } from './CopyrightNotice';

/** 앱 메인 컬럼 하단 전역 고지 (퀴즈 전용 화면 외) */
export const CopyrightFooterStrip: React.FC<{ className?: string }> = ({ className = '' }) => (
  <footer
    className={`shrink-0 border-t border-slate-200/80 bg-[#edf1f5]/95 px-4 py-3 sm:px-6 ${className}`}
    aria-label="저작권 안내"
  >
    <CopyrightNotice variant="inline" tone="soft" context="footer" compact className="max-w-4xl mx-auto text-center sm:text-left" />
  </footer>
);
