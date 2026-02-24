import React from "react";
import { Lock } from "lucide-react";
import type { SubjectScore } from "../../services/statsService";

interface SubjectBalanceProps {
  scores: SubjectScore[];
  isPremium: boolean;
  onUpgrade: () => void;
}

function getScoreColor(score: number) {
  if (score >= 80) return "bg-emerald-500";
  if (score >= 60) return "bg-[#0034d3]";
  return "bg-red-500";
}

export function SubjectBalance({ scores, isPremium, onUpgrade }: SubjectBalanceProps) {
  if (!isPremium) {
    return (
      <div className="relative min-h-[200px] rounded-2xl border border-border bg-card p-4 flex flex-col items-center justify-center">
        <div className="absolute inset-0 flex flex-col items-center justify-center rounded-2xl bg-background/80 z-10">
          <Lock className="w-8 h-8 text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground text-center px-4">열공 모드 가입 후 과목별 점수를 확인하세요</p>
          <button
            type="button"
            onClick={onUpgrade}
            className="mt-3 text-sm font-medium text-primary hover:underline"
          >
            열공 모드 알아보기
          </button>
        </div>
        <div className="w-full opacity-30 pointer-events-none space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground w-24">과목 {i}</span>
              <div className="flex-1 h-3 rounded-full bg-muted" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!scores.length) {
    return (
      <div className="min-h-[200px] rounded-2xl border border-border bg-card p-4 flex items-center justify-center">
        <p className="text-sm text-muted-foreground">아직 데이터가 부족합니다. 모의고사를 완료하면 과목별 점수가 표시됩니다.</p>
      </div>
    );
  }

  return (
    <div className="min-h-[200px] rounded-2xl border border-border bg-card p-4">
      <h3 className="text-sm font-semibold text-foreground mb-3">과목별 밸런스</h3>
      <div className="space-y-3">
        {scores.map((s) => (
          <div key={s.subjectNumber} className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground w-24 truncate">{s.subject}</span>
            <div className="flex-1 h-3 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full ${getScoreColor(s.score)}`}
                style={{ width: `${Math.min(100, Math.max(0, s.score))}%` }}
              />
            </div>
            <span className="text-xs font-medium tabular-nums w-8">{s.score}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
