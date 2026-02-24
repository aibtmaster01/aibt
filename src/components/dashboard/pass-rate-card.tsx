import { Trophy, Lock, Users, TrendingUp, TrendingDown } from "lucide-react";

interface PassRateCardProps {
  rate: number;
  averageRate?: number;
  isPremium: boolean;
  onUpgrade: () => void;
}

function getMessage(rate: number) {
  if (rate >= 80) return "합격이 눈앞이에요! 이 페이스를 유지하세요";
  if (rate >= 60) return "이 페이스라면 충분합니다. 조금만 더!";
  if (rate >= 40) return "조금만 더 힘내볼까요? 화이팅!";
  return "기초부터 차근차근 시작해봐요";
}

export function PassRateCard({
  rate,
  averageRate = 45,
  isPremium,
  onUpgrade,
}: PassRateCardProps) {
  const isAboveAvg = rate > averageRate;
  const gapFromAvg = Math.abs(rate - averageRate);

  const barColor =
    rate >= 80 ? "#22c55e" : rate >= 60 ? "#eab308" : "#ef4444";
  const barColorLight =
    rate >= 80 ? "#f0fdf4" : rate >= 60 ? "#fefce8" : "#fef2f2";

  const statusLabel =
    rate >= 80 ? "안정권" : rate >= 60 ? "가능권" : "노력 필요";
  const statusColor =
    rate >= 80
      ? "bg-green-50 text-green-700 border-green-200"
      : rate >= 60
        ? "bg-[#99ccff] text-[#0034d3] border-[#0034d3]/30"
        : "bg-red-50 text-red-700 border-red-200";
  const statusDot =
    rate >= 80 ? "bg-green-500" : rate >= 60 ? "bg-[#0034d3]" : "bg-red-500";

  return (
    <div
      className={`relative h-full overflow-hidden rounded-2xl border border-slate-200 bg-card ${!isPremium ? "cursor-pointer" : ""}`}
      onClick={!isPremium ? onUpgrade : undefined}
    >
      {/* 제목(예측 합격률)만 잠금 시에도 표시, 노력 필요 영역부터 딤 */}
      <div className="flex h-full flex-col p-4 md:p-5">
        <div className="flex items-center gap-2 shrink-0 mb-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-50">
            <Trophy className="h-3.5 w-3.5 text-brand-500" />
          </div>
          <h3 className="text-sm font-bold text-foreground">예측 합격률</h3>
        </div>

        {/* 잠금 시 상태 뱃지(노력 필요 등) + 본문 오버레이 */}
        <div className="relative flex-1 min-h-0">
          {!isPremium && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white/35 backdrop-blur-sm">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-900 text-white md:h-12 md:w-12">
                <Lock className="h-4 w-4 md:h-5 md:w-5" />
              </div>
              <span className="mt-2 text-[13px] font-bold text-foreground md:mt-3 md:text-sm">
                열공모드 전용
              </span>
            </div>
          )}
          <div className={`h-full flex flex-col ${!isPremium ? "opacity-70" : ""}`}>
        <div className="flex shrink-0 items-center justify-end mb-1">
          <span
            className={`flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold ${statusColor}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${statusDot}`} />
            {statusLabel}
          </span>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center py-4 md:py-6">
          <div className="flex items-baseline">
            <span
              className="text-5xl font-black leading-none tracking-tight md:text-6xl"
              style={{ color: barColor }}
            >
              {rate}
            </span>
            <span className="ml-0.5 text-lg font-bold text-slate-300 md:text-xl">
              %
            </span>
          </div>
          <p className="mt-2.5 text-center text-[13px] leading-snug font-medium text-slate-400">
            {getMessage(rate)}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div
            className="flex items-center gap-2 rounded-xl px-2.5 py-2"
            style={{ backgroundColor: barColorLight }}
          >
            <Users className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            <div className="min-w-0">
              <p className="text-[10px] text-muted-foreground">수험생 평균</p>
              <p className="text-[13px] font-bold text-foreground">{`${averageRate}%`}</p>
            </div>
          </div>
          <div
            className="flex items-center gap-2 rounded-xl px-2.5 py-2"
            style={{ backgroundColor: barColorLight }}
          >
            {isAboveAvg ? (
              <TrendingUp className="h-3.5 w-3.5 shrink-0 text-green-500" />
            ) : (
              <TrendingDown className="h-3.5 w-3.5 shrink-0 text-red-500" />
            )}
            <div className="min-w-0">
              <p className="text-[10px] text-muted-foreground">평균 대비</p>
              <p
                className={`text-[13px] font-bold ${isAboveAvg ? "text-green-600" : "text-red-600"}`}
              >
                {isAboveAvg ? `+${gapFromAvg}%p` : `-${gapFromAvg}%p`}
              </p>
            </div>
          </div>
        </div>
          </div>
        </div>
      </div>
    </div>
  );
}
