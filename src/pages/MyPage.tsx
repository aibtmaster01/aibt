import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";
import type { User } from "../types";
import { CERTIFICATIONS, EXAM_SCHEDULE_DATES, EXAM_ROUNDS, SUBJECT_NAMES_BY_CERT, PROBLEM_TYPE_LABELS } from "../constants";
import { getDaysLeft, getNearestExamDate, getPurchasedSchedulesForCert, getDaysLeftForDateId, getNearestExamFromCertInfo, formatExamDateDisplay } from "../utils/dateUtils";
import {
  fetchHasAnyExamRecord,
} from "../services/statsService";
import { getCachedOrFetchMyPageData } from "../services/statsServiceWithCache";
import { getCertificationInfo, getCertDisplayName } from "../services/gradingService";
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis } from "recharts";
import { EmptyState } from "../components/dashboard/empty-state";
import {
  PostExamBanner,
  ExpiredBanner,
  DataPreservationCard,
} from "../components/dashboard/banners";
import {
  AddCertModal,
  PassModal,
  FailCouponModal,
} from "../components/dashboard/modals";
import { Skeleton } from "../components/ui/skeleton";
import { Lock, ChevronRight, ChevronDown, FileX, HelpCircle } from "lucide-react";
import { mockDashboardStats, MY_PAGE_EMPTY_MESSAGES } from "../data/myPageMockData";
import { BIGDATA_CORE_CONCEPTS_BY_ID } from "../data/bigdataCoreConceptsById";

function formatExamDate(dateId: string | undefined): string {
  if (!dateId) return "";
  const raw = EXAM_SCHEDULE_DATES[dateId];
  if (!raw) return "";
  const [y, m, d] = raw.split("-");
  return `${y}년 ${parseInt(m ?? "1", 10)}월 ${parseInt(d ?? "1", 10)}일`;
}

function getPassRateMessage(rate: number) {
  if (rate >= 80) return "합격이 눈앞이에요! 이 페이스를 유지하세요";
  if (rate >= 60) return "열심히 하고있어요! 이대로만 계속해요";
  if (rate >= 40) return "조금만 더 힘내볼까요? 화이팅!";
  return "기초부터 차근차근 시작해봐요";
}

/**
 * 나의 학습 기록·모의고사 목록과 동일한 회차 라벨
 * - 연습/응용/실전(round 1~3): 회차 없이 제목만 (연습 모의고사, 응용 모의고사, 실전 모의고사)
 * - 약점 공략(round 6+): "약점 공략 모의고사 1회", "2회", … (목록 순서와 동일)
 */
function getRoundLabel(roundId: string | null | undefined, _certId?: string): string {
  if (!roundId) return "모의고사";
  const round = EXAM_ROUNDS.find((r) => r.id === roundId);
  if (!round) return `${roundId}회차`;
  if (round.round <= 3) return round.title; // 연습/응용/실전 — 회차 없음
  return `약점 공략 모의고사 ${round.round - 5}회`; // 큐레이션(6→1회, 7→2회, …)
}

/** DB problem_type_descriptions 키가 공백/표기 차이일 수 있어 유연 매칭 후, 없으면 기본 설명 반환 */
const DEFAULT_TYPE_DESCRIPTIONS: Record<string, string> = {
  단순암기형: "용어·정의·개념을 그대로 기억하고 재현하는 문항입니다.",
  개념이해형: "개념의 의미와 관계를 이해하고 적용하는 문항입니다.",
  계산풀이형: "수식·계산·도출 과정을 수행하는 문항입니다.",
  결과독해형: "제시된 결과·표·그래프를 해석하는 문항입니다.",
  실무적용형: "실제 업무 상황에 맞춰 판단·적용하는 문항입니다.",
};

function getProblemTypeDescription(
  certInfo: Awaited<ReturnType<typeof getCertificationInfo>> | null,
  label: string
): string {
  const map = certInfo?.problem_type_descriptions;
  if (map && typeof map === "object") {
    const exact = map[label];
    if (exact && typeof exact === "string") return exact;
    const noSpaces = label.replace(/\s+/g, "");
    for (const [k, v] of Object.entries(map)) {
      if (typeof v !== "string") continue;
      if (k === label || k.replace(/\s+/g, "") === noSpaces) return v;
    }
  }
  return DEFAULT_TYPE_DESCRIPTIONS[label] ?? "해당 유형에 대한 설명이 등록되지 않았습니다.";
}

export interface MyPageProps {
  user: User;
  /** URL ?cert=xxx 로 진입 시 표시할 자격증 (예: 사이드바 목록에서 자격증 선택) */
  initialCertId?: string;
  onNavigate: (path: string) => void;
  onSelectExam: (certId: string) => void;
  onStartNewCert: (certId: string) => void;
  onUpdateUser?: (updater: (prev: User) => User) => void;
  onStartWeaknessRetry?: (certId: string) => void;
  /** 과목 강화 학습 (전체 과목 50문항 큐레이션 후 퀴즈) */
  onStartSubjectStrengthTraining?: (certId: string) => void;
  /** 과목 강화 학습 재선별 중 오버레이 표시 */
  showSubjectStrengthPreparing?: boolean;
  /** 취약 유형 집중학습 (유형 1,2,3위 50문항) */
  onStartWeakTypeFocus?: (certId: string) => void;
  showWeakTypePreparing?: boolean;
  /** 취약 개념 집중학습 (이해도 하위 2~10개 개념 50문항) */
  onStartWeakConceptFocus?: (certId: string) => void;
  showWeakConceptPreparing?: boolean;
  /** 오답확인 클릭 시 해당 시험 결과 화면으로 이동 (examId로 결과 로드 후 결과 페이지로 이동) */
  onViewExamResult?: (examId: string) => void;
  onLogout?: () => void;
}

