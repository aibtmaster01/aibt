import React, { useState, useEffect } from 'react';
import { collection, doc, getDoc, getDocs, query, orderBy, limit } from 'firebase/firestore';
import { db } from '../firebase';
import { EXAM_ROUNDS, CERTIFICATIONS, CERT_IDS_WITH_QUESTIONS } from '../constants';
import { Lock, Play, FileText, CheckCircle, X, BookOpen, ClipboardCheck, Loader2, Sparkles } from 'lucide-react';
import { fetchUserTrendData } from '../services/statsService';
import { getQuestionsForRound } from '../services/examService';
import { eloToPercent } from '../services/gradingService';
import { User } from '../types';
import { getDaysLeft, getDaysLeftForDate } from '../utils/dateUtils';
import type { ExamRound } from '../types';
interface ExamListProps {
  certId: string;
  user: User | null;
  onSelectRound: (roundId: string, mode?: 'exam' | 'study') => void;
  onSelectAiRound: (roundId: string, questions: import('../types').Question[], mode?: 'exam' | 'study') => void;
  onBack: () => void;
  onNavigate: (path: string) => void;
  isPremiumUser: boolean;
  isExpired?: boolean;
  onLogout?: () => void;
  currentPath?: string;
  /** 결과 화면 CTA "다음 회차"에서 넘어온 경우: 이 ID는 방금 완료한 회차. 다음 회차를 5초 큐레이션 후 자동 시작 */
  startNextAfterRoundId?: string | null;
  onConsumedStartNext?: () => void;
  /** 마이페이지 "재응시" 등으로 진입 시 해당 회차 모드 선택 모달 자동 오픈 */
  initialRoundId?: string | null;
  /** 게스트가 2·3·4회차 잠금 확인 시 로그인 모달 열기 (미제공 시 onNavigate('/login')) */
  onRequestLogin?: () => void;
}

/** 1~5회 자격증 공통 명칭 (기초 점검 1~3 / 실전 언락 4~5) */
const ROUND_DISPLAY_BASE: Record<number, { title: string; description: string }> = {
  1: { title: '연습 모의고사', description: '기초 실력 점검 및 취약점 파악' },
  2: { title: '응용 모의고사', description: '실제 시험 난이도에 가까운 고정 문제' },
  3: { title: '실전 모의고사', description: '실전 형식의 고정 문제로 최종 점검' },
  4: { title: '맞춤형 모의고사 1회', description: 'AI 맞춤형 약점 공략 모의고사' },
  5: { title: '맞춤형 모의고사 2회', description: 'AI 맞춤형 약점 공략 모의고사' },
};

/** 4회 이상: 약점 공략 모의고사 N회 (목록 내 차시) */
function getCurationRoundTitle(_roundNumber: number, _mode: 'REAL_EXAM' | 'WEAKNESS_ATTACK' | null, curationOrder: number): string {
  return `약점 공략 모의고사 ${curationOrder}회`;
}

function getRoundDisplayDescription(round: ExamRound, roundNumber: number): string {
  if (roundNumber <= 3) return ROUND_DISPLAY_BASE[roundNumber]?.description ?? round.description;
  return 'AI 맞춤형으로 구성된 모의고사';
}

/**
 * 모의고사 제공 루틴 (자격증 공통)
 * - 1~3회차: 고정 문제. 4회차+: 맞춤형(다양-적응 알고리즘).
 */
