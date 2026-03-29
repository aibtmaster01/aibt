import React from 'react';

export type MobilePageContainerVariant = 'scroll' | 'immersive';

export interface MobilePageContainerProps {
  variant: MobilePageContainerVariant;
  children: React.ReactNode;
  className?: string;
}

/**
 * 모바일 셸 내부 메인 영역. 스크롤은 여기 한 곳에서만(immersive 제외).
 */
export function MobilePageContainer({ variant, children, className = '' }: MobilePageContainerProps) {
  const base =
    variant === 'immersive'
      ? 'flex-1 min-h-0 flex flex-col overflow-hidden'
      : 'flex-1 min-h-0 overflow-y-auto overscroll-y-contain';
  return <div className={`${base} ${className}`.trim()}>{children}</div>;
}
