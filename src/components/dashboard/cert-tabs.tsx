import { Plus, ChevronDown } from "lucide-react";
import { getCertDisplayName } from "../../services/gradingService";
import { useAllCertificationInfos } from "../../hooks/useCertificationInfo";
import type { Certification } from "../../types";

export interface ExamScheduleOption {
  id: string;
  label: string;
}

interface CertTabsProps {
  subscriptions: Certification[];
  activeCertId: string;
  onSelect: (id: string) => void;
  onAddCert: () => void;
  seasonOptions: ExamScheduleOption[];
  selectedSeason: string | null;
  onSeasonChange: (val: string | null) => void;
}

export function CertTabs({
  subscriptions,
  activeCertId,
  onSelect,
  onAddCert,
  seasonOptions,
  selectedSeason,
  onSeasonChange,
}: CertTabsProps) {
  const { certInfos } = useAllCertificationInfos();
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
        {subscriptions.map((cert) => (
          <button
            key={cert.id}
            onClick={() => onSelect(cert.id)}
            className={`whitespace-nowrap rounded-xl px-4 py-2 text-sm font-bold transition-all ${
              activeCertId === cert.id
                ? "bg-slate-900 text-white shadow-md"
                : "bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700"
            }`}
          >
            {getCertDisplayName(cert, certInfos[cert.code] ?? null)}
          </button>
        ))}
        <button
          onClick={onAddCert}
          className="flex items-center gap-1 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-bold text-muted-foreground transition-colors hover:bg-brand-50 hover:text-brand-600"
        >
          <Plus className="h-4 w-4" />
          추가
        </button>
      </div>

      {seasonOptions.length > 0 && (
        <div className="relative shrink-0">
          <select
            value={selectedSeason ?? "__latest__"}
            onChange={(e) =>
              onSeasonChange(
                e.target.value === "__latest__" ? null : e.target.value
              )
            }
            className="appearance-none rounded-xl border border-slate-200 bg-card px-4 py-2 pr-9 text-sm font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-brand-400"
          >
            <option value="__latest__">최신 회차</option>
            {seasonOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        </div>
      )}
    </div>
  );
}
