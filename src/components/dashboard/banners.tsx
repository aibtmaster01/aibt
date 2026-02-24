import { Lock, Database } from "lucide-react";

interface PostExamBannerProps {
  onPass: () => void;
  onFail: () => void;
}

export function PostExamBanner({ onPass, onFail }: PostExamBannerProps) {
  return (
    <div className="animate-slide-up rounded-2xl border border-slate-200 bg-card p-5">
      <h3 className="text-sm font-bold text-foreground">
        이번 시험 결과는 어떠셨나요?
      </h3>
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          onClick={onPass}
          className="flex-1 rounded-xl border-2 border-green-200 bg-green-50 px-4 py-3 text-sm font-bold text-green-800 transition-all hover:border-green-300 hover:bg-green-100 md:px-5 md:py-3.5"
        >
          합격했어요
        </button>
        <button
          onClick={onFail}
          className="flex-1 rounded-xl border-2 border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700 transition-all hover:border-slate-300 hover:bg-slate-100 md:px-5 md:py-3.5"
        >
          <span className="md:hidden">다음에 다시 도전할래요</span>
          <span className="hidden md:inline">
            아쉬워요, 다음에 다시 도전할래요
          </span>
        </button>
      </div>
    </div>
  );
}

interface ExpiredBannerProps {
  onCheckout: () => void;
}

export function ExpiredBanner({ onCheckout }: ExpiredBannerProps) {
  return (
    <div className="animate-slide-up flex flex-col items-center justify-between gap-4 rounded-2xl bg-slate-900 p-5 text-white md:flex-row">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-700 text-slate-400">
          <Lock className="h-5 w-5" />
        </div>
        <div>
          <h3 className="text-sm font-bold">수강 기간이 종료되었습니다.</h3>
          <p className="text-[11px] text-slate-400 md:text-xs">
            재도전 쿠폰(50%)으로 이어서 학습하세요
          </p>
        </div>
      </div>
      <button
        onClick={onCheckout}
        className="w-full shrink-0 rounded-xl bg-brand-400 px-5 py-2.5 text-sm font-bold text-slate-900 transition-colors hover:bg-brand-500 md:w-auto"
      >
        재수강 신청하기 (50% OFF)
      </button>
    </div>
  );
}

export function DataPreservationCard() {
  return (
    <div className="flex items-start gap-4 rounded-2xl border border-slate-200 bg-card p-4 md:items-center md:gap-5 md:p-5">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-500 md:h-12 md:w-12">
        <Database className="h-5 w-5 md:h-6 md:w-6" />
      </div>
      <div className="min-w-0">
        <h3 className="text-[13px] font-bold leading-snug text-foreground md:text-sm">
          오답 데이터 <span className="text-brand-600">342개</span> 보관중
        </h3>
        <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground md:text-xs">
          재수강하고 틀렸던 문제들만 골라 복습하세요
        </p>
      </div>
    </div>
  );
}
