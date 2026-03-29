import React from 'react';
import { cn } from '../../lib/utils';

export interface MobileBottomActionBarProps {
  children: React.ReactNode;
  /** true면 시트·오버레이와 겹칠 때 숨김(부모에서 애니메이션) */
  hidden?: boolean;
  className?: string;
}

/**
 * 모바일 하단 고정 액션 영역. 단일 스크롤 루트와 분리해 nested scroll 방지.
 * 본문은 pb로 이 영역 높이만큼 비워야 함.
 */
export function MobileBottomActionBar({ children, hidden, className }: MobileBottomActionBarProps) {
  return (
    <div
      className={cn(
        'lg:hidden fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 backdrop-blur-md transition-transform duration-200 ease-out',
        hidden ? 'translate-y-full pointer-events-none' : 'translate-y-0',
        className
      )}
      style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
    >
      <div className="flex items-stretch gap-1.5 px-2 py-2 w-full">{children}</div>
    </div>
  );
}
