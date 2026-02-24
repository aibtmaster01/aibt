import { AlertTriangle } from "lucide-react";

/** UI 호환: rate(0~100) 사용 */
export interface WeaknessCardItem {
  name: string;
  rate: number;
  count?: number;
}

interface WeaknessCardProps {
  items: WeaknessCardItem[];
  isPremium: boolean;
  /** 오답이 하나라도 있으면 true, 없으면 false. null이면 아직 조회 전 */
  hasWrongQuestions?: boolean | null;
  /** 학습 이력 있음 (모의고사 1회 이상 응시) */
  hasLearningHistory?: boolean;
  /** 응시한 모의고사 중 가장 높은 회차 (1=1회차만, 2=2회차까지 등) */
  maxCompletedRound?: number;
  onRetry: () => void;
  onUpgrade: () => void;
}

function getRateColor(rate: number) {
  if (rate <= 40)
    return { bar: "bg-red-500", text: "text-red-600", bg: "bg-red-50", label: "매우 취약" };
  if (rate <= 55)
    return {
      bar: "bg-[#0034d3]",
      text: "text-[#0034d3]",
      bg: "bg-[#99ccff]",
      label: "보완 필요",
    };
  return { bar: "bg-blue-500", text: "text-blue-600", bg: "bg-blue-50", label: "양호" };
}

export function WeaknessCard({
  items,
  isPremium,
  hasWrongQuestions = null,
  hasLearningHistory = false,
  maxCompletedRound = 0,
  onRetry,
  onUpgrade,
}: WeaknessCardProps) {
  const displayItems = items.slice(0, 2);
  const showNoWrongMessage = hasWrongQuestions === false;

  const getEmptyMessage = () => {
    if (!hasLearningHistory) {
      return "모의고사를 응시하면 AI분석이 활성화됩니다.";
    }
    if (showNoWrongMessage && maxCompletedRound <= 1) {
      return (
        <>
          굉장해요! 모든 개념에 강합니다.
          <br />
          모의고사를 계속해서 응시하시면 취약점을 분석해드릴게요
        </>
      );
    }
    if (showNoWrongMessage && maxCompletedRound >= 2) {
      return (
        <>
          굉장해요! 모든 개념에 강합니다.
          <br />
          실전 모의고사로 최종 점검 해보세요.
        </>
      );
    }
    return null;
  };

  const emptyMsg = getEmptyMessage();
  const showEmptyState = !hasLearningHistory || (showNoWrongMessage && emptyMsg);

  return (
    <div className="relative h-full overflow-hidden rounded-2xl border border-slate-200 bg-card">
      <div className="flex h-full min-h-[280px] flex-col p-5">
        <div className="mb-5 flex items-center gap-2 shrink-0">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-red-50">
            <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
          </div>
          <h3 className="text-sm font-bold text-foreground">집중 공략 필요</h3>
        </div>

        {showEmptyState ? (
          <div className="flex flex-1 flex-col items-center justify-center py-8 text-center px-4">
            <p className="text-sm font-medium leading-relaxed text-slate-500">
              {emptyMsg}
            </p>
          </div>
        ) : (
          <>
        <div className="flex flex-1 flex-col gap-3">
          {displayItems.length > 0 ? (
            displayItems.map((item, idx) => {
              const style = getRateColor(item.rate);
              return (
                <div key={idx} className={`rounded-xl ${style.bg} p-4`}>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm font-bold text-foreground">
                      {item.name}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <span className={`text-[10px] font-bold ${style.text}`}>
                        {style.label}
                      </span>
                      <span className="text-sm font-black text-foreground">
                        {item.rate}%
                      </span>
                    </div>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-white/60">
                    <div
                      className={`h-full rounded-full ${style.bar} transition-all duration-700`}
                      style={{ width: `${item.rate}%` }}
                    />
                  </div>
                </div>
              );
            })
          ) : (
            <p className="text-sm font-medium leading-relaxed text-muted-foreground text-center py-6 px-2">
              {hasLearningHistory
                ? "취약점이 없습니다. 계속 응시해 보세요."
                : "모의고사를 응시하면 AI분석이 활성화됩니다."}
            </p>
          )}
        </div>

        {displayItems.length > 0 && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (isPremium) onRetry();
              else onUpgrade();
            }}
            className="mt-5 flex w-full items-center justify-center rounded-xl border border-slate-200 bg-slate-50 py-3 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-100 hover:border-slate-300"
          >
            약점 개념 다시 풀기
          </button>
        )}
          </>
        )}
      </div>
    </div>
  );
}
