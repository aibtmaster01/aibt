import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';

export type MobileSheetSize = 'md' | 'lg' | 'full';

export interface MobileSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** 부제·도움말 (짧게) */
  description?: React.ReactNode;
  children: React.ReactNode;
  /** 가벼운 선택: md~50dvh, 목록·긴 목록: lg, 전면: full */
  size?: MobileSheetSize;
  className?: string;
  panelClassName?: string;
  headerClassName?: string;
  /** 닫기 버튼 숨김(스와이프 헤더만 쓸 때) */
  hideCloseButton?: boolean;
}

const sizeToMaxH: Record<MobileSheetSize, string> = {
  md: 'max-h-[50dvh]',
  lg: 'max-h-[min(88dvh,100dvh)]',
  full: 'max-h-[100dvh]',
};

/**
 * 모바일 바텀 시트(lg 이하만). 중앙 모달 대신 가벼운 선택·목록용.
 * 본문은 단일 overflow-y-auto 로 nested scroll 최소화.
 */
export function MobileSheet({
  open,
  onClose,
  title,
  description,
  children,
  size = 'lg',
  className,
  panelClassName,
  headerClassName,
  hideCloseButton = false,
}: MobileSheetProps) {
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
    <div className={cn('lg:hidden', className)} role="dialog" aria-modal="true" aria-labelledby="mobile-sheet-title">
      <button
        type="button"
        className="fixed inset-0 z-[100] bg-black/40 transition-opacity"
        aria-label="닫기"
        onClick={onClose}
      />
      <div
        className={cn(
          'fixed inset-x-0 bottom-0 z-[110] flex flex-col rounded-t-2xl bg-white shadow-[0_-8px_32px_rgba(0,0,0,0.12)] border-t border-slate-200 transition-transform duration-200 ease-out',
          sizeToMaxH[size],
          size === 'full' ? 'h-[100dvh] max-h-[100dvh] rounded-none' : '',
          panelClassName
        )}
        style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
      >
        <div className={cn('shrink-0 flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100 bg-white', headerClassName)}>
          <div className="min-w-0" id="mobile-sheet-title">
            <p className="text-base font-bold text-slate-900 leading-tight">{title}</p>
            {description != null ? (
              <div className="text-xs text-slate-500 mt-0.5">{description}</div>
            ) : null}
          </div>
          {!hideCloseButton ? (
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-600 hover:bg-slate-100 shrink-0"
              aria-label="닫기"
            >
              <X size={22} />
            </button>
          ) : null}
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain touch-pan-y">{children}</div>
      </div>
    </div>
  );
}
