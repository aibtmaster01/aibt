import {
  X,
  Database,
  Code,
  FileText,
  Check,
  ChevronRight,
  Trophy,
} from "lucide-react";
import { CERTIFICATIONS, DISABLED_CERT_IDS } from "../../constants";
import { getCertDisplayName } from "../../services/gradingService";
import { useAllCertificationInfos } from "../../hooks/useCertificationInfo";
import type { Certification } from "../../types";

interface AddCertModalProps {
  isOpen: boolean;
  onClose: () => void;
  subscriptions: Certification[];
  onAdd: (certId: string) => void;
}

export function AddCertModal({
  isOpen,
  onClose,
  subscriptions,
  onAdd,
}: AddCertModalProps) {
  const { certInfos } = useAllCertificationInfos();
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center">
      <div
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      />
      <div className="animate-slide-up relative z-10 w-full max-h-[80vh] overflow-y-auto rounded-t-3xl bg-card p-7 shadow-2xl md:w-[440px] md:rounded-3xl">
        <button
          onClick={onClose}
          className="absolute right-5 top-5 flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-foreground"
        >
          <X className="h-5 w-5" />
        </button>

        <h2 className="text-xl font-black text-foreground">
          새로운 도전 시작하기
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          추가할 자격증을 선택해주세요.
        </p>

        <div className="mt-6 flex flex-col gap-3">
          {CERTIFICATIONS.map((cert) => {
            const isSubscribed = subscriptions.some((sub) => sub.id === cert.id);
            const isDisabledCert = DISABLED_CERT_IDS.includes(cert.id);
            const unable = isSubscribed || isDisabledCert;
            return (
              <button
                key={cert.id}
                type="button"
                onClick={() => {
                  if (!unable) {
                    onAdd(cert.id);
                    onClose();
                  }
                }}
                disabled={unable}
                className={`flex items-center justify-between rounded-2xl border p-4 text-left transition-all ${
                  unable
                    ? "cursor-not-allowed border-slate-100 bg-slate-50 opacity-60"
                    : "border-slate-200 bg-card hover:border-brand-300 hover:shadow-md"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`flex h-10 w-10 items-center justify-center rounded-xl ${
                      unable ? "bg-slate-200 text-slate-400" : "bg-brand-50 text-brand-600"
                    }`}
                  >
                    {cert.code === "BIGDATA" ? (
                      <Database className="h-5 w-5" />
                    ) : cert.code === "SQLD" ? (
                      <Code className="h-5 w-5" />
                    ) : (
                      <FileText className="h-5 w-5" />
                    )}
                  </div>
                  <div>
                    <h3
                      className={`text-sm font-bold ${unable ? "text-slate-400" : "text-foreground"}`}
                    >
                      {getCertDisplayName(cert, certInfos[cert.code] ?? null)}
                    </h3>
                    {isSubscribed && (
                      <span className="flex items-center gap-1 text-[11px] font-bold text-green-600">
                        <Check className="h-3 w-3" /> 이미 구독중
                      </span>
                    )}
                    {!isSubscribed && isDisabledCert && (
                      <span className="text-[11px] text-slate-400">준비 중</span>
                    )}
                  </div>
                </div>
                {!unable && (
                  <ChevronRight className="h-4 w-4 text-slate-300" />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

interface PassModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function PassModal({ isOpen, onClose }: PassModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-5">
      <div
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      />
      <div className="animate-scale-in relative z-10 w-full max-w-sm rounded-3xl bg-card p-7 shadow-2xl text-center">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-green-100 text-green-600">
          <Trophy className="h-7 w-7" />
        </div>
        <h3 className="text-lg font-black text-foreground">
          합격을 축하합니다!
        </h3>
        <p className="mt-2 text-sm text-muted-foreground">
          합격 후기를 남겨주시면 명예의 전당에 등재됩니다.
        </p>
        <div className="mt-6 flex flex-col gap-2.5">
          <button
            onClick={() => {
              alert("후기 작성 페이지로 이동합니다. (Demo)");
              onClose();
            }}
            className="rounded-xl bg-green-500 py-3 text-sm font-bold text-white transition-colors hover:bg-green-600"
          >
            후기 남기기
          </button>
          <button
            onClick={onClose}
            className="rounded-xl bg-slate-100 py-3 text-sm font-bold text-slate-600 transition-colors hover:bg-slate-200"
          >
            나중에 할게요
          </button>
        </div>
      </div>
    </div>
  );
}

interface FailCouponModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCheckout: () => void;
}

export function FailCouponModal({
  isOpen,
  onClose,
  onCheckout,
}: FailCouponModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-5">
      <div
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      />
      <div className="animate-scale-in relative z-10 w-full max-w-sm rounded-3xl bg-card p-7 shadow-2xl text-center">
        <div className="mb-4 inline-block rounded-full bg-brand-400 px-4 py-1.5 text-sm font-black text-slate-900">
          50% 할인
        </div>
        <h3 className="text-lg font-black text-foreground">
          다음 회차 대비 50% 할인권
        </h3>
        <p className="mt-2 text-sm text-muted-foreground">
          재도전을 응원합니다! 50% 할인 쿠폰을 드려요.
        </p>
        <button
          onClick={() => {
            onCheckout();
            onClose();
          }}
          className="mt-6 w-full rounded-xl bg-brand-400 py-3.5 text-sm font-black text-slate-900 shadow-lg transition-colors hover:bg-brand-500"
        >
          50% 할인 적용하여 결제하기
        </button>
        <button
          onClick={onClose}
          className="mt-2.5 w-full rounded-xl bg-slate-100 py-3 text-sm font-bold text-slate-600 transition-colors hover:bg-slate-200"
        >
          나중에 할게요
        </button>
      </div>
    </div>
  );
}
