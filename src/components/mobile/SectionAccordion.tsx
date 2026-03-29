import React, { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface SectionAccordionProps {
  title: React.ReactNode;
  /** 접힌 상태 헤더 오른쪽 요약(건수 등) */
  summary?: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
  /** 제어 모드 */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  buttonClassName?: string;
  contentClassName?: string;
}

/**
 * 모바일 세부 섹션: 첫 화면 정보 밀도 낮추고, 분석·기록은 아래로 접기.
 */
export function SectionAccordion({
  title,
  summary,
  children,
  defaultOpen = false,
  open: controlledOpen,
  onOpenChange,
  className,
  buttonClassName,
  contentClassName,
}: SectionAccordionProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = (next: boolean) => {
    if (!isControlled) setInternalOpen(next);
    onOpenChange?.(next);
  };

  return (
    <div className={cn('rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm', className)}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          'w-full flex items-center justify-between gap-2 min-h-[52px] px-4 py-3 text-left hover:bg-slate-50',
          buttonClassName
        )}
      >
        <span className="font-bold text-slate-900 text-sm flex items-center gap-2 min-w-0">{title}</span>
        <span className="flex items-center gap-2 shrink-0">
          {summary != null ? <span className="text-xs text-slate-500 font-medium">{summary}</span> : null}
          {open ? <ChevronUp size={20} className="text-slate-500" /> : <ChevronDown size={20} className="text-slate-500" />}
        </span>
      </button>
      {open ? (
        <div className={cn('border-t border-slate-100', contentClassName)}>{children}</div>
      ) : null}
    </div>
  );
}
