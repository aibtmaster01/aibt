import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface MobileFullScreenModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  /** 하단 고정 영역(버튼줄) */
  footer?: React.ReactNode;
  className?: string;
}

/**
 * 모바일 전면 모달(로그인·결제·긴 폼 류에 대응). 단일 스크롤: 본문만 overflow-y-auto.
 */
export function MobileFullScreenModal({ open, onClose, title, children, footer, className }: MobileFullScreenModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className={cn(
        'lg:hidden fixed inset-0 z-[100] flex flex-col bg-white',
        className
      )}
      role="dialog"
      aria-modal="true"
    >
      <header
        className="shrink-0 flex items-center justify-between gap-2 px-3 py-3 border-b border-slate-200"
        style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}
      >
        <h2 className="text-base font-bold text-slate-900 truncate pr-2">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-600 hover:bg-slate-100 shrink-0"
          aria-label="닫기"
        >
          <X size={22} />
        </button>
      </header>
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain touch-pan-y">{children}</div>
      {footer != null ? (
        <div
          className="shrink-0 border-t border-slate-200 bg-white p-3"
          style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
        >
          {footer}
        </div>
      ) : null}
    </div>
  );
}
