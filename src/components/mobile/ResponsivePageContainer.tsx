import React from 'react';
import { cn } from '../../lib/utils';

export interface ResponsivePageContainerProps {
  children: React.ReactNode;
  /** 최상위 래퍼 (배경·전체 min-height) */
  className?: string;
  /**
   * 모바일에서 메인 스크롤을 한 곳으로 고정할 때 사용.
   * false면 자식이 직접 스크롤(immersive 퀴즈 등).
   */
  mobileSingleScroll?: boolean;
  /** mobileSingleScroll true일 때 스크롤 영역 클래스 */
  scrollClassName?: string;
}

/**
 * 페이지 루트: dvh 기준 높이·min-h-0 로 flex 자식이 남는 높이를 올바르게 계산(iOS Safari).
 * mobileSingleScroll: 목록·마이페이지처럼 "헤더 고정 + 본문만 스크롤" 패턴.
 */
export function ResponsivePageContainer({
  children,
  className,
  mobileSingleScroll = true,
  scrollClassName,
}: ResponsivePageContainerProps) {
  if (!mobileSingleScroll) {
    return (
      <div
        className={cn('flex flex-col w-full min-h-0 min-h-[100dvh]', className)}
      >
        {children}
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col w-full min-h-0 min-h-[100dvh]', className)}>
      <div
        className={cn(
          'flex-1 min-h-0 overflow-y-auto overscroll-y-contain touch-pan-y',
          scrollClassName
        )}
      >
        {children}
      </div>
    </div>
  );
}
