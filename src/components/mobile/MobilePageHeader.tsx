import React from 'react';
import { cn } from '../../lib/utils';

export interface MobilePageHeaderProps {
  /** 좌측 액션(메뉴·뒤로 등) */
  left?: React.ReactNode;
  /** 우측 액션 */
  right?: React.ReactNode;
  /** 정렬 기준 라벨(예: 회차 제목) */
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** 헤더 아래 보조 줄(진행 바 등) — 스크롤에 포함되지 않도록 shrink-0 */
  bottom?: React.ReactNode;
  className?: string;
}

/**
 * 모바일 상단 앱 바. safe-area + iOS 주소창 변동에 대비해 padding은 상대 단위.
 * 정보 우선순위: 좌·우 행동 버튼 → 중앙 타이틀/부제(한눈에 상태).
 */
export function MobilePageHeader({ left, right, title, subtitle, bottom, className }: MobilePageHeaderProps) {
  return (
    <div
      className={cn(
        'lg:hidden shrink-0 bg-white border-b border-slate-200 z-20 shadow-sm',
        className
      )}
    >
      <div
        className="flex items-center gap-1 px-2 sm:px-3 pb-2.5"
        style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}
      >
        {left != null ? <div className="flex items-center shrink-0 gap-0.5">{left}</div> : null}
        <div className="flex-1 min-w-0 text-center px-1">
          <div className="text-sm font-bold text-slate-900 truncate leading-tight">{title}</div>
          {subtitle != null ? (
            <div className="text-[11px] text-slate-500 tabular-nums mt-0.5">{subtitle}</div>
          ) : null}
        </div>
        {right != null ? <div className="flex items-center shrink-0">{right}</div> : null}
      </div>
      {bottom}
    </div>
  );
}