export const MyPage: React.FC<MyPageProps> = ({
  user,
  initialCertId,
  onNavigate,
  onSelectExam,
  onStartNewCert,
  onUpdateUser,
  onStartWeaknessRetry,
  onStartSubjectStrengthTraining,
  showSubjectStrengthPreparing,
  onStartWeakTypeFocus,
  showWeakTypePreparing,
  onStartWeakConceptFocus,
  showWeakConceptPreparing,
  onViewExamResult,
  onLogout,
}) => {
  const [activeCertId, setActiveCertId] = useState<string>(
    user.subscriptions?.[0]?.id ?? user.paidCertIds?.[0] ?? CERTIFICATIONS[0].id
  );
  const [isAddCertOpen, setIsAddCertOpen] = useState(false);
  const [isPassModalOpen, setIsPassModalOpen] = useState(false);
  const [isFailModalOpen, setIsFailModalOpen] = useState(false);
  const [showWeaknessPaymentModal, setShowWeaknessPaymentModal] = useState(false);
  const [openKeywordPopoverIndex, setOpenKeywordPopoverIndex] = useState<number | null>(null);
  const [hoveredTypeLabel, setHoveredTypeLabel] = useState<string | null>(null);
  const [openSafetyDescPopover, setOpenSafetyDescPopover] = useState(false);
  const [weaknessPaymentModalMessage, setWeaknessPaymentModalMessage] = useState(
    "해당 기능은 열공 모드 가입 후 무제한 이용하실 수 있습니다."
  );
  const [learningRecordsPage, setLearningRecordsPage] = useState(1);
  const [selectedScheduleId, setSelectedScheduleId] = useState<string | null>(null);
  const [scheduleDropdownOpen, setScheduleDropdownOpen] = useState(false);
  const scheduleDropdownRef = useRef<HTMLDivElement>(null);
  const weaknessCardRef = useRef<HTMLDivElement>(null);
  /** 오답확인 모달: 해당 회차 오답 문항 번호 목록 */
  const [wrongAnswersModal, setWrongAnswersModal] = useState<{
    roundLabel: string;
    wrongIndices: number[];
    totalQuestions: number;
  } | null>(null);
  const [wrongAnswersLoading, setWrongAnswersLoading] = useState(false);

  const [trendData, setTrendData] = useState<Awaited<
    ReturnType<typeof getCachedOrFetchMyPageData>
  > | null>(null);
  const [dashboardStats, setDashboardStats] = useState<Awaited<
    ReturnType<typeof getCachedOrFetchMyPageData>
  > | null>(null);
  const [certInfo, setCertInfo] = useState<Awaited<
    ReturnType<typeof getCertificationInfo>
  > | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasExamRecord, setHasExamRecord] = useState<boolean | null>(null);

  const hasPayment = (user.paidCertIds?.length ?? 0) > 0 || user.isPremium === true;
  const effectiveSubscriptions = (() => {
    if ((user.subscriptions?.length ?? 0) > 0) return user.subscriptions!;
    const fromPaid = (user.paidCertIds ?? [])
      .map((id) => CERTIFICATIONS.find((c) => c.id === id))
      .filter(Boolean) as typeof user.subscriptions;
    if (fromPaid.length > 0) return fromPaid;
    if (hasPayment) return [{ id: CERTIFICATIONS[0].id, code: CERTIFICATIONS[0].code }];
    // 학습 이력 없이 사이드바에서 자격증 선택 시 해당 자격증만 표시
    if (initialCertId) {
      const cert = CERTIFICATIONS.find((c) => c.id === initialCertId);
      if (cert) return [{ id: cert.id, code: cert.code }];
    }
    return [];
  })();

  useEffect(() => {
    if (initialCertId && initialCertId !== activeCertId) {
      setActiveCertId(initialCertId);
    }
  }, [initialCertId]);

  useEffect(() => {
    if (!user?.id || hasPayment) {
      setHasExamRecord(true);
      return;
    }
    fetchHasAnyExamRecord(user.id)
      .then(setHasExamRecord)
      .catch(() => setHasExamRecord(false));
  }, [user?.id, hasPayment]);

  useEffect(() => {
    if (!scheduleDropdownOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (scheduleDropdownRef.current && !scheduleDropdownRef.current.contains(e.target as Node)) {
        setScheduleDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [scheduleDropdownOpen]);

  useEffect(() => {
    if (openKeywordPopoverIndex === null) return;
    const close = (e: MouseEvent) => {
      if (weaknessCardRef.current && !weaknessCardRef.current.contains(e.target as Node)) {
        setOpenKeywordPopoverIndex(null);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [openKeywordPopoverIndex]);

  const activeCert = CERTIFICATIONS.find((c) => c.id === activeCertId);
  const isExpired = user.expiredCertIds?.includes(activeCertId);
  const purchasedSchedules = useMemo(
    () => getPurchasedSchedulesForCert(user, activeCertId),
    [user, activeCertId]
  );
  const nearestExam = getNearestExamDate(activeCertId);
  const nearestFromCertInfo = getNearestExamFromCertInfo(certInfo ?? null);

  useEffect(() => {
    const next = purchasedSchedules[0]?.dateId ?? nearestExam?.dateId ?? null;
    setSelectedScheduleId((prev) => (prev && purchasedSchedules.some((s) => s.dateId === prev)) ? prev : next);
    setScheduleDropdownOpen(false);
  }, [activeCertId, purchasedSchedules, nearestExam?.dateId]);

  const selectedSchedule = purchasedSchedules.find((s) => s.dateId === selectedScheduleId)
    ?? purchasedSchedules[0]
    ?? (nearestExam?.dateId ? { dateId: nearestExam.dateId, label: nearestExam.label ?? "", examDate: "" } : null);
  const effectiveScheduleId = selectedSchedule?.dateId ?? nearestExam?.dateId;
  const daysLeft = getDaysLeftForDateId(activeCertId, effectiveScheduleId ?? undefined);
  const examLabel = selectedSchedule?.label ?? nearestExam?.label ?? "다음 시험일";
  const examDateStr = formatExamDate(effectiveScheduleId);
  const isPremiumCert =
    user.isPremium || (user.paidCertIds?.includes(activeCertId) ?? false);

  const loadMyPageData = useCallback((forceRefresh?: boolean) => {
    if (!user?.id || !activeCert?.code) {
      setTrendData(null);
      setDashboardStats(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const certCode = activeCert.code;
    Promise.all([
      getCachedOrFetchMyPageData(user.id, certCode, { forceRefresh }),
      getCertificationInfo(certCode),
    ])
      .then(([cached, info]) => {
        setTrendData(cached);
        setDashboardStats(cached);
        setCertInfo(info ?? null);
      })
      .catch(() => {
        setTrendData({ trendData: [], recentPassRate: 0, radarData: [], subjectScores: [], weaknessTop3: [] });
        setDashboardStats({
          radarData: [],
          subjectScores: [],
          weaknessTop3: [],
        });
      })
      .finally(() => setLoading(false));
  }, [user?.id, activeCert?.code]);

  useEffect(() => {
    loadMyPageData();
  }, [loadMyPageData]);

  const handleNavigate = (path: string) => onNavigate(path);

  const handleWrongAnswers = async (examId: string, roundId: string | null | undefined) => {
    if (!user?.id) return;
    setWrongAnswersLoading(true);
    try {
      const snap = await getDoc(doc(db, 'users', user.id, 'exam_results', examId));
      if (!snap.exists()) {
        alert("해당 회차 결과를 찾을 수 없습니다.");
        return;
      }
      const data = snap.data();
      const answers = (data?.answers ?? []) as { isCorrect?: boolean }[];
      const wrongIndices = answers
        .map((a, i) => (a.isCorrect === false ? i + 1 : null))
        .filter((n): n is number => n !== null);
      setWrongAnswersModal({
        roundLabel: (data as { roundLabel?: string | null }).roundLabel ?? getRoundLabel(roundId, activeCertId),
        wrongIndices,
        totalQuestions: answers.length,
      });
    } catch {
      alert("오답 정보를 불러오는데 실패했습니다.");
    } finally {
      setWrongAnswersLoading(false);
    }
  };

  const showEmptyState = !hasPayment && hasExamRecord === false;
  const gateLoading = !hasPayment && hasExamRecord === null;

  const trend = trendData?.trendData ?? [];
  const recentPassRate = trendData?.recentPassRate ?? 0;
  const radarData = dashboardStats?.radarData ?? [];
  const subjectScores = dashboardStats?.subjectScores ?? [];
  const weaknessTop3 = dashboardStats?.weaknessTop3 ?? [];

  const effectiveDaysLeft = nearestFromCertInfo?.daysLeft ?? daysLeft;
  const dDayText =
    effectiveDaysLeft !== null && effectiveDaysLeft !== undefined
      ? effectiveDaysLeft >= 0
        ? `D-${effectiveDaysLeft}`
        : `D+${Math.abs(effectiveDaysLeft)}`
      : "-";

  const hasLearningHistory = trend.length > 0;
  /** 데이터 없을 땐 목업 미노출 — 딤 뒤 흐릿한 데이터 제거 */
  const displayRecentPassRate = hasLearningHistory ? recentPassRate : 0;
  const displayTrend = hasLearningHistory ? trend : [];
  const displaySubjectScores = hasLearningHistory ? subjectScores : [];
  /** 학습 이력 있으면 유료 여부와 관계없이 실제 유형/취약 데이터 표시 (샘플 문구·물음표 제거) */
  const displayRadarData = hasLearningHistory ? radarData : [];
  const displayWeaknessTop3 = hasLearningHistory ? weaknessTop3 : [];
  /** 무료 회원용 과목별 막대(실제 데이터 있을 때만 사용) */
  const freeSubjectScoresForDisplay = (certInfo?.subjects ?? [
    { subject_number: 1, name: "과목 1", question_count: 20 },
    { subject_number: 2, name: "과목 2", question_count: 20 },
    { subject_number: 3, name: "과목 3", question_count: 20 },
    { subject_number: 4, name: "과목 4", question_count: 20 },
  ]).slice(0, 4).map((s, i) => ({
    subjectNumber: s.subject_number ?? i + 1,
    subject: s.name,
    score: subjectScores[i]?.score ?? 0,
  }));

  const ITEMS_PER_PAGE = 6;
  const totalPages = Math.max(1, Math.ceil(displayTrend.length / ITEMS_PER_PAGE));
  const effectivePage = Math.min(learningRecordsPage, totalPages);
  const paginatedTrend = [...displayTrend].slice(
    (effectivePage - 1) * ITEMS_PER_PAGE,
    effectivePage * ITEMS_PER_PAGE
  );

  const sessionLabel = (selectedSchedule?.label ?? nearestExam?.label ?? "").includes("(")
    ? (selectedSchedule?.label ?? nearestExam?.label ?? "").split(" (")[0]?.trim() ?? selectedSchedule?.label ?? nearestExam?.label ?? ""
    : selectedSchedule?.label ?? nearestExam?.label ?? "";

  const headerSub = nearestFromCertInfo
    ? formatExamDateDisplay(nearestFromCertInfo.examDate)
    : examDateStr || "시험일";
  const certDisplayName = getCertDisplayName(activeCert ?? null, certInfo ?? null);
  const headerTitleRest = nearestFromCertInfo
    ? `${nearestFromCertInfo.label} ${dDayText}${headerSub ? ` · ${headerSub}` : ""}`.trim()
    : `${sessionLabel} ${dDayText}`;

  /** 유형별 분석 카드: problem_type_stats 기반 5개 유형. 데이터 없을 땐 5개 유형 라벨로 fallback (과목 4개 아님) */
  const { radarChartData, weakestSubject } = useMemo(() => {
    const fallback = PROBLEM_TYPE_LABELS.map((label) => ({ subject: label, A: 0, fullMark: 100 }));
    const raw = displayRadarData.length ? displayRadarData : fallback;
    const data = raw.length ? raw.map((d) => ({ ...d, fullMark: 100 })) : [{ subject: "-", A: 0, fullMark: 100 }];
    const valid = data.filter((d) => d.subject !== "-" && typeof d.A === "number");
    const minVal = valid.length ? Math.min(...valid.map((d) => d.A)) : null;
    const weakest = minVal != null ? valid.find((d) => d.A === minVal)?.subject ?? null : null;
    return { radarChartData: data, weakestSubject: weakest };
  }, [displayRadarData]);

  /** 과목별 안전도 분석 카드에서 '해당 과목' = 점수 가장 낮은 과목 (강화 학습 버튼용) */
  const weakestSubjectNumber = useMemo(() => {
    const scores = displaySubjectScores.length ? displaySubjectScores : freeSubjectScoresForDisplay;
    if (scores.length === 0) return 1;
    const min = Math.min(...scores.map((s) => s.score));
    const found = scores.find((s) => s.score === min);
    return found?.subjectNumber ?? 1;
  }, [hasLearningHistory, isPremiumCert, freeSubjectScoresForDisplay, displaySubjectScores]);

  const getSubjectLabel = (subjectNumber: number, fallbackSubject?: string) => {
    const names = SUBJECT_NAMES_BY_CERT[activeCert?.code ?? ""];
    const name = names?.[subjectNumber - 1];
    if (name) return `${subjectNumber}과목   ${name}`;
    return fallbackSubject ?? `${subjectNumber}과목`;
  };

  if (gateLoading) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center">
        <p className="text-gray-500 text-sm">확인 중...</p>
      </div>
    );
  }
  if (showEmptyState && !initialCertId) {
    return <EmptyState onStartCert={(id) => onStartNewCert(id)} />;
  }
  if (effectiveSubscriptions.length === 0 && !initialCertId) {
    return <EmptyState onStartCert={(id) => onStartNewCert(id)} />;
  }

  if (loading) {
    return (
      <div className="flex-1 min-h-0 overflow-y-auto p-4 md:p-8 bg-[#edf1f5]">
        <Skeleton className="h-12 w-64 mb-6" />
        <div className="grid grid-cols-12 gap-6">
          <Skeleton className="col-span-12 lg:col-span-3 h-96 rounded-3xl" />
          <div className="col-span-12 lg:col-span-9 flex flex-col gap-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Skeleton className="h-48 rounded-3xl" />
              <Skeleton className="h-72 rounded-3xl" />
              <Skeleton className="h-72 rounded-3xl" />
            </div>
            <Skeleton className="flex-1 min-h-64 rounded-3xl" />
          </div>
        </div>
      </div>
    );
  }

  const showNoHistoryMessage = showEmptyState && !!initialCertId;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 md:p-8 bg-[#edf1f5] relative">
        {showSubjectStrengthPreparing && (
          <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#edf1f5]/95 backdrop-blur-sm">
            <p className="text-[#1e56cd] font-bold text-lg mb-2">내가 취약한 과목 문제들을 재선별 중입니다...</p>
            <p className="text-slate-600 text-sm">잠시만 기다려 주세요.</p>
          </div>
        )}
        {(showWeakTypePreparing || showWeakConceptPreparing) && (
          <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#edf1f5]/95 backdrop-blur-sm">
            <p className="text-[#1e56cd] font-bold text-lg mb-2">
              {showWeakTypePreparing ? '내가 취약한 유형 문제를 재선별 중입니다...' : '내가 취약한 개념 문제를 재선별 중입니다...'}
            </p>
            <p className="text-slate-600 text-sm">잠시만 기다려 주세요.</p>
          </div>
        )}
        {daysLeft !== null && daysLeft < 0 && (
          <div className="mb-5">
            <PostExamBanner
              onPass={() => setIsPassModalOpen(true)}
              onFail={() => {
                onUpdateUser?.((prev) => ({ ...prev, hasFailedPreviousExam: true }));
                setIsFailModalOpen(true);
              }}
            />
          </div>
        )}

        {isExpired && (
          <div className="mb-5">
            <ExpiredBanner onCheckout={() => handleNavigate("/checkout")} />
          </div>
        )}

        {showNoHistoryMessage && (
          <div className="mb-5 p-5 bg-[#99ccff] border border-[#1e56cd]/30 rounded-2xl">
            <p className="text-slate-900 text-sm font-semibold mb-1">아직 학습 이력이 없어요</p>
            <p className="text-[#1e56cd]/90 text-sm">아래 [학습 시작하기]로 첫 모의고사를 풀어보세요.</p>
          </div>
        )}

        <header className="mb-6 md:mb-8 flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-3xl md:text-4xl tracking-tight font-extrabold flex flex-wrap items-center gap-2">
            <span className="text-[#1e56cd] font-black">{certDisplayName}</span>
            {purchasedSchedules.length > 1 ? (
              <span ref={scheduleDropdownRef} className="relative inline-flex items-center text-[#1e56cd]">
                <span>{sessionLabel}</span>
                <button
                  type="button"
                  onClick={() => setScheduleDropdownOpen((v) => !v)}
                  className="ml-1 p-0.5 rounded hover:bg-[#99ccff] text-[#1e56cd]"
                  aria-label="회차 변경"
                >
                  <ChevronDown size={20} className={scheduleDropdownOpen ? "rotate-180" : ""} />
                </button>
                {scheduleDropdownOpen && (
                  <div className="absolute left-0 top-full mt-1 py-1 min-w-[180px] bg-white rounded-xl border border-slate-200 shadow-lg z-50">
                    {purchasedSchedules.map((s) => {
                      const label = s.label.includes("(") ? s.label.split(" (")[0]?.trim() ?? s.label : s.label;
                      const isSelected = s.dateId === selectedScheduleId;
                      return (
                        <button
                          key={s.dateId}
                          type="button"
                          onClick={() => {
                            setSelectedScheduleId(s.dateId);
                            setScheduleDropdownOpen(false);
                          }}
                          className={`w-full text-left px-4 py-2.5 text-sm rounded-lg ${isSelected ? "bg-[#99ccff] text-[#1e56cd] font-semibold" : "text-slate-700 hover:bg-slate-50"}`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </span>
            ) : null}
            {dDayText ? (
              <span className="inline-flex items-center px-3 py-1 rounded-full text-base font-bold bg-[#1e56cd]/20 text-[#1e56cd] border border-[#1e56cd]/30">
                {dDayText}
              </span>
            ) : null}
          </h1>
        </header>

        <div className={`grid grid-cols-12 gap-6 ${isExpired ? "pointer-events-none opacity-60 grayscale" : ""}`}>
          {/* Left: 예측 합격률 (가우시안 블러 카드) */}
          <div className="col-span-12 lg:col-span-3 backdrop-blur-md bg-[rgb(204,229,255)] rounded-3xl p-6 flex flex-col h-full items-center shadow-md min-h-[420px] lg:min-h-[520px] border border-white/50">
            <h3 className="w-full text-left text-[#1e56cd] text-lg font-bold mb-6">
              예측 합격률
            </h3>
            <div className="relative flex-1 w-full max-w-xs mx-auto flex flex-col min-h-0 items-center">
              {!hasLearningHistory ? (
                <>
                  <p className="text-gray-600 text-sm px-4 whitespace-pre-line text-center font-medium flex-1 flex items-center justify-center">
                    {MY_PAGE_EMPTY_MESSAGES.passRate}
                  </p>
                  {!isExpired && (
                    <div className="mt-auto w-full pt-4">
                      <button
                        type="button"
                        onClick={() => onSelectExam(activeCertId)}
                        className="w-full bg-[#1e56cd] text-white px-6 py-4 rounded-full text-lg font-bold shadow-lg flex items-center justify-center gap-2 hover:bg-[#1e56cd]/90"
                      >
                        학습 시작하기 <ChevronRight className="w-5 h-5" />
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <p className="text-gray-700 text-base font-bold mb-1 text-center w-full">"{getPassRateMessage(displayRecentPassRate)}"</p>
                  <p className="text-slate-500 text-sm mb-3 text-center w-full">모의고사를 풀고 합격률을 올려보세요!</p>
                  <div className="relative flex items-center justify-center mb-5 w-full max-w-[300px] mx-auto">
                    <svg className="w-full h-auto" viewBox="0 0 180 180">
                      <circle cx="90" cy="90" r="70" fill="none" stroke="#edf1f5" strokeWidth="18" />
                      <circle
                        cx="90"
                        cy="90"
                        r="70"
                        fill="none"
                        stroke="#1e56cd"
                        strokeWidth="18"
                        strokeLinecap="round"
                        strokeDasharray={`${(displayRecentPassRate / 100) * 440} 440`}
                        transform="rotate(-90 90 90)"
                      />
                    </svg>
                    <div className="absolute flex flex-col items-center">
                      <span className="text-5xl md:text-6xl font-black text-gray-700 leading-none">
                        {displayRecentPassRate}
                        <span className="text-2xl md:text-3xl">%</span>
                      </span>
                    </div>
                  </div>
                  {!isExpired && (
                    <div className="mt-auto w-full pt-4">
                      <button
                        type="button"
                        onClick={() => onSelectExam(activeCertId)}
                        className="w-full bg-[#1e56cd] text-white px-6 py-4 rounded-full text-lg font-bold shadow-lg flex items-center justify-center gap-2 hover:bg-[#1e56cd]/90"
                      >
                        학습 시작하기 <ChevronRight className="w-5 h-5" />
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Right: 상단 3카드 + 하단 학습 기록 (약 65~70% 너비) */}
          <div className="col-span-12 lg:col-span-9 flex flex-col gap-6">
            {/* 상단 Row: 과목별 안전도 분석 | 유형별 분석 | 취약 개념 분석 */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Card 1: 과목별 안전도 분석 */}
              <div className="bg-white border-2 border-[#99ccff] rounded-3xl p-6 flex flex-col shadow-md min-h-[280px] relative">
                <div className="flex justify-between items-start gap-2 mb-6">
                  <h3 className="text-[#1e56cd] text-base font-bold">과목별 안전도 분석</h3>
                  <div className="relative shrink-0">
                    <button
                      type="button"
                      aria-label="안전도 설명"
                      onClick={() => setOpenSafetyDescPopover((v) => !v)}
                      onBlur={() => setTimeout(() => setOpenSafetyDescPopover(false), 150)}
                      className="p-0.5 rounded text-[#1e56cd] hover:bg-[#99ccff]/50 focus:outline-none focus:ring-2 focus:ring-[#1e56cd]/50"
                    >
                      <HelpCircle className="w-4 h-4" />
                    </button>
                    {openSafetyDescPopover && (
                      <div className="absolute right-0 top-full mt-1 z-30 w-[240px] max-h-[220px] overflow-y-auto rounded-lg bg-slate-800 text-white text-xs shadow-xl py-3 px-3">
                        <p className="font-bold text-slate-200 mb-2">과목별 안전도란?</p>
                        <p className="mb-2">각 과목의 <strong>정답률(%)</strong>을 나타냅니다. 시험 합격에는 전 과목 평균과 함께 <strong>과목별 과락선</strong>을 넘어야 합니다.</p>
                        {certInfo?.exam_config?.pass_criteria && (
                          <p className="text-slate-300 text-[11px] mt-2 pt-2 border-t border-slate-600">
                            과락선: {certInfo.exam_config.pass_criteria.min_subject_score}점 미만인 과목이 있으면 불합격입니다. 평균 {certInfo.exam_config.pass_criteria.average_score}점 이상이어야 합니다.
                          </p>
                        )}
                        <p className="text-slate-400 text-[11px] mt-2">안전도가 낮은 과목은 과목 강화 학습으로 보완해 보세요.</p>
                      </div>
                    )}
                  </div>
                </div>
                <div className="relative flex-1 flex flex-col min-h-0">
                  {!hasLearningHistory ? (
                    <div className="absolute inset-0 flex items-center justify-center z-20 rounded-2xl bg-white">
                      <p className="text-sm text-gray-600 px-4 whitespace-pre-line text-center font-medium">
                        데이터가 없습니다{"\n"}모의고사를 풀고 과목별 안전도를 확인해보세요!
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="w-full space-y-6">
                        {(displaySubjectScores.length ? displaySubjectScores : freeSubjectScoresForDisplay).slice(0, 4).map((s) => (
                          <div key={s.subjectNumber} className="flex items-center gap-3 w-full">
                            <span className="text-sm font-medium text-slate-700 shrink-0 tabular-nums w-14">{s.subjectNumber}과목</span>
                            <div className="flex-1 min-w-0 h-5 bg-slate-200 rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full transition-all min-w-[2px] bg-[#1e56cd]"
                                style={{ width: `${Math.min(100, s.score)}%` }}
                              />
                            </div>
                            <span className="text-sm font-medium text-slate-700 shrink-0 tabular-nums w-10 text-right">
                              {s.score}%
                            </span>
                          </div>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => activeCertId && onStartSubjectStrengthTraining?.(activeCertId)}
                        className="w-full mt-auto bg-[#99ccff] border border-[#99ccff] rounded-xl py-3 px-4 flex justify-between items-center text-sm font-bold text-[#1e56cd] hover:bg-[#b3d9ff] hover:border-[#99ccff]"
                      >
                        <span>과목 강화 학습</span>
                        <ChevronRight className="w-4 h-4 text-[#1e56cd]" />
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Card 2: 유형별 분석 */}
              <div className="bg-white border-2 border-[#99ccff] rounded-3xl p-6 flex flex-col shadow-md min-h-[280px] relative overflow-visible">
                <div className="flex justify-between items-start gap-2 mb-3">
                  <h3 className="text-[#1e56cd] text-base font-bold">유형별 분석</h3>
                </div>
                <div className="relative flex-1 flex flex-col min-h-0">
                  {!hasLearningHistory ? (
                    <div className="absolute inset-0 bg-white flex items-center justify-center z-20 rounded-2xl">
                      <p className="text-sm text-gray-600 px-4 whitespace-pre-line text-center font-medium">
                        {MY_PAGE_EMPTY_MESSAGES.weakness}
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="relative w-full flex-shrink-0 overflow-visible flex items-center justify-center" style={{ height: 208 }}>
                        <RadarChart width={280} height={208}
                            data={radarChartData}
                            margin={{ top: 20, right: 32, bottom: 20, left: 32 }}
                          >
                            <PolarGrid stroke="#e5e7eb" strokeOpacity={0.5} strokeWidth={2} />
                            <PolarAngleAxis
                              dataKey="subject"
                              axisLine={false}
                              tick={({ payload, x, y, textAnchor }) => {
                                const typeName = payload?.value ?? "";
                                return (
                                  <g
                                    onMouseEnter={() => setHoveredTypeLabel(typeName)}
                                    onMouseLeave={() => setHoveredTypeLabel(null)}
                                    style={{ cursor: "pointer" }}
                                  >
                                    <text
                                      x={x}
                                      y={y}
                                      textAnchor={textAnchor}
                                      fill={payload.value === weakestSubject ? "#1e56cd" : "#374151"}
                                      fontSize={11}
                                      fontWeight={payload.value === weakestSubject ? 700 : 500}
                                    >
                                      {payload.value}
                                    </text>
                                  </g>
                                );
                              }}
                            />
                            <PolarRadiusAxis domain={[0, 100]} axisLine={false} tick={false} />
                            <Radar
                              name="정답률"
                              dataKey="A"
                              stroke="#1e56cd"
                              fill="#1e56cd"
                              fillOpacity={0.2}
                              strokeWidth={2}
                            />
                          </RadarChart>
                        {hoveredTypeLabel && (
                          <div className="absolute left-1/2 -translate-x-1/2 bottom-0 z-10 w-[280px] rounded-lg bg-slate-800 text-white text-xs shadow-xl py-2.5 px-3 border border-slate-600">
                            <p className="font-bold text-[#99ccff] mb-1">{hoveredTypeLabel}</p>
                            <p className="text-slate-300 leading-relaxed">{getProblemTypeDescription(certInfo, hoveredTypeLabel)}</p>
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          if (!isPremiumCert) {
                            setShowWeaknessPaymentModal(true);
                            return;
                          }
                          if (onStartWeakTypeFocus) onStartWeakTypeFocus(activeCertId);
                          else handleNavigate(`/exam-list?cert=${activeCertId}`);
                        }}
                        className="w-full mt-auto bg-[#99ccff] border border-[#99ccff] rounded-xl py-3 px-4 flex justify-between items-center text-sm font-bold text-[#1e56cd] hover:bg-[#b3d9ff] hover:border-[#99ccff]"
                      >
                        <span className="flex items-center gap-2">
                          {!isPremiumCert && <Lock className="w-4 h-4 text-[#1e56cd] shrink-0" />}
                          취약 유형 집중 학습
                        </span>
                        <ChevronRight className="w-4 h-4 text-[#1e56cd]" />
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Card 3: 취약 개념 분석 */}
              <div ref={weaknessCardRef} className="bg-white border-2 border-[#99ccff] rounded-3xl p-6 flex flex-col shadow-md min-h-[280px] relative">
                <div className="flex justify-between items-start gap-2 mb-3">
                  <h3 className="text-[#1e56cd] text-base font-bold">취약 개념 분석</h3>
                </div>
                <div className="relative flex-1 flex flex-col min-h-0">
                  {!hasLearningHistory ? (
                    <div className="absolute inset-0 bg-white flex items-center justify-center z-20 rounded-2xl">
                      <p className="text-sm text-gray-600 px-4 whitespace-pre-line text-center font-medium">
                        {MY_PAGE_EMPTY_MESSAGES.weakness}
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="flex-grow relative min-h-0">
                        <div className="space-y-3 rounded-xl p-3">
                          {(displayWeaknessTop3.length ? displayWeaknessTop3 : mockDashboardStats.weaknessTop3).length > 0 ? (
                            (displayWeaknessTop3.length ? displayWeaknessTop3 : mockDashboardStats.weaknessTop3).map((w, idx) => {
                              // 개념 id: API의 w.id 우선, 없으면 "개념 79" / "개념79"에서 숫자 추출 (캐시된 구 데이터 대응)
                              const resolvedId =
                                w.id ?? (typeof w.name === "string" ? (w.name.match(/^개념\s*(\d+)$/) ?? null)?.[1] : null) ?? null;
                              const byId =
                                resolvedId != null
                                  ? certInfo?.core_concepts_by_id?.[resolvedId] ??
                                    (activeCert?.code === "BIGDATA" ? BIGDATA_CORE_CONCEPTS_BY_ID[resolvedId] : null)
                                  : null;
                              const displayName = byId?.concept ?? w.name;
                              // Firestore core_concept_keywords는 개념명이 키 → 표시용 개념명(displayName)으로 조회
                              const conceptTags = (byId?.keywords?.length
                                ? byId.keywords
                                : certInfo?.core_concept_keywords?.[displayName] ?? certInfo?.core_concept_keywords?.[w.name]) ?? [];
                              return (
                                <div key={idx} className="bg-[#cce5ff] p-4 rounded-xl">
                                  <div className="flex justify-between items-center gap-2">
                                    <div className="min-w-0 flex-1">
                                      <span className="text-sm font-bold text-gray-700 truncate cursor-default block">
                                        {displayName}
                                      </span>
                                    </div>
                                    <div
                                      className="relative shrink-0"
                                      onMouseEnter={() => setOpenKeywordPopoverIndex(idx)}
                                      onMouseLeave={() => setOpenKeywordPopoverIndex(null)}
                                    >
                                      <button
                                        type="button"
                                        aria-label="키워드 보기"
                                        onClick={() => setOpenKeywordPopoverIndex((prev) => (prev === idx ? null : idx))}
                                        className="p-0.5 rounded text-[#1e56cd] hover:bg-[#99ccff]/50 focus:outline-none focus:ring-2 focus:ring-[#1e56cd]/50"
                                      >
                                        <HelpCircle className="w-4 h-4" />
                                      </button>
                                      {openKeywordPopoverIndex === idx && (
                                        <div className="absolute right-0 top-full mt-1 z-30 w-[200px] max-h-[180px] overflow-y-auto rounded-lg bg-slate-800 text-white text-xs shadow-xl py-2 px-2">
                                          {conceptTags.length > 0 ? (
                                            <ul className="space-y-1">
                                              {conceptTags.map((tag, i) => (
                                                <li key={i} className="py-0.5 px-1 truncate" title={tag}>
                                                  {tag}
                                                </li>
                                              ))}
                                            </ul>
                                          ) : (
                                            <p className="text-slate-300 py-1">키워드 없음</p>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              );
                            })
                          ) : (
                            <p className="text-sm text-gray-500 py-4">
                              {hasLearningHistory
                                ? "아직 취약 개념이 분석되지 않았어요. 모의고사를 더 풀어보세요."
                                : "모의고사를 응시하면 AI가 취약점을 분석해드립니다."}
                            </p>
                          )}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          if (!isPremiumCert) {
                            setShowWeaknessPaymentModal(true);
                            return;
                          }
                          if (onStartWeakConceptFocus) onStartWeakConceptFocus(activeCertId);
                          else handleNavigate(`/exam-list?cert=${activeCertId}`);
                        }}
                        className="w-full mt-auto bg-[#99ccff] border border-[#99ccff] rounded-xl py-3 px-4 flex justify-between items-center text-sm font-bold text-[#1e56cd] hover:bg-[#b3d9ff] hover:border-[#99ccff]"
                      >
                        <span className="flex items-center gap-2">
                          {!isPremiumCert && <Lock className="w-4 h-4 text-[#1e56cd] shrink-0" />}
                          취약 개념 집중 학습
                        </span>
                        <ChevronRight className="w-4 h-4 text-[#1e56cd]" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* 하단 Row: 나의 학습 기록 (Full width) */}
            <div className="bg-white border-2 border-[#99ccff] rounded-3xl p-6 flex flex-col justify-between h-full shadow-md flex-1 min-h-0">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-[#1e56cd] text-lg font-bold">나의 학습 기록</h3>
              </div>
              <div className="relative flex-1 min-h-[320px] flex flex-col">
              <div className="flex-grow min-h-0 overflow-y-auto pr-2 space-y-0">
              {paginatedTrend.length === 0 ? (
                <p className="text-sm text-gray-600 py-8 text-center whitespace-pre-line font-medium">
                  {hasLearningHistory ? "기록이 없습니다." : MY_PAGE_EMPTY_MESSAGES.learningRecord}
                </p>
              ) : (
              paginatedTrend.map((item, i) => {
                const isPass = item.isPass ?? item.score >= 60;
                return (
                  <div
                    key={item.examId ?? i}
                    className="flex flex-col md:flex-row md:items-center justify-between py-3 md:py-2 border-b border-gray-50 gap-2"
                  >
                      <div className="flex items-center gap-4">
                        <span className="text-sm font-bold text-gray-700">
                          {(effectivePage - 1) * ITEMS_PER_PAGE + i + 1}
                        </span>
                        <span className="text-sm font-medium text-gray-600">
                          {item.roundLabel ?? getRoundLabel(item.roundId, activeCertId)}
                          {item.date && <span className="text-gray-400 text-xs font-normal ml-1.5">({item.date})</span>}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 justify-end flex-wrap">
                        <span
                          className={`text-xs font-bold px-2 py-0.5 rounded-full border ${
                            isPass ? "bg-[#99ccff] text-[#1e56cd] border-[#1e56cd]/40" : "bg-gray-100 text-gray-600 border-gray-200"
                          }`}
                        >
                          {isPass ? `✓ ${item.score}점` : "불합격"}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            item.roundId
                              ? handleNavigate(`/exam-list?cert=${activeCertId}&round=${item.roundId}`)
                              : alert("재응시할 회차 정보가 없습니다.")
                          }
                          className="bg-white border border-slate-200 text-slate-700 text-xs px-3 py-1.5 rounded-lg font-bold hover:bg-slate-50 hover:border-slate-300 shadow-sm"
                        >
                          재응시
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            item.examId
                              ? (onViewExamResult ? onViewExamResult(item.examId) : handleWrongAnswers(item.examId, item.roundId))
                              : undefined
                          }
                          disabled={wrongAnswersLoading}
                          className="bg-white border border-slate-200 text-slate-700 text-xs px-3 py-1.5 rounded-lg font-bold hover:bg-slate-50 hover:border-slate-300 shadow-sm disabled:opacity-50"
                        >
                          오답확인
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            {totalPages > 1 && (
              <div className="flex-shrink-0 mt-auto flex justify-center items-center gap-4 text-gray-400 text-xs font-bold border-t border-gray-100 pt-6">
                <button
                  type="button"
                  onClick={() => setLearningRecordsPage((p) => Math.max(1, p - 1))}
                  className="hover:text-gray-600"
                >
                  &lt;
                </button>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setLearningRecordsPage(p)}
                    className={p === effectivePage ? "text-[#1e56cd] underline" : "hover:text-gray-600"}
                  >
                    {p}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setLearningRecordsPage((p) => Math.min(totalPages, p + 1))}
                  className="hover:text-gray-600"
                >
                  &gt;
                </button>
              </div>
            )}
            {!hasLearningHistory && (
              <div className="absolute inset-0 bg-white flex items-center justify-center z-20 rounded-2xl">
                <p className="text-sm text-gray-600 px-4 whitespace-pre-line text-center font-medium">
                  {MY_PAGE_EMPTY_MESSAGES.learningRecord}
                </p>
              </div>
            )}
              </div>
            </div>
          </div>
        </div>
        {isExpired && <DataPreservationCard />}

        <AddCertModal
          isOpen={isAddCertOpen}
          onClose={() => setIsAddCertOpen(false)}
          subscriptions={user.subscriptions}
          onAdd={(id) => onStartNewCert(id)}
        />
        <PassModal isOpen={isPassModalOpen} onClose={() => setIsPassModalOpen(false)} />
        <FailCouponModal
          isOpen={isFailModalOpen}
          onClose={() => setIsFailModalOpen(false)}
          onCheckout={() => handleNavigate("/checkout")}
        />

        {showWeaknessPaymentModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-5">
            <div
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => setShowWeaknessPaymentModal(false)}
            />
            <div className="relative z-10 w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl text-center animate-scale-in">
              <div className="w-12 h-12 rounded-full bg-[#99ccff] flex items-center justify-center mx-auto mb-4">
                <Lock className="w-6 h-6 text-[#1e56cd]" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-2">결제가 필요합니다</h3>
              <p className="text-sm text-slate-500 mb-5">{weaknessPaymentModalMessage}</p>
              <button
                type="button"
                onClick={() => {
                  setShowWeaknessPaymentModal(false);
                  handleNavigate("/checkout");
                }}
                className="w-full py-3.5 rounded-xl bg-[#1e56cd] text-white font-bold text-sm hover:bg-[#1e56cd]/90"
              >
                결제하러 가기
              </button>
              <button
                type="button"
                onClick={() => setShowWeaknessPaymentModal(false)}
                className="mt-3 w-full py-2.5 text-sm font-bold text-slate-500 hover:bg-slate-50 rounded-xl"
              >
                취소
              </button>
            </div>
          </div>
        )}

        {/* 오답확인 모달: 해당 회차 오답 문항 목록 */}
        {wrongAnswersModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-5">
            <div
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => setWrongAnswersModal(null)}
            />
            <div className="relative z-10 w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl animate-scale-in">
              <div className="w-12 h-12 rounded-full bg-[#99ccff] flex items-center justify-center mx-auto mb-4">
                <FileX className="w-6 h-6 text-[#1e56cd]" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-1">{wrongAnswersModal.roundLabel} 오답 내역</h3>
              <p className="text-sm text-slate-500 mb-4">
                총 {wrongAnswersModal.totalQuestions}문항 중 오답 {wrongAnswersModal.wrongIndices.length}문항
              </p>
              {wrongAnswersModal.wrongIndices.length === 0 ? (
                <p className="text-sm text-slate-600 py-2">오답이 없습니다.</p>
              ) : (
                <div className="max-h-48 overflow-y-auto rounded-xl bg-slate-50 p-3 mb-4">
                  <p className="text-xs text-slate-500 mb-2">오답 문항 번호</p>
                  <p className="text-sm text-slate-800 font-medium">
                    {wrongAnswersModal.wrongIndices.join("번, ")}번
                  </p>
                </div>
              )}
              <button
                type="button"
                onClick={() => setWrongAnswersModal(null)}
                className="w-full py-3 rounded-xl bg-[#1e56cd] text-white font-bold text-sm hover:bg-[#1e56cd]/90"
              >
                닫기
              </button>
            </div>
          </div>
        )}
    </div>
  );
};
