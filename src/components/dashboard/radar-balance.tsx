import React from "react";
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis } from "recharts";
import { Lock } from "lucide-react";
import type { RadarDataItem } from "../../services/statsService";

interface RadarBalanceProps {
  data: RadarDataItem[];
  loading?: boolean;
  isPremium: boolean;
  problemTypeDescriptions?: Record<string, string> | null;
  onUpgrade: () => void;
  onRetry: () => void;
}

export function RadarBalance({
  data,
  loading = false,
  isPremium,
  onUpgrade,
  onRetry,
}: RadarBalanceProps) {
  const chartData = data.map((d) => ({ ...d, fullMark: d.fullMark ?? 100 }));

  if (!isPremium) {
    return (
      <div className="relative min-h-[280px] rounded-2xl border border-border bg-card p-4 flex flex-col items-center justify-center">
        <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-background/80 z-10">
          <Lock className="w-8 h-8 text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground text-center px-4">열공 모드 가입 후 유형별 밸런스를 확인하세요</p>
          <button
            type="button"
            onClick={onUpgrade}
            className="mt-3 text-sm font-medium text-primary hover:underline"
          >
            열공 모드 알아보기
          </button>
        </div>
        <div className="w-full opacity-30 pointer-events-none flex items-center justify-center" style={{ height: 256 }}>
            <RadarChart width={280} height={250} data={chartData.length ? chartData : [{ subject: "-", A: 0, fullMark: 100 }]}>
              <PolarGrid stroke="hsl(var(--border))" strokeOpacity={0.6} />
              <PolarAngleAxis dataKey="subject" tick={{ fontSize: 10 }} axisLine={false} />
              <PolarRadiusAxis angle={90} domain={[0, 100]} axisLine={false} tick={false} />
              <Radar name="정답률" dataKey="A" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.4} />
            </RadarChart>
        </div>
      </div>
    );
  }

  if (loading || !chartData.length) {
    return (
      <div className="min-h-[280px] rounded-2xl border border-border bg-card p-4 flex items-center justify-center">
        <p className="text-sm text-muted-foreground">
          {loading ? "로딩 중..." : "아직 데이터가 부족합니다. 모의고사를 1회 이상 완료하면 유형별 밸런스가 표시됩니다."}
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-[280px] rounded-2xl border border-border bg-card p-4">
      <h3 className="text-sm font-semibold text-foreground mb-3">유형별 밸런스</h3>
      <div className="flex items-center justify-center" style={{ height: 256 }}>
          <RadarChart width={280} height={250} data={chartData}>
            <PolarGrid stroke="hsl(var(--border))" strokeOpacity={0.6} />
            <PolarAngleAxis dataKey="subject" tick={{ fontSize: 10 }} axisLine={false} />
            <PolarRadiusAxis angle={90} domain={[0, 100]} axisLine={false} tick={false} />
            <Radar name="정답률" dataKey="A" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.4} />
          </RadarChart>
      </div>
    </div>
  );
}
