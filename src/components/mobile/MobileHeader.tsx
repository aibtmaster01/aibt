import React from 'react';
import { Menu } from 'lucide-react';

export interface MobileHeaderProps {
  title: string;
  onOpenMenu: () => void;
}

/** 모바일 기본 셸 상단 앱 바. safe-area 반영. */
export function MobileHeader({ title, onOpenMenu }: MobileHeaderProps) {
  return (
    <header className="shrink-0 flex items-center gap-2 px-2 sm:px-3 py-2 border-b border-slate-200/80 bg-[#edf1f5]/95 backdrop-blur-md z-40 pt-[max(0.5rem,env(safe-area-inset-top))]">
      <button
        type="button"
        onClick={onOpenMenu}
        className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-[#1e56cd] shrink-0"
        aria-label="메뉴 열기"
      >
        <Menu className="w-6 h-6" strokeWidth={2} />
      </button>
      <h1 className="flex-1 text-base font-bold text-slate-900 truncate pr-1">{title}</h1>
    </header>
  );
}
