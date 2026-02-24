import { ChevronRight, Zap } from "lucide-react";

interface StudyCtaProps {
  onStart: () => void;
}

export function StudyCta({ onStart }: StudyCtaProps) {
  return (
    <button
      onClick={onStart}
      className="group flex w-full items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-card p-5 text-left transition-all hover:border-brand-300 hover:shadow-lg hover:shadow-brand-400/5"
    >
      <div className="flex items-center gap-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-400 text-slate-900">
          <Zap className="h-5 w-5" />
        </div>
        <div>
          <h3 className="text-sm font-bold text-foreground">
            오늘의 추천 학습 시작하기
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            AI가 약점 공략 모의고사를 준비했습니다
          </p>
        </div>
      </div>
      <ChevronRight className="h-5 w-5 shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-500" />
    </button>
  );
}