export const ExamList: React.FC<ExamListProps> = ({
  certId,
  user,
  onSelectRound,
  onSelectAiRound,
  onBack,
  onNavigate,
  isPremiumUser,
  isExpired,
  onLogout,
  currentPath = '/exam-list',
  startNextAfterRoundId = null,
  onConsumedStartNext,
  initialRoundId = null,
  onRequestLogin,
}) => {
  const initialRoundIdOpenedRef = React.useRef<string | null>(null);
  const [showStaticModal, setShowStaticModal] = useState(false);
  /** 결과 화면에서 "다음 회차"로 진입 시: 5초 오버레이 종료 후 이 값이 있으면 proceedWithRound 호출 */
  const autoStartAfterOverlayRef = React.useRef<{
    roundId: string;
    mode: 'exam' | 'study';
  } | null>(null);
  /** 4회차+ 오버레이 시 미리 불러온 문제 (체감 속도 향상) */
  const staticPreFetchedQuestionsRef = React.useRef<import('../types').Question[] | null>(null);
  const [hasCertStats, setHasCertStats] = useState(false);
  const [completedRoundIds, setCompletedRoundIds] = useState<Set<string>>(new Set());
  const [showModeModal, setShowModeModal] = useState(false);
  const [pendingRoundId, setPendingRoundId] = useState<string | null>(null);
  /** 평균 정답률 0~100 (stats 표시 등) */
  const [avgCorrectRate, setAvgCorrectRate] = useState<number | null>(null);
  /** 모드 선택 후 준비 중 오버레이: 5초 카운트다운 → 준비 완료 문구 → 목록 복귀 */
  const [showPreparingOverlay, setShowPreparingOverlay] = useState(false);
  const [preparingCountdown, setPreparingCountdown] = useState(5);
  const [preparingPhase, setPreparingPhase] = useState<'countdown' | 'ready'>('countdown');
  const [showLockedModal, setShowLockedModal] = useState(false);
  const [lockedMessage, setLockedMessage] = useState('');
  const [lockedAction, setLockedAction] = useState<'none' | 'login'>('none');
  const [showFreePaymentModal, setShowFreePaymentModal] = useState(false);
  /** 예측 합격률 0~100 (4·5회 언락 조건용) */

  const cert = CERTIFICATIONS.find((c) => c.id === certId);
  const certCode = cert?.code ?? null;
  /** 기본 회차 + 약점 공략 6회차 이상은 최대 20회까지 동적 확장 */
  const MAX_CURATION_ROUND = 20;
  const baseRounds = EXAM_ROUNDS.filter((r) => r.certId === certId);
  const maxDefinedRound = baseRounds.length ? Math.max(...baseRounds.map((r) => r.round)) : 0;
  const allRounds: ExamRound[] =
    maxDefinedRound >= 6
      ? (() => {
          const template = baseRounds.find((r) => r.round >= 6);
          const extended = [...baseRounds];
          if (template) {
            for (let n = maxDefinedRound + 1; n <= MAX_CURATION_ROUND; n++) {
              extended.push({
                ...template,
                id: `r${n}${certId}`,
                round: n,
                title: template.title,
                description: template.description,
              });
            }
          }
          return extended;
        })()
      : baseRounds;
  const round3ForCert = allRounds.find((r) => r.round === 3);
  const completedRound3 = round3ForCert ? completedRoundIds.has(round3ForCert.id) : false;
  /** 1~3회차: 항상 표시. 4회차+: 3회차 완료 후 순차 오픈 (모두 맞춤형, 고정 조건 없음) */
  let rounds = !completedRound3
    ? allRounds.filter((r) => r.round <= 3)
    : allRounds.filter((r) => {
        if (r.round <= 3) return true;
        if (r.round === 4) return completedRound3;
        const prev = allRounds.find((pr) => pr.round === r.round - 1);
        return prev ? completedRoundIds.has(prev.id) : false;
      });
  /** 무료 유저도 3회차·4회차 이상 목록에 노출 (잠금으로 결제 유도); 1·2회차만 풀이 가능 */
  const showTeaser4 = !completedRound3;
  const nextRoundToPlay = allRounds.find((r) => !completedRoundIds.has(r.id));
  /** 목록에 보이는 회차 중 '다음으로 풀 맞춤형' = 아직 생성 전 신비 박스 스타일 적용 대상 */
  const nextVisibleCurationRound = rounds.find((r) => r.round >= 4 && !completedRoundIds.has(r.id));

  useEffect(() => {
    if (!user || !certCode || !isPremiumUser) {
      setHasCertStats(false);
      setAvgCorrectRate(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const ref = doc(db, 'users', user.id, 'stats', certCode);
      const snap = await getDoc(ref);
      if (!cancelled) {
        const data = snap.exists() ? snap.data() : {};
        const conceptStats = (data as { core_concept_stats?: Record<string, { proficiency?: number }>; hierarchy_stats?: Record<string, { proficiency?: number }> }).core_concept_stats ?? (data as { hierarchy_stats?: Record<string, { proficiency?: number }> }).hierarchy_stats ?? {};
        const keys = Object.keys(conceptStats);
        setHasCertStats(keys.length > 0);
        const percents = keys
          .map((k) => conceptStats[k]?.proficiency)
          .filter((p): p is number => typeof p === 'number' && p > 0)
          .map((p) => eloToPercent(p));
        const avg = percents.length > 0 ? percents.reduce((a, b) => a + b, 0) / percents.length : null;
        setAvgCorrectRate(avg);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id, certCode, isPremiumUser]);

  useEffect(() => {
    if (!user) {
      setCompletedRoundIds(new Set());
      return;
    }
    let cancelled = false;
    (async () => {
      const examRef = collection(db, 'users', user.id, 'exam_results');
      const q = query(examRef, orderBy('submittedAt', 'desc'), limit(150));
      const snap = await getDocs(q);
      if (cancelled) return;
      const ids = new Set<string>();
      snap.docs.forEach((d) => {
        const data = d.data();
        if (data?.certId === certId && data?.roundId) ids.add(data.roundId as string);
      });
      setCompletedRoundIds(ids);
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id, certId]);

  /** 마이페이지 "재응시"로 진입 시(initialRoundId 있음) 해당 회차 모드 선택 모달 자동 오픈 (게스트는 목록만 보여주고 자동 오픈 안 함) */
  useEffect(() => {
    if (!user || !initialRoundId || initialRoundIdOpenedRef.current === initialRoundId) return;
    const roundExists = rounds.some((r) => r.id === initialRoundId);
    if (!roundExists) return;
    initialRoundIdOpenedRef.current = initialRoundId;
    setPendingRoundId(initialRoundId);
    setShowModeModal(true);
  }, [user, initialRoundId, rounds]);

  const consumedStartNextRef = React.useRef<string | null>(null);
  /** 결과 화면 CTA "다음 회차"에서 넘어온 경우: 다음 회차 자동 시작 (정적 회차는 바로, 맞춤형은 5초 큐레이션 후) */
  useEffect(() => {
    if (!startNextAfterRoundId || !onConsumedStartNext || !CERT_IDS_WITH_QUESTIONS.includes(certId)) return;
    if (consumedStartNextRef.current === startNextAfterRoundId) return;
    consumedStartNextRef.current = startNextAfterRoundId;
    const current = allRounds.find((r) => r.id === startNextAfterRoundId);
    if (!current) {
      consumedStartNextRef.current = null;
      onConsumedStartNext();
      return;
    }
    const nextRound = allRounds.find((r) => r.round === current.round + 1);
    if (!nextRound) {
      consumedStartNextRef.current = null;
      onConsumedStartNext();
      return;
    }
    const considerCompleted = new Set(completedRoundIds);
    considerCompleted.add(startNextAfterRoundId);
    const prevRound = allRounds.find((r) => r.round === nextRound.round - 1);
    const prevCompleted = prevRound && considerCompleted.has(prevRound.id);
    if (prevRound && !prevCompleted) {
      consumedStartNextRef.current = null;
      setLockedMessage(`모의고사 ${nextRound.round - 1}회를 먼저 풀어주세요.`);
      setLockedAction('none');
      setShowLockedModal(true);
      onConsumedStartNext();
      return;
    }
    if (!user && nextRound.round >= 2) {
      consumedStartNextRef.current = null;
      setLockedMessage('로그인이 필요한 서비스입니다.');
      setLockedAction('login');
      setShowLockedModal(true);
      onConsumedStartNext();
      return;
    }
    if (user && !isPremiumUser && nextRound.round >= 3) {
      consumedStartNextRef.current = null;
      setShowFreePaymentModal(true);
      onConsumedStartNext();
      return;
    }
    if (nextRound.round >= 4) {
      autoStartAfterOverlayRef.current = {
        roundId: nextRound.id,
        mode: 'exam',
      };
      setShowPreparingOverlay(true);
      setPreparingCountdown(5);
      setPreparingPhase('countdown');
      if (user && certId) {
        staticPreFetchedQuestionsRef.current = null;
        getQuestionsForRound(certId, nextRound.round, user)
          .then((qs) => { staticPreFetchedQuestionsRef.current = qs; })
          .catch(() => { staticPreFetchedQuestionsRef.current = []; });
      }
    } else {
      onSelectRound(nextRound.id, 'exam');
      onConsumedStartNext();
    }
  }, [startNextAfterRoundId, onConsumedStartNext, certId, allRounds, completedRoundIds, user, isPremiumUser, onSelectRound]);

  /** 맞춤형 모의고사 준비: 5초 카운트다운 → 준비 완료 문구 → 목록 복귀 (또는 결과 화면에서 온 자동 다음 회차 시 proceedWithRound 호출) */
  useEffect(() => {
    if (!showPreparingOverlay) return;
    if (preparingPhase === 'countdown') {
      if (preparingCountdown <= 0) {
        setPreparingPhase('ready');
        return;
      }
      const t = setInterval(() => setPreparingCountdown((c) => (c <= 0 ? 0 : c - 1)), 1000);
      return () => clearInterval(t);
    }
    if (preparingPhase === 'ready') {
      const t = setTimeout(() => {
        const pending = autoStartAfterOverlayRef.current;
        autoStartAfterOverlayRef.current = null;
        if (pending) {
          const qs = staticPreFetchedQuestionsRef.current;
          if (qs && qs.length > 0) {
            onSelectAiRound(pending.roundId, qs, pending.mode);
          } else {
            onSelectRound(pending.roundId, pending.mode);
          }
          staticPreFetchedQuestionsRef.current = null;
          onConsumedStartNext?.();
        }
        closePreparingOverlay();
      }, 1800);
      return () => clearTimeout(t);
    }
  }, [showPreparingOverlay, preparingPhase, preparingCountdown]);

  type LockReason = 'guest' | 'free' | 'premium_sequential' | null;
  function getLockState(round: ExamRound): { locked: boolean; reason: LockReason } {
    if (isExpired) return { locked: false, reason: null };
    const n = round.round;
    if (!user) {
      return { locked: n >= 2, reason: n >= 2 ? 'guest' : null };
    }
    // 1·2·3회차만 이전 회차 완료 제약 (4회차 이상은 목록 노출 자체가 조건부라 순차 잠금 없음)
    if (n >= 2 && n <= 3) {
      const prevRound = allRounds.find((r) => r.round === n - 1);
      const prevRoundId = prevRound?.id;
      if (prevRoundId && !completedRoundIds.has(prevRoundId)) {
        return { locked: true, reason: 'premium_sequential' };
      }
    }
    if (!isPremiumUser) {
      return { locked: n >= 3, reason: n >= 3 ? 'free' : null };
    }
    return { locked: false, reason: null };
  }

  const handleRoundClick = async (roundId: string, locked: boolean, reason: LockReason) => {
    if (isExpired) {
      setShowStaticModal(true);
      return;
    }
    if (locked && reason) {
      if (reason === 'guest') {
        setLockedMessage('로그인이 필요한 서비스입니다.');
        setLockedAction('login');
        setShowLockedModal(true);
        return;
      }
      if (reason === 'free') {
        setShowFreePaymentModal(true);
        return;
      }
      if (reason === 'premium_sequential') {
        const round = allRounds.find((r) => r.id === roundId);
        const prevRoundNum = round ? round.round - 1 : 1;
        setLockedMessage(`모의고사 ${prevRoundNum}회를 먼저 풀어주세요.`);
        setLockedAction('none');
        setShowLockedModal(true);
        return;
      }
      return;
    }

    if (!CERT_IDS_WITH_QUESTIONS.includes(certId)) {
      alert(`${cert?.name ?? '해당 과목'}은 현재 준비중입니다.`);
      return;
    }

    /** 모든 회차(1~∞): 학습/실전 모달 노출 후 분기 */
    setPendingRoundId(roundId);
    setShowModeModal(true);
  };

  const closePreparingOverlay = () => {
    setShowPreparingOverlay(false);
    setPreparingPhase('countdown');
    setPreparingCountdown(5);
    setPendingRoundId(null);
    staticPreFetchedQuestionsRef.current = null;
  };

  const handleModeSelect = (mode: 'exam' | 'study') => {
    if (!pendingRoundId) return;
    setShowModeModal(false);
    const roundId = pendingRoundId;
    setPendingRoundId(null);

    const round = allRounds.find((r) => r.id === roundId);
    const roundNum = round?.round ?? 0;

    /** 1·2·3회차: 바로 /quiz 이동 */
    if (roundNum <= 3) {
      onSelectRound(roundId, mode);
      return;
    }
    /** 4회차+: 5초 오버레이 + getQuestionsForRound( user_rounds 박제) 후 /quiz */
    if (roundNum >= 4 && user && certId) {
      staticPreFetchedQuestionsRef.current = null;
      autoStartAfterOverlayRef.current = { roundId, mode };
      setShowPreparingOverlay(true);
      setPreparingCountdown(5);
      setPreparingPhase('countdown');
      getQuestionsForRound(certId, roundNum, user)
        .then((qs) => { staticPreFetchedQuestionsRef.current = qs; })
        .catch(() => { staticPreFetchedQuestionsRef.current = []; });
    }
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-[#edf1f5]">
    <div className="max-w-6xl mx-auto px-5 py-10 relative">
      <div className="text-center mb-12">
        <span className={`px-3 py-1 rounded-full text-xs font-black uppercase mb-3 inline-block ${isExpired ? 'bg-slate-200 text-slate-500' : 'bg-[#99ccff] text-[#1e56cd]'}`}>
          {isExpired ? 'Expired Subscription' : 'Certification'}
        </span>
        <h1 className="text-3xl font-black text-slate-900 mb-2">{cert?.name}</h1>
        <p className="text-slate-500">원하는 모의고사 회차를 선택하세요.</p>
        {isExpired && (
          <div className="mt-4 bg-red-50 text-red-600 text-xs font-bold py-2 px-4 rounded-lg inline-block">
            기간 만료: 문제 풀이가 제한되며, 결과 리포트만 확인 가능합니다.
          </div>
        )}
      </div>

      <div className="space-y-4">
        {rounds.map((round, index) => {
          const { locked, reason } = getLockState(round);
          const roundNum = round.round;
          const isCurationSlot = roundNum >= 4;
          /** 목록에서 보이는 순서 번호 (1, 2, 3, 4, …) → [차시] 및 제목에 사용 */
          const displayOrder = index + 1;
          /** 약점 공략만 목록 내 순번(1회, 2회, …) — 6회차 이상 항상 약점 강화형 */
          const curationOrderInList = rounds.slice(0, index).filter((r) => r.round >= 4).length + 1;
          const baseTitle =
            roundNum <= 3
              ? (ROUND_DISPLAY_BASE[roundNum]?.title ?? `모의고사 ${roundNum}회`)
              : getCurationRoundTitle(roundNum, null, curationOrderInList);
          const displayTitle = baseTitle;
          const displayDesc = getRoundDisplayDescription(round, roundNum);
          const isCompleted = completedRoundIds.has(round.id);
          const isCurrent = nextRoundToPlay?.id === round.id;
          /** 목록에서 첫 맞춤형 슬롯 → 신비로운 그라데이션, 나머지 맞춤형 → 일반 카드 */
          const isMysteryBox = isCurationSlot && nextVisibleCurationRound?.id === round.id && !locked;
          const isNormalCurationBox = isCurationSlot && nextVisibleCurationRound?.id !== round.id;
          /** 무료 유저 4회차+: 신비로운/일반 큐레이션 스타일 유지 + 자물쇠 덮어씌워 결제 유도 */
          const isFreeLockedCuration = locked && reason === 'free' && isCurationSlot;

          return (
            <div
              key={round.id}
              onClick={() => handleRoundClick(round.id, locked, reason)}
              className={`
                group relative border rounded-2xl p-6 flex items-center justify-between transition-all select-none
                ${locked && !isFreeLockedCuration
                  ? 'bg-slate-50 border-slate-200 opacity-50 cursor-not-allowed'
                  : isFreeLockedCuration
                    ? isMysteryBox || (isCurationSlot && nextVisibleCurationRound?.id === round.id)
                      ? 'bg-gradient-to-br from-[#0034d3] via-[#1e56cd] to-[#003087] border-[#1e56cd]/50 hover:border-[#99ccff]/70 shadow-lg shadow-[#1e56cd]/20 hover:shadow-[#1e56cd]/30 cursor-pointer hover:-translate-y-0.5'
                      : 'bg-white border-slate-200 hover:border-[#1e56cd] hover:shadow-md cursor-pointer hover:-translate-y-0.5'
                    : isMysteryBox
                    ? 'bg-gradient-to-br from-[#0034d3] via-[#1e56cd] to-[#003087] border-[#1e56cd]/50 hover:border-[#99ccff]/70 shadow-lg shadow-[#1e56cd]/20 hover:shadow-[#1e56cd]/30 cursor-pointer hover:-translate-y-0.5'
                    : isNormalCurationBox
                      ? 'bg-white border-slate-200 hover:border-[#1e56cd] hover:shadow-md cursor-pointer hover:-translate-y-0.5'
                      : isCurrent
                        ? 'bg-[#1e56cd]/10 border-[#1e56cd]/50 hover:border-[#1e56cd] hover:shadow-md cursor-pointer hover:-translate-y-0.5'
                        : 'bg-white border-slate-200 hover:border-[#1e56cd] hover:shadow-md cursor-pointer hover:-translate-y-0.5'
                }
              `}
            >
              <div className="flex items-center gap-5">
                <div
                  className={`
                  w-14 h-14 rounded-2xl flex items-center justify-center text-xl font-black shrink-0
                  ${isExpired
                    ? 'bg-slate-200 text-slate-400'
                    : locked && !isFreeLockedCuration
                      ? 'bg-slate-200 text-slate-400'
                      : isFreeLockedCuration && nextVisibleCurationRound?.id === round.id
                        ? 'bg-white/15 text-white shadow-inner border border-white/10'
                        : isFreeLockedCuration
                          ? 'bg-[#1e56cd] text-white shadow-md shadow-[#1e56cd]/30'
                          : isMysteryBox
                        ? 'bg-white/15 text-white shadow-inner border border-white/10'
                        : isCurrent && !isNormalCurationBox
                          ? 'bg-[#1e56cd] text-white shadow-md shadow-[#1e56cd]/30'
                          : isCompleted
                            ? 'bg-emerald-100 text-emerald-700'
                            : isCurationSlot
                              ? 'bg-[#1e56cd] text-white shadow-md shadow-[#1e56cd]/30'
                              : 'bg-slate-100 text-slate-600 group-hover:bg-[#99ccff]/50 group-hover:text-[#1e56cd]'
                  }
                `}
                >
                  {displayOrder}
                </div>
                <div className="min-w-0 flex-1">
                  <h3
                    className={`font-bold text-lg flex items-center gap-2 flex-wrap ${
                      isMysteryBox || (isFreeLockedCuration && nextVisibleCurationRound?.id === round.id)
                        ? 'text-white'
                        : isNormalCurationBox || isFreeLockedCuration
                          ? 'text-slate-900'
                          : 'text-slate-900'
                    }`}
                  >
                    {displayTitle}
                  </h3>
                  <p
                    className={`text-xs mt-1 font-medium ${
                      isMysteryBox || (isFreeLockedCuration && nextVisibleCurationRound?.id === round.id)
                        ? 'text-white/70'
                        : isNormalCurationBox || isFreeLockedCuration
                          ? 'text-slate-400'
                          : 'text-slate-400'
                    }`}
                  >
                    {displayDesc}
                  </p>
                </div>
              </div>

              <div className="text-right shrink-0">
                {isExpired ? (
                  <FileText className="text-slate-300" />
                ) : locked ? (
                  isFreeLockedCuration ? (
<div
                    className={`w-10 h-10 rounded-full flex items-center justify-center ${
                        nextVisibleCurationRound?.id === round.id
                          ? 'bg-white/15 text-white border border-white/20'
                          : 'bg-[#99ccff] text-[#1e56cd]'
                      }`}
                  >
                    <Lock className="w-5 h-5" />
                  </div>
                  ) : (
                    <Lock className="text-slate-400 w-6 h-6" />
                  )
                ) : (
                  <button
                    type="button"
                    className={`w-10 h-10 rounded-full flex items-center justify-center shadow-sm border transition-colors ${
                      isMysteryBox
                        ? 'bg-white/15 text-white border-white/20 group-hover:bg-white/25 group-hover:border-white/40'
                        : 'bg-white text-slate-300 border-slate-100 group-hover:bg-[#1e56cd] group-hover:text-white group-hover:border-transparent'
                    }`}
                  >
                    <Play size={18} className="ml-0.5" fill="currentColor" />
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {/* 3회 미완료 시 다음 회차 암시용 딤 카드 (클릭 불가) */}
        {showTeaser4 && (
          <div
            className="rounded-2xl p-6 flex items-center justify-between border border-slate-400/50 bg-slate-700/90 opacity-60 cursor-not-allowed select-none"
            aria-hidden
          >
            <div className="flex items-center gap-5">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-xl font-black shrink-0 bg-slate-600 text-white/90">
                ?
              </div>
              <div>
                <h3 className="font-bold text-lg text-white/90">다음 회차</h3>
                <p className="text-xs mt-1 font-medium text-white/60">3회 완료 후 이용 가능 (AI 맞춤형 모의고사)</p>
              </div>
            </div>
            <Lock className="text-white/50 w-6 h-6 shrink-0" />
          </div>
        )}
      </div>

      {/* 4회차 이상 준비: 5초 오버레이 후 /quiz (getQuestionsForRound → user_rounds 박제) */}
      {showPreparingOverlay && (() => {
        const qs = staticPreFetchedQuestionsRef.current;
        const includedConcepts = qs && Array.isArray(qs)
          ? [...new Set(qs.map((q) => q.core_concept).filter((c): c is string => Boolean(c)))]
          : [];
        const displayName = user?.givenName ?? user?.name ?? user?.email?.split('@')[0] ?? '회원';
        const top2Concepts = includedConcepts.slice(0, 2);
        const subMessage = top2Concepts.length > 0
            ? `${displayName}님의 취약개념 ${top2Concepts.join(', ')} 개념을 포함해 맞춤 문항을 제작하고 있어요.`
            : '당신의 취약 유형·취약 개념을 반영해 맞춤 문항을 제작하고 있어요.';
        return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/85 backdrop-blur-md p-4">
          <div className="w-full max-w-lg rounded-3xl bg-gradient-to-b from-slate-800 to-slate-900 border border-slate-600/50 shadow-2xl shadow-black/40 overflow-hidden">
            <div className="px-8 py-10 text-center">
              {preparingPhase === 'countdown' ? (
                <>
                  <div className="flex justify-center mb-6">
                    <div className="w-16 h-16 rounded-2xl bg-[#1e56cd]/20 border border-[#99ccff]/30 flex items-center justify-center">
                      <Loader2 className="w-8 h-8 text-[#99ccff] animate-spin" strokeWidth={2.5} />
                    </div>
                  </div>
                  <h3 className="text-[#e2e8f0] font-bold text-lg tracking-tight mb-3">
                    모의고사 큐레이션 중
                  </h3>
                  <p className="text-slate-300 text-sm leading-relaxed mb-1">
                    학습데이터를 기반으로 모의고사를 큐레이션하는 중입니다.
                  </p>
                  <p className="text-[#99ccff] text-sm leading-relaxed font-medium mb-6">
                    {subMessage}
                  </p>
                  <p className="text-slate-500 text-xs font-medium">잠시만 기다려 주세요</p>
                </>
              ) : (
                <>
                  <div className="flex justify-center mb-5">
                    <div className="w-16 h-16 rounded-2xl bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center">
                      <Sparkles className="w-8 h-8 text-emerald-300" strokeWidth={2} />
                    </div>
                  </div>
                  <h3 className="text-white font-bold text-xl mb-1">
                    맞춤형 모의고사가 준비되었습니다
                  </h3>
                  {top2Concepts.length > 0 && (
                    <p className="text-slate-300 text-sm mb-3">
                      {displayName}님의 취약개념 {top2Concepts.join(', ')} 개념을 포함했어요
                    </p>
                  )}
                  <p className="text-slate-400 text-sm font-medium">
                    곧 퀴즈 화면으로 이동합니다
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
        );
      })()}

      {/* 모드 선택: 실전 시험 모드 / AI 학습 모드 (영역 외 클릭 시 닫기) */}
      {showModeModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-5"
          onClick={() => { setShowModeModal(false); setPendingRoundId(null); }}
          role="presentation"
          aria-modal="true"
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm pointer-events-none" aria-hidden />
          <div
            className="relative z-10 w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl animate-scale-in"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-black text-slate-900 mb-2">모의고사 모드 선택</h3>
            <p className="text-sm text-slate-500 mb-5">풀이 방식을 선택해 주세요.</p>
            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={() => handleModeSelect('study')}
                className="flex items-center gap-3 w-full rounded-xl border-2 border-slate-200 p-4 text-left hover:border-[#1e56cd] hover:bg-[#99ccff]/20 transition-colors"
              >
                <div className="w-10 h-10 rounded-lg bg-[#99ccff] flex items-center justify-center shrink-0">
                  <BookOpen className="w-5 h-5 text-[#1e56cd]" />
                </div>
                <div>
                  <span className="font-bold text-slate-900 block">AI 학습 모드</span>
                  <span className="text-xs text-slate-500">해설 보며 학습하기</span>
                </div>
              </button>
              <button
                type="button"
                onClick={() => handleModeSelect('exam')}
                className="flex items-center gap-3 w-full rounded-xl border-2 border-slate-200 p-4 text-left hover:border-[#1e56cd] hover:bg-[#99ccff]/20 transition-colors"
              >
                <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                  <ClipboardCheck className="w-5 h-5 text-slate-600" />
                </div>
                <div>
                  <span className="font-bold text-slate-900 block">실전 시험 모드</span>
                  <span className="text-xs text-slate-500">제한 시간 내 실전처럼 풀기</span>
                </div>
              </button>
            </div>
            <button
              type="button"
              onClick={() => { setShowModeModal(false); setPendingRoundId(null); }}
              className="mt-4 w-full py-2.5 text-sm font-bold text-slate-500 hover:bg-slate-50 rounded-xl"
            >
              취소
            </button>
          </div>
        </div>
      )}

      {/* 잠금 안내: 순차 진행 */}
      {showLockedModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-5">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowLockedModal(false)} />
          <div className="relative z-10 w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl text-center animate-scale-in">
            <div className="w-12 h-12 rounded-full bg-[#99ccff] flex items-center justify-center mx-auto mb-4">
              <Lock className="w-6 h-6 text-[#1e56cd]" />
            </div>
            <p className="text-slate-700 font-medium leading-relaxed">{lockedMessage}</p>
            <button
              type="button"
              onClick={() => {
                setShowLockedModal(false);
                if (lockedAction === 'login') {
                  if (onRequestLogin) onRequestLogin();
                  else onNavigate('/login');
                }
              }}
              className="mt-5 w-full py-3 rounded-xl bg-[#1e56cd] text-white font-bold text-sm hover:bg-[#1644a8]"
            >
              확인
            </button>
          </div>
        </div>
      )}

      {/* 무료회원 3회차: 결제 안내 후 결제 화면 */}
      {showFreePaymentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-5">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowFreePaymentModal(false)} />
          <div className="relative z-10 w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl text-center animate-scale-in">
            <div className="w-12 h-12 rounded-full bg-[#99ccff] flex items-center justify-center mx-auto mb-4">
              <Lock className="w-6 h-6 text-[#1e56cd]" />
            </div>
            <h3 className="text-lg font-black text-slate-900 mb-2">결제가 필요합니다</h3>
            <p className="text-sm text-slate-500 mb-5">
              2회차까지 무료로 이용 가능합니다.
              <br />
              결제 후 전체 및 맞춤형 모의고사를 이용하실 수 있습니다.
            </p>
            <button
              type="button"
              onClick={() => {
                setShowFreePaymentModal(false);
                onNavigate('/checkout');
              }}
              className="w-full py-3.5 rounded-xl bg-[#1e56cd] text-white font-bold text-sm hover:bg-[#1644a8]"
            >
              결제하러 가기
            </button>
            <button
              type="button"
              onClick={() => setShowFreePaymentModal(false)}
              className="mt-3 w-full py-2.5 text-sm font-bold text-slate-500 hover:bg-slate-50 rounded-xl"
            >
              취소
            </button>
          </div>
        </div>
      )}

      {/* [목데이터] 만료 회원용 진단평가 결과 미리보기 – 실제 데이터 연동 시 교체 */}
      {showStaticModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-5">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowStaticModal(false)} />
          <div className="bg-white w-full max-w-2xl rounded-[2rem] p-0 relative z-10 animate-slide-up shadow-2xl overflow-hidden max-h-[80vh] flex flex-col">
            <div className="bg-slate-50 px-8 py-6 border-b border-slate-200 flex justify-between items-center">
              <div>
                <div className="flex items-center gap-2 text-red-500 font-bold text-sm mb-1">
                  <Lock size={14} /> View Only Mode
                </div>
                <h2 className="text-xl font-black text-slate-900">제 1회차 진단평가 결과</h2>
              </div>
              <button onClick={() => setShowStaticModal(false)} className="text-slate-400 hover:text-slate-800">
                <X size={24} />
              </button>
            </div>
            <div className="overflow-y-auto p-8 space-y-6">
              <div className="bg-slate-50 p-6 rounded-2xl text-center border border-slate-200">
                <p className="text-slate-500 text-sm mb-2">지난 시험 점수</p>
                <div className="text-4xl font-black text-slate-800">65점 <span className="text-base text-slate-400 font-normal">/ 100</span></div>
              </div>
              <div className="space-y-4">
                <h3 className="font-bold text-slate-900 border-l-4 border-slate-300 pl-3">문항 분석</h3>
                <div className="border border-slate-200 rounded-xl p-5 opacity-70">
                  <div className="flex gap-3 mb-3">
                    <span className="bg-red-100 text-red-600 font-bold px-2 py-0.5 rounded text-xs h-fit">오답</span>
                    <p className="font-bold text-slate-900 text-sm">다음 중 반정형 데이터에 해당하지 않는 것은?</p>
                  </div>
                  <div className="pl-2 space-y-2">
                    <div className="flex items-center gap-2 text-sm text-slate-500"><div className="w-4 h-4 rounded-full border border-slate-300" /> 1. HTML</div>
                    <div className="flex items-center gap-2 text-sm text-slate-500"><div className="w-4 h-4 rounded-full border border-slate-300" /> 2. XML</div>
                    <div className="flex items-center gap-2 text-sm font-bold text-red-500"><div className="w-4 h-4 rounded-full border-4 border-red-500 bg-white" /> 3. JSON (내가 쓴 답)</div>
                    <div className="flex items-center gap-2 text-sm font-bold text-green-600"><CheckCircle size={16} /> 4. RDBMS Table (정답)</div>
                  </div>
                  <div className="mt-4 bg-slate-50 p-3 rounded-lg text-xs text-slate-600">
                    <span className="font-bold block mb-1">해설:</span> RDBMS Table은 스키마가 고정된 정형 데이터입니다.
                  </div>
                </div>
                <div className="border border-slate-200 rounded-xl p-5 opacity-70">
                  <div className="flex gap-3 mb-3">
                    <span className="bg-green-100 text-green-600 font-bold px-2 py-0.5 rounded text-xs h-fit">정답</span>
                    <p className="font-bold text-slate-900 text-sm">딥러닝 모델의 과적합 방지 기법은?</p>
                  </div>
                  <div className="pl-2 space-y-2">
                    <div className="flex items-center gap-2 text-sm text-slate-500"><div className="w-4 h-4 rounded-full border border-slate-300" /> 1. Dropout</div>
                    <div className="flex items-center gap-2 text-sm font-bold text-green-600"><CheckCircle size={16} /> 2. Data Augmentation (정답)</div>
                  </div>
                </div>
              </div>
            </div>
            <div className="bg-slate-50 p-4 border-t border-slate-200 text-center">
              <p className="text-xs text-slate-400 mb-2">문제를 다시 풀고 싶으신가요?</p>
              <button className="bg-[#1e56cd] text-white font-bold py-3 px-8 rounded-xl shadow-lg hover:bg-[#1644a8] transition-colors w-full md:w-auto">
                재수강 신청하고 잠금 해제 (50% OFF)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </div>
  );
};
