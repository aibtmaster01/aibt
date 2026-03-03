import type { ReactNode } from "react";
import { Database, Code, FileText, Plus } from "lucide-react";
import { CERTIFICATIONS, DISABLED_CERT_IDS } from "../../constants";
import { APP_BRAND_LANDING } from "../../config/brand";
import { getCertDisplayName } from "../../services/gradingService";
import { useAllCertificationInfos } from "../../hooks/useCertificationInfo";

interface EmptyStateProps {
  onStartCert: (certId: string) => void;
}

export function EmptyState({ onStartCert }: EmptyStateProps) {
  const { certInfos } = useAllCertificationInfos();
  const iconMap: Record<string, ReactNode> = {
    BIGDATA: <Database className="h-6 w-6" />,
    SQLD: <Code className="h-6 w-6" />,
    ADSP: <FileText className="h-6 w-6" />,
  };

  return (
    <div className="mx-auto max-w-4xl px-5 py-16">
      <p className="mb-8 text-center text-3xl font-black tracking-tight text-[#1e56cd] md:text-4xl">
        {APP_BRAND_LANDING}
      </p>
      <div className="mb-10 text-center">
        <h1 className="text-2xl font-black text-foreground">
          나의 학습 대시보드
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          아직 학습 기록이 없습니다. 자격증을 추가하고 시작해보세요.
        </p>
      </div>

      <div className="grid gap-5 md:grid-cols-3">
        {CERTIFICATIONS.map((cert) => {
          const isDisabled = DISABLED_CERT_IDS.includes(cert.id);
          return (
            <button
              key={cert.id}
              type="button"
              onClick={() => !isDisabled && onStartCert(cert.id)}
              disabled={isDisabled}
              className={`group flex flex-col items-center rounded-2xl border p-7 text-center transition-all ${
                isDisabled
                  ? "cursor-not-allowed border-slate-100 bg-slate-50 opacity-60 grayscale"
                  : "border-slate-200 bg-card hover:border-brand-300 hover:shadow-lg hover:shadow-brand-400/10"
              }`}
            >
              <div className={`mb-4 flex h-14 w-14 items-center justify-center rounded-2xl ${isDisabled ? "bg-slate-200 text-slate-400" : "bg-slate-50 text-slate-700 transition-colors group-hover:bg-brand-400 group-hover:text-slate-900"}`}>
                {iconMap[cert.code]}
              </div>
              <h3 className={`text-base font-bold ${isDisabled ? "text-slate-400" : "text-foreground"}`}>
                {getCertDisplayName(cert, certInfos[cert.code] ?? null)}
              </h3>
              <p className={`mt-1 text-xs ${isDisabled ? "text-slate-400" : "text-muted-foreground"}`}>
                {cert.description}
              </p>
              {isDisabled ? (
                <span className="mt-4 text-xs text-slate-400">준비 중</span>
              ) : (
                <span className="mt-4 flex items-center gap-1 text-sm font-bold text-brand-600">
                  추가하기 <Plus className="h-4 w-4" />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
