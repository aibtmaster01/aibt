import React from 'react';

export interface MobileSheetHostProps {
  /** 시트를 실제로 그릴지(닫힐 때 DOM 제거로 중첩 포커스 이슈 완화) */
  open: boolean;
  children: React.ReactNode;
  /** 시트 패널에 추가 클래스 */
  className?: string;
}

/**
 * 모바일 전용 바텀 시트 **호스트**(슬롯 1개).
 * - 한 번에 하나의 시트만 두어 modal+sheet 이중 스택을 피한다.
 * - 실제 패널 애니메이션·핸들은 자식에서 구현하거나 후속 통합.
 */
export function MobileSheetHost({ open, children, className = '' }: MobileSheetHostProps) {
  if (!open) return null;
  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-[95] md:hidden flex flex-col pointer-events-none pb-[env(safe-area-inset-bottom)] ${className}`.trim()}
      role="presentation"
    >
      <div className="pointer-events-auto w-full max-w-lg mx-auto">{children}</div>
    </div>
  );
}
