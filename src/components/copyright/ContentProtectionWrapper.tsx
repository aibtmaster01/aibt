import React, { useRef } from 'react';
import { useCopyrightGuard } from '../../hooks/useCopyrightGuard';

export interface ContentProtectionWrapperProps {
  children: React.ReactNode;
  className?: string;
  /** 선택·우클릭 완화 제한 + (옵션) 탭 이탈 콜백 */
  guardEnabled?: boolean;
  /** 로그인 사용자 식별·회차 등 짧은 문자열 (유출 억제 심리용, 캡처 방지 아님) */
  watermarkText?: string | null;
  onContextLeave?: () => void;
}

/**
 * 문제·해설 등 보호 대상 영역 래퍼.
 * 감시가 아닌 정책·습관 형성 목적의 소프트 장치.
 */
export const ContentProtectionWrapper: React.FC<ContentProtectionWrapperProps> = ({
  children,
  className = '',
  guardEnabled = true,
  watermarkText,
  onContextLeave,
}) => {
  const ref = useRef<HTMLDivElement>(null);

  useCopyrightGuard({
    enabled: guardEnabled,
    targetRef: ref,
    blockSelection: true,
    blockContextMenu: true,
    onContextLeave,
    contextLeaveCooldownMs: 120_000,
  });

  return (
    <div
      ref={ref}
      className={`relative min-h-0 ${guardEnabled ? 'select-none [user-select:none] [-webkit-user-select:none]' : ''} ${className}`.trim()}
    >
      {watermarkText ? (
        <div
          className="pointer-events-none absolute inset-0 z-[1] overflow-hidden rounded-[inherit]"
          aria-hidden
        >
          <div className="absolute bottom-2 right-2 sm:bottom-3 sm:right-3 z-[2] max-w-[72%] text-[9px] sm:text-[10px] font-medium text-slate-400/65 text-right leading-tight select-none break-all">
            {watermarkText}
          </div>
        </div>
      ) : null}
      <div className="relative z-[2] flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
    </div>
  );
};
