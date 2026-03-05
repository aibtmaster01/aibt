import { useState, useRef, useEffect } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import {
  TrendingUp,
  RotateCcw,
  FileText,
  Check,
  X as XIcon,
} from "lucide-react";
import { useIsMobile } from "../../hooks/use-mobile";
import type { TrendDataItem } from "../../services/statsService";
import { EXAM_ROUNDS } from "../../constants";

function getRoundLabel(roundId: string | null | undefined): string {
  if (!roundId) return "모의고사";
  const round = EXAM_ROUNDS.find((r) => r.id === roundId);
  return round?.title ?? `${roundId}회차`;
}

/** PC 10회 이상 / 모바일 6회 이상이면 가로 스크롤 */
const PC_SCROLL_THRESHOLD = 10;
const MOBILE_SCROLL_THRESHOLD = 6;
const PC_PER_POINT_PX = 64;
const MOBILE_PER_POINT_PX = 56;

interface ScoreTrendProps {
  data: TrendDataItem[];
  onRetryRound?: (roundId: string) => void;
  onWrongAnswers?: (examId: string) => void;
}

export function ScoreTrend({ data, onRetryRound, onWrongAnswers }: ScoreTrendProps) {
  const isMobile = useIsMobile();
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [tappedMobileIdx, setTappedMobileIdx] = useState<number | null>(null);
  const dotPositionsRef = useRef<Record<number, { x: number; y: number }>>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number>(640);

  const scrollMode =
    isMobile ? data.length >= MOBILE_SCROLL_THRESHOLD : data.length >= PC_SCROLL_THRESHOLD;
  const chartWidth = scrollMode
    ? data.length * (isMobile ? MOBILE_PER_POINT_PX : PC_PER_POINT_PX)
    : null;

  useEffect(() => {
    if (scrollMode || !containerRef.current) return;
    const el = containerRef.current;
    const observer = new ResizeObserver(() => {
      if (el) setContainerWidth(Math.max(200, el.offsetWidth));
    });
    observer.observe(el);
    setContainerWidth(Math.max(200, el.offsetWidth));
    return () => observer.disconnect();
  }, [scrollMode, data.length]);

  const handleTickClick = (index: number) => {
    setSelectedIdx(index === selectedIdx ? null : index);
  };

  const CustomDot = (props: Record<string, unknown>) => {
    const { cx, cy, index } = props as { cx: number; cy: number; index: number };
    const payload = (props as { payload: TrendDataItem }).payload;
    const isPass = payload.isPass ?? payload.score >= 60;
    const color = isPass ? "#22c55e" : "#ef4444";
    const isSelected = selectedIdx === index;

    dotPositionsRef.current[index] = { x: cx, y: cy };

    return (
      <g>
        <circle
          cx={cx}
          cy={cy}
          r={24}
          fill="transparent"
          onClick={(e) => {
            e.stopPropagation();
            if (!isMobile) handleTickClick(index);
          }}
          className="cursor-pointer"
        />
        {isSelected && !isMobile && (
          <circle
            cx={cx}
            cy={cy}
            r={14}
            fill={color}
            opacity={0.15}
            className="pointer-events-none"
          />
        )}
        <circle
          cx={cx}
          cy={cy}
          r={isSelected && !isMobile ? 7 : 5}
          fill={color}
          stroke="white"
          strokeWidth={3}
          className="pointer-events-none transition-all duration-200"
        />
      </g>
    );
  };

  const CustomXAxisTick = (props: Record<string, unknown>) => {
    const { x, y, index } = props as { x: number; y: number; index: number };
    const payload = (props as { payload: { value: string } }).payload;
    const isSelected = index === selectedIdx;

    return (
      <g transform={`translate(${x},${y})`}>
        {!isMobile && (
          <rect
            x={-22}
            y={4}
            width={44}
            height={26}
            rx={8}
            fill={isSelected ? "#0f172a" : "transparent"}
            className="transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              handleTickClick(index);
            }}
            style={{ cursor: "pointer" }}
          />
        )}
        <text
          x={0}
          y={0}
          dy={22}
          textAnchor="middle"
          fill={isSelected && !isMobile ? "#ffffff" : "#94a3b8"}
          fontWeight="700"
          onClick={(e) => {
            e.stopPropagation();
            if (!isMobile) handleTickClick(index);
          }}
          className={!isMobile ? "cursor-pointer" : ""}
          style={{ fontSize: 11, userSelect: "none" }}
        >
          {payload.value}
        </text>
      </g>
    );
  };

  const selectedData = selectedIdx !== null ? data[selectedIdx] : null;
  const popupPos =
    selectedIdx !== null ? dotPositionsRef.current[selectedIdx] : null;

  const reversedData = [...data].reverse();

  return (
    <div
      className="chart-no-focus-outline rounded-2xl border border-slate-200 bg-card p-5 md:p-6"
      onClick={() => {
        setSelectedIdx(null);
        setTappedMobileIdx(null);
      }}
    >
      <div className="mb-4 flex flex-col gap-1 md:mb-5 md:flex-row md:items-center md:justify-between md:gap-0">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-slate-400" />
          <h3 className="text-sm font-bold text-foreground">성적 향상 추이</h3>
        </div>
        <p className="text-[11px] leading-relaxed text-muted-foreground md:text-xs">
          {isMobile
            ? "항목을 눌러 재응시/오답확인"
            : "회차를 선택하면 재응시 및 오답확인이 가능합니다"}
        </p>
      </div>

      <div
        ref={containerRef}
        className="overflow-x-auto pb-2 no-scrollbar w-full"
      >
        {data.length === 0 ? (
          <div
            className="flex flex-1 items-center justify-center py-16"
            style={{ minHeight: isMobile ? 180 : 240 }}
          >
            <p className="text-sm text-muted-foreground">데이터가 없습니다.</p>
          </div>
        ) : (
        <div
          className="relative"
          style={{
            width: chartWidth ?? "100%",
            minWidth: chartWidth ?? Math.max(200, containerWidth),
            height: isMobile ? 180 : 240,
            minHeight: isMobile ? 180 : 240,
          }}
        >
          <ResponsiveContainer
            width={chartWidth ?? Math.max(200, containerWidth)}
            height={isMobile ? 180 : 240}
            minWidth={200}
            minHeight={160}
          >
            <LineChart
              data={data}
              margin={{
                bottom: 20,
                right: 16,
                left: -8,
                top: isMobile ? 4 : 0,
              }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                vertical={false}
                stroke="#f1f5f9"
              />
              <XAxis
                dataKey="name"
                axisLine={false}
                tickLine={false}
                dy={10}
                interval={0}
                tick={<CustomXAxisTick />}
                padding={{ left: 24, right: 24 }}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fill: "#94a3b8", fontSize: 11 }}
                domain={[0, 100]}
                width={32}
              />
              <Line
                type="monotone"
                dataKey="score"
                stroke="#0f172a"
                strokeWidth={2.5}
                dot={<CustomDot />}
                activeDot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>

          {!isMobile && data.length > 0 && selectedData && popupPos && (
            <div
              className="animate-scale-in absolute z-20 w-56 rounded-xl border border-slate-200 bg-card p-4 shadow-xl"
              style={{
                left: (() => {
                  const w = chartWidth ?? containerWidth;
                  return Math.min(Math.max(16, popupPos.x - 112), Math.max(16, w - 232));
                })(),
                top: Math.max(0, popupPos.y - 180),
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <p className="text-[11px] font-bold text-foreground mb-0.5">
                {selectedData.roundLabel ?? getRoundLabel(selectedData.roundId)}
              </p>
              <p className="text-[11px] font-medium text-muted-foreground mb-2">
                학습일 {selectedData.date}
              </p>
              <div className="mb-3 flex items-baseline justify-between gap-2">
                <div className="flex items-baseline gap-1.5">
                  <span
                    className={`text-2xl font-black ${
                      selectedData.score >= 60
                        ? "text-green-600"
                        : "text-red-500"
                    }`}
                  >
                    {selectedData.score}
                  </span>
                  <span className="text-sm font-bold text-muted-foreground">
                    점
                  </span>
                  <span
                    className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
                      selectedData.score >= 60
                        ? "bg-green-100 text-green-700"
                        : "bg-red-100 text-red-600"
                    }`}
                  >
                    {selectedData.isPass ?? selectedData.score >= 60
                      ? "합격"
                      : "불합격"}
                  </span>
                </div>
                {typeof selectedData.totalQuestions === "number" &&
                  typeof selectedData.correctCount === "number" && (
                    <span className="text-[11px] text-slate-500">
                      오답{" "}
                      {selectedData.totalQuestions - selectedData.correctCount}
                      개
                    </span>
                  )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() =>
                    selectedData.roundId
                      ? onRetryRound?.(selectedData.roundId)
                      : alert("재응시할 회차 정보가 없습니다.")
                  }
                  className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-slate-900 py-2 text-[11px] font-bold text-white hover:bg-slate-800"
                >
                  <RotateCcw className="h-3 w-3" /> 재응시
                </button>
                <button
                  onClick={() =>
                    selectedData.examId
                      ? onWrongAnswers?.(selectedData.examId)
                      : alert("오답노트 기능은 준비중입니다.")
                  }
                  className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-slate-200 bg-card py-2 text-[11px] font-bold text-slate-600 hover:bg-slate-50"
                >
                  <FileText className="h-3 w-3" /> 오답
                </button>
              </div>
            </div>
          )}
        </div>
        )}
      </div>

      {isMobile && data.length > 0 && (
        <div className="mt-4 flex flex-col gap-1.5">
          {reversedData.map((item, i) => {
            const isPass = item.isPass ?? item.score >= 60;
            const isExpanded = tappedMobileIdx === i;
            const wrongCount =
              typeof item.totalQuestions === "number" &&
              typeof item.correctCount === "number"
                ? item.totalQuestions - item.correctCount
                : null;
            return (
              <div key={item.examId ?? i} className="overflow-hidden rounded-xl bg-slate-50">
                <button
                  className="flex w-full items-center justify-between px-4 py-3 text-left active:bg-slate-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    setTappedMobileIdx(isExpanded ? null : i);
                  }}
                >
                  <div className="flex flex-col items-start gap-0.5">
                    <span className="text-[13px] font-bold text-foreground">
                      {item.roundLabel ?? getRoundLabel(item.roundId)}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {item.name} · {item.date}
                    </span>
                  </div>
                  <span
                    className={`flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-bold ${
                      isPass
                        ? "bg-green-100 text-green-700"
                        : "bg-red-100 text-red-600"
                    }`}
                  >
                    {isPass ? (
                      <Check className="h-3 w-3" />
                    ) : (
                      <XIcon className="h-3 w-3" />
                    )}
                    {`${item.score}점`}
                  </span>
                </button>

                {isExpanded && (
                  <div className="border-t border-slate-100 px-4 py-2.5 animate-fade-in">
                    {wrongCount !== null && (
                      <p className="text-[11px] text-slate-500 mb-2">
                        오답 {wrongCount}개
                      </p>
                    )}
                    <div className="flex gap-2">
                      <button
                        onClick={() =>
                          item.roundId
                            ? onRetryRound?.(item.roundId)
                            : alert("재응시할 회차 정보가 없습니다.")
                        }
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-slate-900 py-2 text-[11px] font-bold text-white active:bg-slate-700"
                      >
                        <RotateCcw className="h-3 w-3" />
                        재응시
                      </button>
                      <button
                        onClick={() =>
                          item.examId
                            ? onWrongAnswers?.(item.examId)
                            : alert("오답노트 기능은 준비중입니다.")
                        }
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white py-2 text-[11px] font-bold text-slate-600 active:bg-slate-50"
                      >
                        <FileText className="h-3 w-3" />
                        오답확인
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
