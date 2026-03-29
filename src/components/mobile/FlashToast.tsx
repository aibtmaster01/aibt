import React, { useEffect } from 'react';
import { cn } from '../../lib/utils';

export interface FlashToastProps {
  message: string | null;
  onDismiss: () => void;
  /** ms */
  duration?: number;
  variant?: 'success' | 'error' | 'neutral';
  className?: string;
}

/**
 * 완료·간단 알림용 인라인 토스트(중앙 모달 대체). 모바일에서 하단 safe-area 위.
 */
export function FlashToast({ message, onDismiss, duration = 2800, variant = 'success', className }: FlashToastProps) {
  useEffect(() => {
    if (!message) return;
    const t = window.setTimeout(onDismiss, duration);
    return () => window.clearTimeout(t);
  }, [message, duration, onDismiss]);

  if (!message) return null;

  const styles =
    variant === 'success'
      ? 'bg-slate-900 text-white'
      : variant === 'error'
        ? 'bg-red-600 text-white'
        : 'bg-slate-800 text-white';

  return (
    <div
      className={cn(
        'fixed left-1/2 -translate-x-1/2 z-[110] max-w-[min(100%-2rem,420px)] px-4 py-3 rounded-xl shadow-lg text-sm font-semibold text-center',
        styles,
        className
      )}
      style={{ bottom: 'max(1rem, env(safe-area-inset-bottom))' }}
      role="status"
    >
      {message}
    </div>
  );
}
