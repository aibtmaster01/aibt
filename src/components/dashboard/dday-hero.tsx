import { Calendar, Zap, ChevronRight, Sparkles } from "lucide-react";

interface DDayHeroProps {
  certName: string;
  daysLeft: number | null;
  examLabel: string;
  isExpired?: boolean;
  onStartStudy: () => void;
}

export function DDayHero({
  certName,
  daysLeft,
  examLabel,
  isExpired,
  onStartStudy,
}: DDayHeroProps) {
  const dDayText =
    daysLeft !== null
      ? daysLeft >= 0
        ? `D-${daysLeft}`
        : `D+${Math.abs(daysLeft)}`
      : "-";

  const isUrgent = daysLeft !== null && daysLeft >= 0 && daysLeft <= 7;

  return (
    <div className="relative overflow-hidden rounded-3xl">
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(145deg, #0034d3 0%, #3399ff 35%, #66b3ff 65%, #99ccff 100%)",
        }}
      />
      <div className="pointer-events-none absolute -right-12 -top-12 h-56 w-56 rounded-full bg-white/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-8 left-1/3 h-40 w-40 rounded-full bg-[#0034d3]/15 blur-2xl" />
      <div className="pointer-events-none absolute right-1/4 top-1/2 h-24 w-24 rounded-full bg-[#0034d3]/20 blur-xl" />

      <div className="relative z-10 p-5 md:p-8">
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between md:gap-3">
          <div className="flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-[#0034d3]/80" />
            <span className="text-[11px] font-bold uppercase tracking-wider text-[#0034d3]/80">
              {certName}
            </span>
          </div>
          <div className="flex w-fit items-center gap-1.5 rounded-full bg-white/30 px-3 py-1 backdrop-blur-sm">
            <Calendar className="h-3 w-3 shrink-0 text-[#0034d3]/70" />
            <span className="text-[11px] font-semibold text-[#0034d3]/70">
              {examLabel}
            </span>
          </div>
        </div>

        <div className="my-4 md:my-7">
          <span
            className={`text-5xl font-black tracking-tight md:text-7xl ${
              isUrgent ? "text-red-600" : "text-slate-900/90"
            }`}
            style={{ lineHeight: 0.9 }}
          >
            {dDayText}
          </span>
          <p className="mt-2 text-[12px] font-medium text-[#0034d3]/70 md:mt-2.5 md:text-[13px]">
            {daysLeft !== null && daysLeft >= 0
              ? `시험까지 ${daysLeft}일 남았습니다`
              : daysLeft !== null
                ? "시험이 종료되었습니다"
                : "시험 일정 없음"}
          </p>
        </div>

        {!isExpired && (
          <button
            onClick={onStartStudy}
            className="group flex w-full items-center justify-between rounded-2xl bg-slate-900 px-4 py-3 text-left shadow-lg shadow-[#0034d3]/10 transition-all hover:bg-slate-800 active:scale-[0.99] md:px-5 md:py-3.5"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/90 text-[#0034d3] md:h-9 md:w-9">
                <Zap className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-[13px] font-bold text-white md:text-sm">
                  오늘의 추천 학습 시작하기
                </p>
                <p className="mt-0.5 hidden text-[11px] text-slate-400 md:block">
                  AI가 약점 공략 모의고사를 준비했습니다
                </p>
              </div>
            </div>
            <ChevronRight className="h-5 w-5 shrink-0 text-slate-500 transition-transform group-hover:translate-x-0.5 group-hover:text-[#0034d3]" />
          </button>
        )}
      </div>
    </div>
  );
}
