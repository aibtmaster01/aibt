import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Question, User } from '../types';
import { getExamService } from '../services/examServiceLoader';
import { EXAM_ROUNDS, CERTIFICATIONS, QUIZ_THEME, SUBJECT_NAMES_BY_CERT, WRONG_FEEDBACK_PLACEHOLDER, getRoundNumberFromRoundId, getRoundLabel } from '../constants';
import { getCertificationInfo } from '../services/gradingService';
import type { CertificationInfo } from '../types';
import { saveGuestQuizProgress, loadGuestQuizProgress } from '../utils/guestQuizStorage';
import { CheckCircle, XCircle, AlertTriangle, StickyNote, ChevronLeft, ChevronRight, Crown, Lightbulb, AlertCircle, Search, RotateCcw, X, Pin, Menu, LogOut, Flag, PanelLeft } from 'lucide-react';
import { useBetaCertifications } from '../config/brand';
import { COPYRIGHT_COPY } from '../constants/copyrightCopy';
import { ContentProtectionWrapper, QuizCopyrightFooter } from '../components/copyright';
import { submitProblemReport, type ProblemReportType } from '../services/adminQuestionService';
import { RichText } from '../components/RichText';
import { to1BasedAnswer } from '../utils/questionUtils';
import { ErrorView } from '../components/ErrorView';
import { getErrorCode } from '../utils/errorCodes';
import { isPremiumUnlocked } from '../utils/dateUtils';
import { MobilePageHeader, MobileBottomActionBar, MobileSheet, MobileFullScreenModal, FlashToast } from '../components/mobile';
import {
  hasConsecutiveRapidAnswers,
  RAPID_PROMPT_COOLDOWN_AFTER_DISMISS_ANSWERS,
  RAPID_PROMPT_MAX_PER_QUIZ_SESSION,
} from '../constants/rapidSolveDetection';

/** 비회원 Round 1: 20문제에서 멈추고 로그인 유도 */
const GUEST_QUESTION_LIMIT = 20;

/** 메모 입력 최대 글자 수 (회차당, 문제번호 포함) */
const MEMO_MAX_LENGTH = 500;

function mapHistoryForGuestStorage(history: QuizAnswerRecord[]) {
  return history.map((a) => ({
    qid: a.qid,
    selected: a.selected,
    isCorrect: a.isCorrect,
    isConfused: a.isConfused ?? false,
  }));
}

export interface QuizAnswerRecord {
  qid: string;
  selected: number;
  isCorrect: boolean;
  /** 모르겠어요 선택(selected===0) 시 true. 채점 시 가중치 반영 */
  isDontKnow?: boolean;
  /** (레거시) 학습 모드에서 헷갈려요 체크 시 사용. 채점 시 isConfused는 시간 기준으로 서버 판정 */
  isConfused?: boolean;
  /** 해당 문항 풀이에 걸린 시간(초). 스탯 업데이트 시 estimated_time 기준 찍기/헷갈림 판정 */
  elapsedSec?: number;
}

/** 회차별 메모 (핀으로 찍은 문제 + 자유 메모) - 오답 화면에서도 노출 */
export interface RoundMemo {
  freeText: string;
  pins: { qNumber: number; text: string }[];
}

/** 퀴즈 완료 시 통계·Elo 등 학습 반영 여부 — gradingService가 해석 */
export interface QuizFinishMeta {
  excludeFromLearningStats: boolean;
}

interface QuizProps {
  roundId: string;
  certId: string;
  user: User | null;
  mode?: 'exam' | 'study';
  preFetchedQuestions?: Question[] | null;
  startIndex?: number;
  onFinish: (
    score: number,
    total: number,
    sessionHistory?: QuizAnswerRecord[],
    questions?: Question[],
    roundMemo?: RoundMemo,
    finishMeta?: QuizFinishMeta,
  ) => void;
  onExit: () => void;
  onWeaknessRetrySave?: (
    score: number,
    total: number,
    sessionHistory: QuizAnswerRecord[],
    questions: Question[],
    finishMeta?: QuizFinishMeta,
  ) => void;
  onGuestLimitReached?: (params: { certId: string; roundId: string; sessionHistory: QuizAnswerRecord[]; questions: Question[] }) => void;
  onRequestCheckout?: () => void;
  onUpdateUser?: (updater: (prev: User) => User) => void;
  /** 모바일: 전역 네비게이션 드로어(앱 셀) 열기 */
  onOpenAppMenu?: () => void;
  /** 게스트 20번 후 가입·인증하고 이어할 때 1~20번 답안 (점수/과목 반영용) */
  initialSessionHistory?: QuizAnswerRecord[];
}

export const Quiz: React.FC<QuizProps> = ({
  roundId,
  certId,
  user,
  mode = 'study',
  preFetchedQuestions,
  startIndex,
  onFinish,
  onExit,
  onWeaknessRetrySave,
  onGuestLimitReached,
  onRequestCheckout,
  onUpdateUser,
  initialSessionHistory,
  onOpenAppMenu,
}) => {
  const [questions, setQuestions] = useState<Question[]>(preFetchedQuestions ?? []);
  const [loading, setLoading] = useState(!(preFetchedQuestions && preFetchedQuestions.length > 0));
  const [error, setError] = useState<string | null>(null);
  const [errorRaw, setErrorRaw] = useState<unknown>(null);
  const [currentQIndex, setCurrentQIndex] = useState(() => (startIndex != null && startIndex > 0 ? startIndex : 0));
  const explanationBoxRef = useRef<HTMLDivElement>(null);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isConfused, setIsConfused] = useState(false);
  const [sessionHistory, setSessionHistory] = useState<QuizAnswerRecord[]>([]);
  const [memoOpen, setMemoOpen] = useState(false);
  const [lnbOpen, setLnbOpen] = useState(false);
  const [roundMemos, setRoundMemos] = useState<Record<string, RoundMemo>>({});
  const [showExitConfirmModal, setShowExitConfirmModal] = useState(false);
  const [showWeaknessRetryEndModal, setShowWeaknessRetryEndModal] = useState(false);
  /** 사용자가 "기능 둘러보기"로 응답해 학습 통계 반영 제외 모드 */
  const [learningReflectionDisabled, setLearningReflectionDisabled] = useState(false);
  const [showRapidSolveModal, setShowRapidSolveModal] = useState(false);
  const [rapidSolveModalStep, setRapidSolveModalStep] = useState<'ask' | 'acknowledge'>('ask');
  const [rapidPendingHistory, setRapidPendingHistory] = useState<QuizAnswerRecord[] | null>(null);
  const rapidNextEligibleAtLengthRef = useRef(0);
  const rapidPromptsShownRef = useRef(0);
  const [showImageEnlarged, setShowImageEnlarged] = useState(false);
  const [enlargedImageSrc, setEnlargedImageSrc] = useState<string | null>(null);
  const [imageLoadError, setImageLoadError] = useState(false);
  const questionBodyRef = useRef<HTMLDivElement>(null);
  const questionStartTimeRef = useRef<number>(Date.now());
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [reportType, setReportType] = useState<ProblemReportType | null>(null);
  const [reportSending, setReportSending] = useState(false);
  const [reportToast, setReportToast] = useState<{ message: string; variant: 'success' | 'error' | 'neutral' } | null>(null);
  const [copyrightFlash, setCopyrightFlash] = useState<string | null>(null);
  const certCode = CERTIFICATIONS.find((c) => c.id === certId)?.code ?? '';

  const dismissReportToast = useCallback(() => setReportToast(null), []);
  const dismissCopyrightFlash = useCallback(() => setCopyrightFlash(null), []);

  const closeReportModal = useCallback(() => {
    if (reportSending) return;
    setReportModalOpen(false);
    setReportType(null);
  }, [reportSending]);

  const handleReportSubmit = useCallback(async () => {
    if (reportType === null || !certCode) return;
    const q = questions[currentQIndex];
    if (!q) return;
    if (!user) {
      setReportToast({ message: '신고는 로그인 후 이용할 수 있습니다.', variant: 'error' });
      return;
    }
    setReportSending(true);
    try {
      await submitProblemReport(certCode, q.id, reportType, user.id);
      setReportModalOpen(false);
      setReportType(null);
      setReportToast({ message: '신고가 접수되었습니다.', variant: 'success' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const isPermission = /permission|권한|insufficient/i.test(msg);
      setReportToast({
        message: isPermission
          ? '신고 저장에 실패했습니다. 로그인과 권한 설정을 확인해 주세요.'
          : msg.length > 100
            ? '신고 전송에 실패했습니다. 잠시 후 다시 시도해 주세요.'
            : msg,
        variant: 'error',
      });
    } finally {
      setReportSending(false);
    }
  }, [reportType, certCode, user, questions, currentQIndex]);

  const roundInfo = EXAM_ROUNDS.find((r) => r.id === roundId);
  const round = roundInfo?.round ?? getRoundNumberFromRoundId(roundId) ?? 1;
  const isWeaknessRound = round >= 6;
  const weaknessRetryMode = roundId === '__weakness_retry__' || roundId === '__subject_retry__';
  const isPremium = !!(user && certId && isPremiumUnlocked(user, certId));

  useEffect(() => {
    rapidNextEligibleAtLengthRef.current = 0;
    rapidPromptsShownRef.current = 0;
    setLearningReflectionDisabled(false);
    setShowRapidSolveModal(false);
    setRapidSolveModalStep('ask');
    setRapidPendingHistory(null);
  }, [roundId, certId]);

  const [certInfo, setCertInfo] = useState<CertificationInfo | null>(null);
  useEffect(() => {
    if (roundId !== '__weak_concept_focus__' || !certId) return;
    const code = CERTIFICATIONS.find((c) => c.id === certId)?.code;
    if (!code) return;
    getCertificationInfo(code).then(setCertInfo).catch(() => setCertInfo(null));
  }, [roundId, certId]);

  const quizPageTitle =
    roundId === '__subject_strength__'
      ? '과목 강화 학습'
      : roundId === '__weak_type_focus__'
        ? '취약 유형 집중 학습'
        : roundId === '__weak_concept_focus__'
          ? '취약 개념 집중 학습'
          : getRoundLabel(roundId, certId);

  useEffect(() => {
    setImageLoadError(false);
    questionStartTimeRef.current = Date.now();
  }, [currentQIndex]);

  // 지문/보기 HTML 내 이미지: Firestore(Storage) URL이 있으면 딤 없음, 없으면 딤 + "이미지 준비중"
  useEffect(() => {
    const el = questionBodyRef.current;
    if (!el) return;
    const imgs = el.querySelectorAll('img');
    imgs.forEach((img) => {
      if (img.closest('.quiz-image-dim-overlay-wrap') || img.closest('.quiz-image-explicit')) return;
      const src = (img.getAttribute('src') || img.src || '').trim();
      if (src && src.startsWith('http')) return;
      const wrap = document.createElement('div');
      wrap.className = 'relative inline-block max-w-full quiz-image-dim-overlay-wrap';
      img.parentNode?.insertBefore(wrap, img);
      wrap.appendChild(img);
      const overlay = document.createElement('div');
      overlay.className = 'absolute inset-0 bg-black/60 flex items-center justify-center z-10 pointer-events-none';
      overlay.innerHTML = '<span class="text-white font-bold text-sm px-4 py-2 rounded-lg bg-black/40">이미지 준비중</span>';
      wrap.appendChild(overlay);
    });
  }, [currentQIndex, questions[currentQIndex]?.content]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (startIndex === 20 && user && user.is_verified === false) {
          if (!cancelled) {
            setError('이메일 인증을 완료한 뒤 21번 문제부터 이어서 풀 수 있어요.');
            setLoading(false);
          }
          return;
        }
        const exam = await getExamService();
        if (!weaknessRetryMode) {
          const access = exam.checkExamAccess({
            user,
            certId,
            round,
            isWeaknessRound,
            weaknessTrialUsed: user?.weaknessTrialUsedByCert?.[certId] ?? false,
          });
          if (!access.allowed) {
            if (!cancelled) {
              setError(access.reason ?? '접근이 제한되었습니다.');
              setErrorRaw(null);
              setLoading(false);
            }
            return;
          }
        }

        let qs: Question[];
        /** 맞춤형(AI) 회차 등 이미 넘겨받은 문제가 있으면 재요청 없이 사용 → "문제를 불러오는 중" 미노출 */
        if (preFetchedQuestions && preFetchedQuestions.length > 0) {
          qs = preFetchedQuestions;
        } else if (weaknessRetryMode) {
          if (!cancelled) setError('문제를 불러올 수 없습니다.');
          setLoading(false);
          return;
        } else if (isWeaknessRound) {
          if (!user?.id) {
            if (!cancelled) {
              setError('약점 공략 모의고사는 로그인 후 이용할 수 있습니다.');
              setLoading(false);
            }
            return;
          }
          const roundNum = roundInfo?.round ?? 6;
          qs = await exam.fetchAdaptiveQuestions(user.id, certId, user, roundNum);
        } else {
          qs = await exam.getQuestionsForRound(certId, round, user);
        }

        if (!cancelled) {
          setQuestions(qs);
          if (qs.length === 0) {
            setError('문제를 불러올 수 없습니다.');
            setErrorRaw(null);
          }
          if (qs.length > 0 && roundInfo && round === 1) {
            if (user && startIndex != null && startIndex > 0) {
              // App에서 넘긴 1~20번 세션이 있으면 우선 사용 (인증 후 이어하기 시 1과목 이력 유지)
              if (initialSessionHistory && initialSessionHistory.length >= startIndex) {
                setSessionHistory(initialSessionHistory.slice(0, startIndex));
                setCurrentQIndex(startIndex);
              } else {
                const saved = loadGuestQuizProgress();
                if (saved?.certId === certId && saved?.roundId === roundId && saved.answers?.length >= startIndex) {
                  setSessionHistory(saved.answers.slice(0, startIndex));
                  setCurrentQIndex(startIndex);
                }
              }
            } else if (!user && (startIndex == null || startIndex === 0)) {
              saveGuestQuizProgress({
                certId,
                roundId,
                round: 1,
                startedAt: new Date().toISOString(),
                answers: [],
                currentIndex: 0,
              });
            }
          }
          if (qs.length > 0 && isWeaknessRound && user && !user.weaknessTrialUsedByCert?.[certId]) {
            exam.markWeaknessTrialUsed(user.id, certId).then(() => {
              onUpdateUser?.((u) => ({
                ...u,
                weaknessTrialUsedByCert: { ...(u.weaknessTrialUsedByCert ?? {}), [certId]: true },
              }));
            });
          }
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : '문제 로딩 실패');
          setErrorRaw(e);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [certId, roundId, round, isWeaknessRound, user, onUpdateUser, preFetchedQuestions, startIndex, initialSessionHistory]);

  useEffect(() => {
    if (questions.length === 0 || !user || startIndex == null || startIndex <= 0 || round !== 1) return;
    if (initialSessionHistory && initialSessionHistory.length >= startIndex) {
      setSessionHistory(initialSessionHistory.slice(0, startIndex));
      setCurrentQIndex(startIndex);
      return;
    }
    const saved = loadGuestQuizProgress();
    if (saved?.certId === certId && saved?.roundId === roundId && saved.answers?.length >= startIndex) {
      setSessionHistory(saved.answers.slice(0, startIndex));
      setCurrentQIndex(startIndex);
    }
  }, [questions.length, user, startIndex, certId, roundId, round, initialSessionHistory]);

  useEffect(() => {
    if (mode === 'study' && isSubmitted && explanationBoxRef.current) {
      const t = setTimeout(() => {
        explanationBoxRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
      return () => clearTimeout(t);
    }
  }, [mode, isSubmitted, currentQIndex]);

  const currentQ = questions[currentQIndex];
  /** 문항 목록에서 이전 문항으로 이동 시 동일하게 적용(실전/학습 공통) */
  const isViewingPast = currentQIndex < sessionHistory.length;
  const effectiveSelected = isViewingPast && sessionHistory[currentQIndex] ? sessionHistory[currentQIndex].selected : selectedOption;
  const effectiveSubmitted = isViewingPast || isSubmitted;

  const handleSubmit = useCallback(() => {
    if (selectedOption === null || !currentQ) return;
    setIsSubmitted(true);
  }, [selectedOption, currentQ]);

  const commitAnswerAndAdvance = useCallback(
    (nextHistory: QuizAnswerRecord[], opts?: { excludeFromLearningStats?: boolean }) => {
      const excludeFromLearningStats =
        opts?.excludeFromLearningStats !== undefined ? opts.excludeFromLearningStats : learningReflectionDisabled;

      setSessionHistory(nextHistory);

      if (!user && round === 1 && currentQIndex === GUEST_QUESTION_LIMIT - 1 && onGuestLimitReached) {
        saveGuestQuizProgress({
          certId,
          roundId,
          round: 1,
          startedAt: new Date().toISOString(),
          answers: mapHistoryForGuestStorage(nextHistory),
          currentIndex: GUEST_QUESTION_LIMIT,
        });
        onGuestLimitReached({ certId, roundId, sessionHistory: nextHistory, questions });
        return;
      }

      if (!user && roundInfo) {
        saveGuestQuizProgress({
          certId,
          roundId,
          round: roundInfo.round,
          startedAt: new Date().toISOString(),
          answers: mapHistoryForGuestStorage(nextHistory),
          currentIndex: currentQIndex + 1,
        });
      }

      if (currentQIndex < questions.length - 1) {
        setCurrentQIndex((prev) => prev + 1);
        setSelectedOption(null);
        setIsSubmitted(false);
        setIsConfused(false);
      } else {
        const finalCorrect = nextHistory.filter((a) => a.isCorrect).length;
        const finishMeta: QuizFinishMeta = { excludeFromLearningStats };
        if (weaknessRetryMode) {
          onWeaknessRetrySave?.(finalCorrect, questions.length, nextHistory, questions, finishMeta);
          setShowWeaknessRetryEndModal(true);
        } else {
          const currentRoundMemo = roundMemos[roundId] ?? { freeText: '', pins: [] };
          onFinish(finalCorrect, questions.length, nextHistory, questions, currentRoundMemo, finishMeta);
        }
      }
    },
    [
      learningReflectionDisabled,
      user,
      round,
      currentQIndex,
      onGuestLimitReached,
      certId,
      roundId,
      roundInfo,
      questions,
      weaknessRetryMode,
      onWeaknessRetrySave,
      onFinish,
      roundMemos,
    ],
  );

  const handleNext = useCallback(
    (overrideSelected?: number) => {
      if (!currentQ) return;
      let chosen: number | null = overrideSelected !== undefined ? overrideSelected : selectedOption;
      if (chosen === null && overrideSelected === undefined) {
        if (!isConfused) return;
        chosen = 0;
      }
      const answer1Based = to1BasedAnswer(currentQ.answer, currentQ.options.length);
      const isCorrect = chosen !== 0 && chosen === answer1Based;
      const elapsedSec = Math.round((Date.now() - questionStartTimeRef.current) / 1000);
      const nextHistory = [
        ...sessionHistory,
        { qid: currentQ.id, selected: chosen ?? 0, isCorrect, isDontKnow: chosen === 0, elapsedSec },
      ];

      if (!learningReflectionDisabled) {
        const pastCooldown = nextHistory.length >= rapidNextEligibleAtLengthRef.current;
        const streakOk = hasConsecutiveRapidAnswers(nextHistory);
        const underCap = rapidPromptsShownRef.current < RAPID_PROMPT_MAX_PER_QUIZ_SESSION;
        if (pastCooldown && streakOk && underCap) {
          rapidPromptsShownRef.current += 1;
          setRapidPendingHistory(nextHistory);
          setRapidSolveModalStep('ask');
          setShowRapidSolveModal(true);
          return;
        }
      }

      commitAnswerAndAdvance(nextHistory);
    },
    [currentQ, selectedOption, sessionHistory, isConfused, learningReflectionDisabled, commitAnswerAndAdvance],
  );

  const handleRapidSolveConfirmLearning = useCallback(() => {
    if (rapidPendingHistory) {
      rapidNextEligibleAtLengthRef.current =
        rapidPendingHistory.length + RAPID_PROMPT_COOLDOWN_AFTER_DISMISS_ANSWERS;
    }
    setShowRapidSolveModal(false);
    setRapidSolveModalStep('ask');
    const pending = rapidPendingHistory;
    setRapidPendingHistory(null);
    if (pending) commitAnswerAndAdvance(pending);
  }, [rapidPendingHistory, commitAnswerAndAdvance]);

  const handleRapidSolveChooseBrowse = useCallback(() => {
    setRapidSolveModalStep('acknowledge');
  }, []);

  const handleRapidSolveAckBrowse = useCallback(() => {
    setLearningReflectionDisabled(true);
    setShowRapidSolveModal(false);
    setRapidSolveModalStep('ask');
    const pending = rapidPendingHistory;
    setRapidPendingHistory(null);
    if (pending) commitAnswerAndAdvance(pending, { excludeFromLearningStats: true });
  }, [rapidPendingHistory, commitAnswerAndAdvance]);

  const handleOptionClick = useCallback(
    (idx: number) => {
      if (!currentQ) return;
      if (isSubmitted) return;
      if (mode === 'exam') {
        if (selectedOption === idx) handleNext(idx);
        else setSelectedOption(idx);
        return;
      }
      if (selectedOption === idx) handleSubmit();
      else setSelectedOption(idx);
    },
    [currentQ, selectedOption, isSubmitted, handleSubmit, mode, handleNext]
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!currentQ) return;
      const target = e.target as Node;
      const isInput = target && (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      );
      if (isInput) return;
      if (e.key === '1' || e.key === '2' || e.key === '3' || e.key === '4') {
        const num = parseInt(e.key, 10);
        if (num <= currentQ.options.length) {
          e.preventDefault();
          handleOptionClick(num);
        }
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (effectiveSubmitted) {
          if (isViewingPast) {
            if (currentQIndex < questions.length - 1) setCurrentQIndex((prev) => prev + 1);
            else handleNext();
          } else handleNext();
        } else if (selectedOption !== null) {
          if (mode === 'exam') handleNext();
          else handleSubmit();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentQ, mode, currentQIndex, effectiveSubmitted, isViewingPast, selectedOption, handleOptionClick, handleSubmit, handleNext, questions.length]);

  const progress = questions.length > 0 ? ((currentQIndex + 1) / questions.length) * 100 : 0;

  const confirmExit = () => setShowExitConfirmModal(true);
  const handleExitConfirm = () => {
    setShowExitConfirmModal(false);
    onExit();
  };

  const openQuestionList = useCallback(() => {
    setMemoOpen(false);
    setLnbOpen(true);
  }, []);

  const openMemoMobile = useCallback(() => {
    setLnbOpen(false);
    setMemoOpen(true);
  }, []);

  const goToQuestionIndex = useCallback(
    (idx: number) => {
      if (idx < 0 || idx >= questions.length) return;
      if (idx > sessionHistory.length) return;
      setLnbOpen(false);
      setCurrentQIndex(idx);
      setSelectedOption(null);
      setIsSubmitted(false);
      setIsConfused(false);
    },
    [questions.length, sessionHistory.length]
  );

  useEffect(() => {
    if (!lnbOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLnbOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lnbOpen]);

  const questionListBody = useMemo(
    () => (
      <div className="p-4 pt-2">
        <div className="grid grid-cols-5 gap-2 sm:grid-cols-6 lg:grid-cols-8">
          {questions.map((q, idx) => {
            const disabled = idx > sessionHistory.length;
            const rec = sessionHistory[idx];
            const isCurrent = idx === currentQIndex;
            const correct = rec?.isCorrect === true;
            const wrong = rec && !rec.isCorrect && !rec.isDontKnow;
            const dontKnow = rec?.isDontKnow === true || rec?.selected === 0;
            let ring = 'border-slate-200 bg-white text-slate-700 hover:border-slate-300';
            if (isCurrent) ring = 'border-[#0034d3] bg-[#0034d3]/10 text-[#0034d3] ring-2 ring-[#0034d3]/30';
            if (!disabled && rec && !isCurrent) {
              if (correct) ring = 'border-emerald-400 bg-emerald-50 text-emerald-900';
              else if (wrong) ring = 'border-rose-400 bg-rose-50 text-rose-900';
              else if (dontKnow) ring = 'border-amber-300 bg-amber-50 text-amber-900';
            }
            if (disabled) ring = 'border-slate-100 bg-slate-50 text-slate-300 cursor-not-allowed';
            return (
              <button
                key={q.id}
                type="button"
                disabled={disabled}
                onClick={() => goToQuestionIndex(idx)}
                className={`min-h-[44px] rounded-xl border text-sm font-bold tabular-nums transition-colors ${ring}`}
              >
                {idx + 1}
              </button>
            );
          })}
        </div>
      </div>
    ),
    [questions, sessionHistory, currentQIndex, goToQuestionIndex],
  );

  if (loading) {
    return (
      <div className="min-h-[100dvh] md:min-h-screen flex items-center justify-center bg-[#edf1f5]">
        <div className="text-slate-400 font-medium">문제를 불러오는 중...</div>
      </div>
    );
  }
  if (error || !currentQ) {
    const displayMessage = error || '문제를 불러올 수 없습니다.';
    const errorCode = getErrorCode(errorRaw ?? displayMessage);
    const permissionHint = errorCode === 'ERR_FIREBASE_PERMISSION'
      ? 'Firestore 규칙이 배포되지 않았을 수 있습니다. 터미널에서 firebase deploy --only firestore:rules 실행 후 다시 시도해 주세요.'
      : undefined;
    return (
      <ErrorView
        message={displayMessage}
        errorCode={errorCode}
        onBack={onExit}
        backLabel="돌아가기"
        hint={permissionHint}
      />
    );
  }

  const subjectNum = currentQ.subject_number ?? 1;
    const modeLabel = mode === 'exam' ? '실전 모드' : '학습 모드';
    const theme = QUIZ_THEME[mode];
    const subjectName = SUBJECT_NAMES_BY_CERT[certCode]?.[subjectNum - 1];
  const subjectLabel = subjectName ? `${subjectNum}과목. ${subjectName}` : `${subjectNum}과목`;

  const currentRoundMemo = roundMemos[roundId] ?? { freeText: '', pins: [] };
  const addPin = () => {
    const qTag = `[Q.${String(currentQIndex + 1).padStart(2, '0')}]`;
    const newText = currentRoundMemo.freeText ? `${currentRoundMemo.freeText}\n${qTag}` : qTag;
    if (newText.length <= MEMO_MAX_LENGTH) setMemoFreeText(newText);
  };
  const setMemoFreeText = (value: string) => {
    const trimmed = value.slice(0, MEMO_MAX_LENGTH);
    setRoundMemos((prev) => ({ ...prev, [roundId]: { ...currentRoundMemo, freeText: trimmed } }));
  };

  const answerNum = to1BasedAnswer(currentQ.answer, currentQ.options.length);

  return (
    <div className="flex h-full min-h-0 w-full bg-[#edf1f5] text-slate-800 font-sans overflow-hidden md:min-h-0 md:h-screen">
      {/*
        정보 우선순위(모바일): ① 지금 풀 문제 맥락(제목·진행) ② 풀이/내비 ③ 부가(메모·목록은 시트).
        문항 목록 = 가벼운 선택 → 바텀 시트(sheet 내부 단일 스크롤).
      */}
      <MobileSheet
        open={lnbOpen}
        onClose={() => setLnbOpen(false)}
        title="문항 목록"
        description={<>진행 <span className="tabular-nums">{currentQIndex + 1}</span>/{questions.length} · 아직 안 푼 번호는 비활성</>}
        size="lg"
      >
        {questionListBody}
      </MobileSheet>

      {/* lg+: MobileSheet가 lg:hidden 이라 문항 이동은 중앙 모달(배경 클릭·Esc로 닫기) */}
      {lnbOpen ? (
        <div
          className="hidden lg:block"
          role="dialog"
          aria-modal="true"
          aria-labelledby="quiz-question-list-desktop-title"
        >
          <button
            type="button"
            className="fixed inset-0 z-[100] bg-black/40 transition-opacity"
            aria-label="닫기"
            onClick={() => setLnbOpen(false)}
          />
          <div
            className="fixed left-1/2 top-1/2 z-[110] w-full max-w-lg max-h-[min(85vh,720px)] -translate-x-1/2 -translate-y-1/2 flex flex-col rounded-2xl bg-white shadow-xl border border-slate-200 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="shrink-0 flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100 bg-white">
              <div className="min-w-0" id="quiz-question-list-desktop-title">
                <p className="text-base font-bold text-slate-900 leading-tight">문항 목록</p>
                <div className="text-xs text-slate-500 mt-0.5">
                  진행 <span className="tabular-nums">{currentQIndex + 1}</span>/{questions.length} · 아직 안 푼 번호는 비활성
                </div>
              </div>
              <button
                type="button"
                onClick={() => setLnbOpen(false)}
                className="min-h-11 min-w-11 flex items-center justify-center rounded-xl text-slate-600 hover:bg-slate-100 shrink-0"
                aria-label="닫기"
              >
                <X size={22} />
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain">{questionListBody}</div>
          </div>
        </div>
      ) : null}

      <main className="flex-1 min-w-0 flex flex-col h-full min-h-0 overflow-hidden relative">
        <MobilePageHeader
          title={quizPageTitle}
          subtitle={
            <>
              <span className="tabular-nums">{currentQIndex + 1}</span> / {questions.length} · {modeLabel}
            </>
          }
          left={
            <>
              {onOpenAppMenu && (
                <button
                  type="button"
                  onClick={onOpenAppMenu}
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center text-[#1e56cd] shrink-0 rounded-xl"
                  aria-label="메인 메뉴"
                >
                  <PanelLeft size={22} strokeWidth={2} />
                </button>
              )}
              <button
                type="button"
                onClick={openQuestionList}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-600 hover:text-slate-900 shrink-0 rounded-xl"
                aria-label="문항 목록 열기"
              >
                <Menu size={22} />
              </button>
            </>
          }
          right={
            <button
              type="button"
              onClick={confirmExit}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-600 hover:text-slate-900 shrink-0 rounded-xl"
              aria-label="시험 종료"
            >
              <LogOut className="w-5 h-5 rotate-180" />
            </button>
          }
          bottom={
            <div className="h-1 bg-gray-100 w-full">
              <div
                className={`h-full transition-all duration-300 ease-out ${mode === 'exam' ? 'bg-blue-600' : 'bg-[#0034d3]'}`}
                style={{ width: `${progress}%` }}
              />
            </div>
          }
        />
        {learningReflectionDisabled && (
          <div className="lg:hidden shrink-0 px-3 py-2 bg-amber-50 border-b border-amber-200/80 text-center text-[11px] text-amber-900 font-medium leading-snug">
            이번 풀이는 학습 이해도·통계에 반영되지 않습니다.
          </div>
        )}

        <div className="flex-1 min-h-0 flex flex-col overflow-hidden p-4 pb-[max(5.75rem,env(safe-area-inset-bottom)+4.5rem)] md:p-6 md:pb-[max(5.75rem,env(safe-area-inset-bottom)+4.5rem)] lg:p-8 lg:pb-8">
          <div className="flex flex-1 min-h-0 w-full max-w-[90rem] relative">
            {/* 1. 문제 카드: 상단 고정 높이 + 하단 보기 고정 */}
            <div className="flex-1 min-h-0 bg-white rounded-3xl shadow-sm border border-slate-200 flex flex-col overflow-hidden relative min-w-0 z-10">
              <header className={`hidden lg:flex relative border-b border-gray-100 px-6 md:px-8 py-4 items-center justify-center shrink-0 ${mode === 'exam' ? 'bg-blue-50/30' : 'bg-[#99ccff]/50'}`}>
                <div className="absolute left-6 md:left-8 top-1/2 -translate-y-1/2 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={confirmExit}
                    className="hidden lg:flex items-center justify-center w-9 h-9 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors"
                    aria-label="시험 종료"
                  >
                    <LogOut className="w-5 h-5 rotate-180" />
                  </button>
                  <button
                    type="button"
                    onClick={openQuestionList}
                    aria-label="문항 목록 열기"
                    aria-expanded={lnbOpen}
                    className={`${theme.tag} text-sm px-3 py-1 rounded-full font-bold shadow-sm cursor-pointer hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0034d3] focus-visible:ring-offset-2`}
                  >
                    Q.{String(currentQIndex + 1).padStart(2, '0')}
                  </button>
                  {useBetaCertifications && (
                    <button
                      type="button"
                      onClick={() => { setReportToast(null); setReportModalOpen(true); }}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-medium border border-slate-200"
                      aria-label="문제 신고"
                    >
                      <Flag size={12} />
                      신고
                    </button>
                  )}
                </div>
                <div className="flex flex-col items-center text-center">
                  <span className={`text-xs md:text-sm font-semibold ${mode === 'exam' ? 'text-blue-600' : 'text-[#0034d3]'}`}>
                    {quizPageTitle} | {modeLabel}
                  </span>
                  <span className="text-sm md:text-base font-bold text-slate-800 mt-0.5">{subjectLabel}</span>
                </div>
                <div className="absolute right-6 md:right-8 top-1/2 -translate-y-1/2">
                  <button
                    type="button"
                    onClick={openQuestionList}
                    aria-label="문항 목록 열기"
                    aria-expanded={lnbOpen}
                    className={`text-xs md:text-sm font-semibold px-3 py-1 rounded-full cursor-pointer hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0034d3] focus-visible:ring-offset-2 ${mode === 'exam' ? 'bg-blue-100 text-blue-700' : 'bg-[#99ccff] text-[#0034d3]'}`}
                  >
                    {currentQIndex + 1}/{questions.length}
                  </button>
                </div>
              </header>

              <div className="hidden lg:block h-1 bg-gray-100 w-full shrink-0">
                <div className={`h-full transition-all duration-300 ease-out ${mode === 'exam' ? 'bg-blue-600' : 'bg-[#0034d3]'}`} style={{ width: `${progress}%` }} />
              </div>
              {learningReflectionDisabled && (
                <div className="hidden lg:block shrink-0 px-4 py-2 bg-amber-50 border-b border-amber-200/80 text-center text-xs text-amber-900 font-medium leading-snug">
                  이번 풀이는 학습 이해도·통계에 반영되지 않습니다.
                </div>
              )}

              <ContentProtectionWrapper
                className="flex-1 min-h-0 flex flex-col min-w-0 overflow-hidden"
                guardEnabled
                watermarkText={null}
                onContextLeave={() => setCopyrightFlash(COPYRIGHT_COPY.tabContextReminder)}
              >
                {/* 지문: flex-1 스크롤 / 보기: 패널 하단 고정, 긴 보기는 보기 영역 내부 스크롤. xl+ 학습 모드 2열 */}
                <div className={`flex-1 min-h-0 flex flex-col overflow-hidden p-4 md:p-6 xl:p-8 ${mode === 'study' ? 'xl:flex-row xl:gap-8 xl:items-stretch' : ''}`}>
                  <div
                    className={`min-w-0 flex min-h-0 flex-1 flex-col overflow-hidden w-full ${mode === 'study' ? 'xl:flex-[7] xl:min-h-0' : 'xl:flex-1 xl:min-h-0'} ${mode === 'exam' ? 'max-w-4xl mx-auto w-full' : ''}`}
                  >
                    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden xl:min-h-0">
                    {/* 취약 유형/취약 개념 집중학습 시 지문 상단 태그 */}
                    {(roundId === '__weak_type_focus__' || roundId === '__weak_concept_focus__') && (
                      <div className="shrink-0 flex flex-wrap items-center gap-2 mb-3">
                        {roundId === '__weak_type_focus__' && (
                          (currentQ.problem_types?.length ? currentQ.problem_types : currentQ.tags ?? []).map((label, i) => (
                            <span key={i} className="px-2.5 py-1 rounded-md text-xs font-medium bg-[#99ccff]/50 text-[#1e56cd] border border-[#99ccff]/70">
                              {typeof label === 'string' ? label : String(label)}
                            </span>
                          ))
                        )}
                        {roundId === '__weak_concept_focus__' && (
                          <>
                            {currentQ.core_concept && (
                              <span className="px-2.5 py-1 rounded-md text-xs font-bold bg-[#1e56cd] text-white border border-[#0034d3]">
                                {currentQ.core_concept}
                              </span>
                            )}
                            {(certInfo?.core_concept_keywords?.[currentQ.core_concept ?? ''] ?? []).map((kw, i) => (
                              <span key={i} className="px-2.5 py-1 rounded-md text-xs font-medium bg-[#99ccff]/50 text-[#1e56cd] border border-[#99ccff]/70">
                                {kw}
                              </span>
                            ))}
                          </>
                        )}
                      </div>
                    )}
                    <div className="lg:hidden shrink-0 flex items-center justify-between gap-2 mb-3 pb-2 border-b border-slate-100">
                      <span className="text-xs font-bold text-slate-800 truncate">{subjectLabel}</span>
                      {useBetaCertifications && (
                        <button
                          type="button"
                          onClick={() => { setReportToast(null); setReportModalOpen(true); }}
                          className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-medium border border-slate-200 min-h-[40px]"
                          aria-label="문제 신고"
                        >
                          <Flag size={12} />
                          신고
                        </button>
                      )}
                    </div>
                    {/* 지문+테이블+이미지: 남는 높이를 채우고 스크롤 (보기는 하단 도킹) */}
                    <div className="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
                    <div
                      ref={questionBodyRef}
                      className={
                        'overflow-x-auto pr-2 shrink-0 text-[15px] sm:text-base text-gray-800 leading-snug sm:leading-relaxed break-keep w-full ' +
                        '[&_table]:w-full [&_table]:min-w-[min(100%,400px)] [&_table]:border-collapse [&_table]:my-4 [&_table]:text-sm ' +
                        '[&_th]:border [&_th]:border-slate-300 [&_th]:bg-slate-100 [&_th]:p-3 [&_th]:text-center [&_td]:border [&_td]:border-slate-300 [&_td]:p-3 ' +
                        '[&_pre]:bg-slate-800 [&_pre]:text-slate-50 [&_pre]:p-4 [&_pre]:rounded-xl [&_pre]:overflow-x-auto [&_pre]:text-sm [&_pre]:my-4 [&_pre]:font-mono ' +
                        '[&_code]:bg-slate-100 [&_code]:text-pink-600 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-sm'
                      }
                    >
                      <RichText content={currentQ.content} as="div" />
                      {currentQ.tableData != null && (
                        <div className="w-full overflow-x-auto mt-4 [&_table]:w-full [&_table]:min-w-[400px] [&_table]:border-collapse [&_table]:text-sm [&_th]:border [&_th]:border-slate-300 [&_th]:bg-slate-100 [&_th]:p-3 [&_th]:text-center [&_td]:border [&_td]:border-slate-300 [&_td]:p-3">
                          {typeof currentQ.tableData === 'string' ? (
                            <RichText content={currentQ.tableData} as="div" />
                          ) : Array.isArray(currentQ.tableData?.headers) && Array.isArray(currentQ.tableData?.rows) ? (
                            <table>
                              <thead>
                                <tr>
                                  {currentQ.tableData.headers.map((h, i) => (
                                    <th key={i}>{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {currentQ.tableData.rows.map((row, ri) => (
                                  <tr key={ri}>
                                    {row.map((cell, ci) => (
                                      <td key={ci}>{cell}</td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          ) : null}
                        </div>
                      )}
                      {currentQ.imageUrl && (
                        <div className="flex justify-start mt-4 quiz-image-explicit">
                          <div className="relative w-full max-w-full sm:max-w-md rounded-xl overflow-hidden border border-slate-200 bg-slate-50 min-h-[88px] max-xl:min-h-[88px] xl:min-h-[180px]">
                            {imageLoadError ? (
                              <img
                                src="/sample-question-image.png"
                                alt="문제"
                                className="w-full h-auto object-contain max-xl:max-h-[min(28vh,220px)] max-h-[min(40vh,260px)] xl:max-h-80 min-h-[88px] xl:min-h-[180px]"
                              />
                            ) : (
                              <img
                                src={currentQ.imageUrl}
                                alt="문제"
                                className="w-full h-auto object-contain max-xl:max-h-[min(28vh,220px)] max-h-[min(40vh,260px)] xl:max-h-80 min-h-[88px] xl:min-h-[180px]"
                                onError={() => setImageLoadError(true)}
                              />
                            )}
                            {(!currentQ.imageUrl || !currentQ.imageUrl.startsWith('http') || imageLoadError) && (
                              <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-10 pointer-events-none">
                                <span className="text-white font-bold text-sm px-4 py-2 rounded-lg bg-black/40">이미지 준비중</span>
                              </div>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                const src = imageLoadError ? '/sample-question-image.png' : currentQ.imageUrl;
                                setEnlargedImageSrc(src ?? null);
                                setShowImageEnlarged(true);
                              }}
                              className="absolute right-2 top-2 w-9 h-9 rounded-lg bg-white/90 hover:bg-white shadow border border-slate-200 flex items-center justify-center text-slate-600 hover:text-slate-900 transition-colors z-20"
                              aria-label="이미지 확대"
                            >
                              <Search size={18} />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                    </div>
                    {/* 보기: 카드 하단 고정, 내용이 길면 이 영역만 스크롤 */}
                    <div className="flex w-full shrink-0 flex-col border-t border-slate-200/90 bg-white/70 pt-2 sm:pt-3">
                    <div className="max-h-[min(52dvh,520px)] min-h-0 w-full overflow-x-auto overflow-y-auto overscroll-y-contain">
                    <div className="bg-slate-50/50 rounded-2xl p-3 sm:p-4 border border-slate-100">
                      <div className="space-y-2">
                        {currentQ.options.map((opt, idx) => {
                          const optNum = idx + 1;
                          const isSelected = effectiveSelected === optNum;
                          const isCorrectOpt = optNum === answerNum;
                          const isWrongSelected = effectiveSubmitted && isSelected && !isCorrectOpt;
                          let btnClass = 'w-full min-h-[44px] px-3 py-2 sm:px-4 sm:py-2.5 rounded-xl text-left flex items-center gap-3 transition-all select-none border bg-white ';
                          let numSpanClass = 'w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center shrink-0 transition-colors border ';
                          let icon = null;
                          if (effectiveSubmitted) {
                            if (isCorrectOpt) {
                              btnClass += 'ring-2 ring-green-500 border-green-500 bg-green-50 text-green-900 font-bold';
                              numSpanClass += 'bg-green-500 text-white border-green-500';
                              icon = <CheckCircle className="text-green-600 shrink-0" size={18} />;
                            } else if (isWrongSelected) {
                              btnClass += 'ring-2 ring-red-500 border-red-500 bg-red-50 text-red-900 font-bold';
                              numSpanClass += 'bg-red-500 text-white border-red-500';
                              icon = <XCircle className="text-red-600 shrink-0" size={18} />;
                            } else {
                              btnClass += 'border-gray-200 bg-white opacity-50 grayscale';
                              numSpanClass += 'bg-gray-100 text-gray-400 border-gray-200';
                            }
                          } else {
                            if (isSelected) {
                              btnClass += 'ring-2 ring-blue-500 border-blue-500 bg-blue-50 text-blue-900 font-bold shadow-sm';
                              numSpanClass += 'bg-blue-500 text-white border-blue-500';
                            } else {
                              btnClass += 'border-gray-200 text-gray-700 hover:border-blue-300 hover:bg-blue-50/30';
                              numSpanClass += 'bg-gray-100 text-gray-500 border-gray-200';
                            }
                          }
                          return (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => handleOptionClick(optNum)}
                              disabled={effectiveSubmitted}
                              className={btnClass}
                            >
                              <span className={numSpanClass}>{optNum}</span>
                              <div
                                className={
                                  'flex-1 text-[13px] md:text-sm leading-snug break-keep w-full overflow-x-auto ' +
                                  '[&_table]:w-full [&_table]:min-w-[200px] [&_table]:border-collapse [&_table]:my-1 [&_table]:text-xs ' +
                                  '[&_th]:border [&_th]:border-slate-300 [&_th]:bg-slate-100 [&_th]:p-2 [&_td]:border [&_td]:border-slate-300 [&_td]:p-2 ' +
                                  '[&_pre]:bg-slate-800 [&_pre]:text-slate-50 [&_pre]:p-2 [&_pre]:rounded-lg [&_pre]:text-xs [&_code]:bg-slate-100 [&_code]:text-pink-600 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded'
                                }
                              >
                                <RichText content={opt} as="div" />
                              </div>
                              {icon}
                            </button>
                          );
                        })}
                      </div>
                      {useBetaCertifications && !effectiveSubmitted && (
                        <div className="mt-2 flex justify-end">
                          <button
                            type="button"
                            onClick={() => {
                              if (mode === 'exam') {
                                setIsConfused(true);
                                handleNext(0);
                              } else {
                                setIsConfused(true);
                                setIsSubmitted(true);
                              }
                            }}
                            className="px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 text-sm font-medium border border-slate-200"
                            aria-label="모르겠어요"
                          >
                            모르겠어요
                          </button>
                        </div>
                      )}
                    </div>
                    </div>
                    {/* 버튼 영역: 데스크톱·큰 태블릿만 카드 내 고정 (모바일은 하단 액션바) */}
                    <div className="hidden lg:block w-full shrink-0 pt-4">
                      {mode === 'exam' ? (
                        <button
                          type="button"
                          onClick={() => selectedOption !== null && handleNext(selectedOption)}
                          disabled={selectedOption === null}
                          className="w-full bg-slate-800 text-white font-bold py-4 px-6 rounded-2xl hover:bg-slate-900 transition-all flex items-center justify-center gap-2 disabled:opacity-30 disabled:cursor-not-allowed shadow-sm"
                        >
                          {currentQIndex < questions.length - 1 ? '다음 문제' : '결과 보기'} <ChevronRight className="w-4 h-4" />
                        </button>
                      ) : (
                        <div className="flex w-full gap-2">
                          <button
                            type="button"
                            onClick={() => setCurrentQIndex((prev) => prev - 1)}
                            disabled={currentQIndex === 0}
                            className="w-14 md:w-auto md:px-5 py-4 rounded-2xl border border-slate-200 text-slate-600 font-bold hover:bg-slate-50 disabled:opacity-30 flex items-center justify-center gap-1 transition-colors"
                          >
                            <ChevronLeft className="w-5 h-5" /> <span className="hidden md:inline">이전</span>
                          </button>
                          {!effectiveSubmitted ? (
                            <button
                              type="button"
                              onClick={handleSubmit}
                              disabled={selectedOption === null}
                              className="flex-1 bg-slate-800 text-white font-bold py-4 px-6 rounded-2xl hover:bg-slate-900 transition-all flex items-center justify-center gap-2 disabled:opacity-30 shadow-sm"
                            >
                              정답 확인
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                if (isViewingPast) {
                                  if (currentQIndex < questions.length - 1) setCurrentQIndex((prev) => prev + 1);
                                  else handleNext();
                                } else handleNext();
                              }}
                              className="flex-1 bg-blue-600 text-white font-bold py-4 px-6 rounded-2xl hover:bg-blue-700 transition-all flex items-center justify-center gap-2 shadow-sm"
                            >
                              {currentQIndex < questions.length - 1 ? '다음 문제' : '결과 보기'} <ChevronRight className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                    </div>
                    </div>
                  </div>
                  {/* 우측: 정답·해설 영역 (학습 모드, 7:3 비율 중 3). 길면 영역 내 스크롤 */}
                  {mode === 'study' && (
                    <div
                      ref={explanationBoxRef}
                      className="w-full max-xl:flex-none max-xl:shrink-0 flex flex-col xl:flex-[3] xl:shrink-0 xl:min-h-0 min-h-0"
                    >
                      <div className="bg-blue-50/50 border border-blue-100 rounded-2xl p-5 shadow-sm overflow-x-auto flex flex-col max-xl:flex-none max-xl:min-h-0 max-xl:overflow-y-visible xl:flex-1 xl:min-h-0 xl:overflow-y-auto">
                        {effectiveSubmitted ? (
                          (() => {
                            const isConfusedSubmit = (effectiveSelected === null && isConfused) || effectiveSelected === 0;
                            return (
                          <div className="animate-slide-up">
                            {isPremium && (currentQ.core_concept || currentQ.core_id) && (
                              <div className="mb-3 flex flex-wrap items-center gap-1.5">
                                <span className="inline-flex items-center px-2.5 py-1 rounded-md text-[11px] font-medium bg-slate-200/90 text-slate-600 border border-slate-200/80">
                                  {currentQ.core_concept || (currentQ.core_id ? `코어 ${currentQ.core_id}` : '—')}
                                </span>
                              </div>
                            )}
                            <div className="mb-2">
                              <p className="text-xs font-black text-blue-600 uppercase mb-2 flex items-center gap-1">
                                <Lightbulb className="w-4 h-4" /> 정답해설
                              </p>
                              <div
                                className={
                                  'text-slate-700 text-sm leading-relaxed break-keep w-full overflow-x-auto ' +
                                  '[&_table]:w-full [&_table]:min-w-[400px] [&_table]:border-collapse [&_table]:my-4 [&_table]:text-sm ' +
                                  '[&_th]:border [&_th]:border-slate-300 [&_th]:bg-slate-100 [&_th]:p-3 [&_td]:border [&_td]:border-slate-300 [&_td]:p-3 ' +
                                  '[&_pre]:bg-slate-800 [&_pre]:text-slate-50 [&_pre]:p-4 [&_pre]:rounded-xl [&_pre]:text-sm [&_code]:bg-slate-100 [&_code]:text-pink-600 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded'
                                }
                              >
                                {/* 정답일 때: 롱 피드백(선택한 보기) 먼저, 그 다음 explanation — 구분선 없이 이어서 */}
                                {!isConfusedSubmit && effectiveSelected !== null && effectiveSelected === answerNum && currentQ.wrongFeedback?.[String(effectiveSelected)] ? (
                                  <>
                                    <RichText content={currentQ.wrongFeedback[String(effectiveSelected)]} as="div" />
                                    <div className="mt-3">
                                      <RichText content={currentQ.explanation} as="div" />
                                    </div>
                                  </>
                                ) : (
                                  <RichText content={currentQ.explanation} as="div" />
                                )}
                              </div>
                            </div>
                            {/* 모르겠어요: 정답 해설 + 오답별 모든 피드백 */}
                            {isConfusedSubmit && currentQ.wrongFeedback && (
                              <div className="mt-4 pt-4 border-t border-slate-100 space-y-4">
                                <p className="text-xs font-black text-red-500 mb-2 flex items-center gap-1">
                                  <AlertTriangle className="w-4 h-4 text-red-500" /> 오답별 피드백
                                </p>
                                {currentQ.options.map((_, idx) => {
                                  const optNum = idx + 1;
                                  if (optNum === answerNum) return null;
                                  const fb = currentQ.wrongFeedback?.[String(optNum)];
                                  if (!fb) return null;
                                  return (
                                    <div key={optNum} className="rounded-xl border border-slate-200 bg-white p-3">
                                      <span className="text-xs font-bold text-slate-500 mb-2 block">{optNum}번 오답</span>
                                      <div
                                        className={
                                          'text-slate-700 text-sm leading-7 break-keep w-full overflow-x-auto ' +
                                          '[&_table]:w-full [&_table]:min-w-[400px] [&_table]:border-collapse [&_table]:my-2 [&_table]:text-sm ' +
                                          '[&_th]:border [&_th]:border-slate-300 [&_th]:bg-slate-100 [&_th]:p-2 [&_td]:border [&_td]:border-slate-300 [&_td]:p-2 ' +
                                          '[&_pre]:bg-slate-800 [&_pre]:text-slate-50 [&_pre]:p-3 [&_pre]:rounded-lg [&_pre]:text-xs [&_code]:bg-slate-100 [&_code]:text-pink-600 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded'
                                        }
                                      >
                                        <RichText content={fb} as="div" />
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                            {!isConfusedSubmit && effectiveSelected !== null && effectiveSelected !== answerNum && (
                              <div className={`mt-4 pt-4 border-t border-slate-100 ${!isPremium ? 'opacity-70 text-slate-500' : ''}`}>
                                <p className="text-xs font-black text-red-500 mb-1 flex items-center gap-1">
                                  <AlertTriangle className="w-4 h-4 text-red-500" /> 오답 가이드
                                </p>
                                {isPremium && currentQ.wrongFeedback?.[String(effectiveSelected)] ? (
                                  <div
                                    className={
                                      'text-slate-700 text-sm leading-7 break-keep w-full overflow-x-auto ' +
                                      '[&_table]:w-full [&_table]:min-w-[400px] [&_table]:border-collapse [&_table]:my-4 [&_table]:text-sm ' +
                                      '[&_th]:border [&_th]:border-slate-300 [&_th]:bg-slate-100 [&_th]:p-3 [&_td]:border [&_td]:border-slate-300 [&_td]:p-3 ' +
                                      '[&_pre]:bg-slate-800 [&_pre]:text-slate-50 [&_pre]:p-4 [&_pre]:rounded-xl [&_pre]:text-sm [&_code]:bg-slate-100 [&_code]:text-pink-600 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded'
                                    }
                                  >
                                    <RichText content={currentQ.wrongFeedback[String(effectiveSelected)]} as="div" />
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => onRequestCheckout?.()}
                                    className="w-full text-left text-slate-500 text-sm font-medium flex items-center gap-2 hover:text-slate-700 transition-colors cursor-pointer"
                                  >
                                    <Crown className="w-4 h-4 text-[#0034d3] shrink-0" />
                                    {WRONG_FEEDBACK_PLACEHOLDER}
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                            );
                          })()
                        ) : (
                          /* 풀이 중: 해설 숨김, 전구 아이콘만 표시 */
                          <div className="flex max-xl:min-h-[100px] xl:flex-1 items-start justify-center pt-8">
                            <Lightbulb className="w-12 h-12 text-blue-200" aria-hidden />
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
                <QuizCopyrightFooter />
              </ContentProtectionWrapper>
            </div>

          </div>
        </div>

        <MobileBottomActionBar hidden={memoOpen || lnbOpen}>
            {mode === 'study' ? (
              <>
                <button
                  type="button"
                  onClick={() => setCurrentQIndex((prev) => prev - 1)}
                  disabled={currentQIndex === 0}
                  className="min-h-[48px] min-w-[48px] shrink-0 rounded-xl border border-slate-200 text-slate-700 font-bold hover:bg-slate-50 disabled:opacity-30 flex items-center justify-center"
                  aria-label="이전 문항"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                {!effectiveSubmitted ? (
                  <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={selectedOption === null}
                    className="flex-1 min-h-[48px] rounded-xl bg-slate-800 text-white font-bold text-sm px-3 hover:bg-slate-900 disabled:opacity-30 disabled:cursor-not-allowed shadow-sm flex items-center justify-center gap-1"
                  >
                    정답 확인
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      if (isViewingPast) {
                        if (currentQIndex < questions.length - 1) setCurrentQIndex((prev) => prev + 1);
                        else handleNext();
                      } else handleNext();
                    }}
                    className="flex-1 min-h-[48px] rounded-xl bg-blue-600 text-white font-bold text-sm px-3 hover:bg-blue-700 shadow-sm flex items-center justify-center gap-1"
                  >
                    {currentQIndex < questions.length - 1 ? '다음 문제' : '결과 보기'}
                    <ChevronRight className="w-4 h-4 shrink-0" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={openMemoMobile}
                  className="min-h-[48px] min-w-[48px] shrink-0 rounded-xl border border-amber-200 bg-amber-50 text-amber-900 flex items-center justify-center hover:bg-amber-100"
                  aria-label="메모 열기"
                >
                  <StickyNote className="w-5 h-5" />
                </button>
                <button
                  type="button"
                  onClick={openQuestionList}
                  className="min-h-[48px] min-w-[48px] shrink-0 rounded-xl border border-slate-200 text-slate-700 flex items-center justify-center hover:bg-slate-50"
                  aria-label="문항 목록"
                >
                  <Menu className="w-5 h-5" />
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={openQuestionList}
                  className="min-h-[48px] min-w-[48px] shrink-0 rounded-xl border border-slate-200 text-slate-700 flex items-center justify-center hover:bg-slate-50"
                  aria-label="문항 목록"
                >
                  <Menu className="w-5 h-5" />
                </button>
                <button
                  type="button"
                  onClick={openMemoMobile}
                  className="min-h-[48px] min-w-[48px] shrink-0 rounded-xl border border-amber-200 bg-amber-50 text-amber-900 flex items-center justify-center hover:bg-amber-100"
                  aria-label="메모 열기"
                >
                  <StickyNote className="w-5 h-5" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (isViewingPast) {
                      if (currentQIndex < questions.length - 1) setCurrentQIndex((prev) => prev + 1);
                      else handleNext();
                    } else if (selectedOption !== null) handleNext(selectedOption);
                  }}
                  disabled={!isViewingPast && selectedOption === null}
                  className="flex-1 min-h-[48px] rounded-xl bg-slate-800 text-white font-bold text-sm px-3 hover:bg-slate-900 disabled:opacity-30 disabled:cursor-not-allowed shadow-sm flex items-center justify-center gap-1"
                >
                  {currentQIndex < questions.length - 1 ? '다음 문제' : '결과 보기'}
                  <ChevronRight className="w-4 h-4 shrink-0" />
                </button>
              </>
            )}
        </MobileBottomActionBar>
      </main>

      {/* 데스크탑 메모 백드롭 (클릭 시 닫힘) */}
      <div
        className={`hidden lg:block fixed inset-0 z-40 transition-opacity duration-300 bg-black/20 ${memoOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
        onClick={() => setMemoOpen(false)}
        onKeyDown={(e) => e.key === 'Escape' && setMemoOpen(false)}
        aria-hidden="true"
      />

      {/* 데스크탑 메모 패널 (fixed 오버레이 - 노란색+흰색) */}
      <div
        className={`hidden lg:flex flex-col fixed top-0 right-0 bottom-0 w-[320px] z-50 bg-yellow-100 border-l border-amber-200 shadow-[-4px_0_20px_rgba(0,0,0,0.08)] transition-transform duration-300 ease-in-out overflow-hidden ${memoOpen ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-amber-200 shrink-0 bg-white">
          <span className="font-bold text-slate-900 flex items-center gap-2">
            <StickyNote className="w-4 h-4 text-amber-600" /> 메모
          </span>
          <button type="button" onClick={() => setMemoOpen(false)} className="p-1 hover:bg-amber-100 rounded text-slate-600 transition-colors" aria-label="메모 닫기">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 p-5 flex flex-col min-h-0 overflow-hidden bg-white/80">
          <textarea
            value={currentRoundMemo.freeText}
            onChange={(e) => setMemoFreeText(e.target.value.slice(0, MEMO_MAX_LENGTH))}
            placeholder="기억하고 싶은 내용을 적어보세요."
            maxLength={MEMO_MAX_LENGTH}
            className="w-full flex-1 p-4 text-sm text-slate-800 resize-none focus:outline-none bg-transparent placeholder:text-slate-400 leading-relaxed"
          />
          <div className="pt-4 flex justify-between items-center shrink-0 border-t border-amber-200">
            <span className="text-xs text-slate-500">{currentRoundMemo.freeText.length}/{MEMO_MAX_LENGTH}자</span>
            <button type="button" onClick={addPin} className="px-3 py-2 text-xs font-bold text-amber-800 bg-amber-100 hover:bg-amber-200 rounded-lg transition-colors flex items-center gap-1.5">
              <Pin className="w-3.5 h-3.5" /> Q.{String(currentQIndex + 1).padStart(2, '0')} 추가
            </button>
          </div>
        </div>
      </div>

      {/* 모바일 메모: 바텀 시트(긴 폼 아님, 단일 스크롤 영역) */}
      <MobileSheet
        open={memoOpen}
        onClose={() => setMemoOpen(false)}
        title="메모"
        size="lg"
        panelClassName="bg-amber-50 border-amber-200"
        headerClassName="border-amber-200 bg-white rounded-t-2xl"
      >
        <div className="flex flex-col min-h-[min(50dvh,420px)] p-4 bg-white/85">
          <textarea
            value={currentRoundMemo.freeText}
            onChange={(e) => setMemoFreeText(e.target.value.slice(0, MEMO_MAX_LENGTH))}
            placeholder="기억하고 싶은 내용을 적어보세요."
            maxLength={MEMO_MAX_LENGTH}
            className="w-full flex-1 min-h-[160px] p-3 text-sm text-slate-800 resize-none focus:outline-none bg-transparent placeholder:text-slate-400"
          />
          <div className="flex items-center justify-between pt-4 shrink-0 border-t border-amber-200">
            <span className="text-xs text-slate-500">{currentRoundMemo.freeText.length}/{MEMO_MAX_LENGTH}자</span>
            <button type="button" onClick={addPin} className="px-3 py-2 text-xs font-bold text-amber-800 bg-amber-100 hover:bg-amber-200 rounded-lg transition-colors flex items-center gap-1.5">
              <Pin className="w-3.5 h-3.5" /> Q.{String(currentQIndex + 1).padStart(2, '0')} 추가
            </button>
          </div>
        </div>
      </MobileSheet>

      {/* 데스크탑 FAB - 메모 열기 (전체화면 우측 하단, 노란색) */}
      <div className={`hidden lg:flex fixed bottom-6 right-6 z-30 transition-transform duration-300 ease-in-out ${memoOpen ? 'scale-0' : 'scale-100'}`}>
        <button
          type="button"
          onClick={() => setMemoOpen(true)}
          className="w-14 h-14 rounded-full shadow-lg bg-amber-400 text-white flex items-center justify-center hover:bg-amber-500 active:scale-95 transition-all border border-amber-300"
          aria-label="메모 열기"
        >
          <StickyNote className="w-6 h-6" />
        </button>
      </div>

      {/* 이미지 확대 모달 */}
      {showImageEnlarged && (
        <div
          className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/70 p-4"
          onClick={() => setShowImageEnlarged(false)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Escape' && setShowImageEnlarged(false)}
          aria-label="닫기"
        >
          <div className="relative max-w-full max-h-full flex flex-col items-center justify-center" onClick={(e) => e.stopPropagation()}>
            <img src={enlargedImageSrc ?? ''} alt="문제 확대" className="max-w-full max-h-[90vh] w-auto h-auto object-contain" />
            <p className="mt-2 text-[10px] sm:text-[11px] text-white/70 text-center px-3 max-w-md leading-snug font-normal">
              {COPYRIGHT_COPY.quizFooterSingleLine}
            </p>
            <button type="button" onClick={() => setShowImageEnlarged(false)} className="mt-2 text-white hover:text-slate-200 text-sm font-medium">
              닫기
            </button>
          </div>
        </div>
      )}

      {/* 학습 중단 확인: 모바일=바텀 시트, 데스크톱=중앙 카드 */}
      {showExitConfirmModal && (
        <>
          <MobileSheet
            open={showExitConfirmModal}
            onClose={() => setShowExitConfirmModal(false)}
            title="시험 종료"
            description="학습 이력이 저장되지 않습니다."
            size="md"
          >
            <div className="p-4 pb-8">
              <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center text-slate-600 mx-auto mb-4">
                <AlertCircle size={22} />
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setShowExitConfirmModal(false)} className="flex-1 min-h-[48px] rounded-xl font-bold border-2 border-slate-200 text-slate-600 hover:bg-slate-50">
                  취소
                </button>
                <button type="button" onClick={handleExitConfirm} className="flex-1 min-h-[48px] rounded-xl font-bold bg-slate-900 text-white hover:bg-slate-800">
                  나가기
                </button>
              </div>
            </div>
          </MobileSheet>
          <div className="hidden lg:flex fixed inset-0 z-[9999] items-center justify-center p-5">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowExitConfirmModal(false)} aria-hidden="true" />
            <div className="bg-white w-full max-w-sm rounded-[2rem] p-8 relative z-10 animate-slide-up shadow-2xl text-center">
              <div className="w-14 h-14 bg-slate-100 rounded-full flex items-center justify-center text-slate-600 mx-auto mb-6">
                <AlertCircle size={24} />
              </div>
              <h3 className="text-xl font-black text-slate-900 mb-2">시험 종료</h3>
              <p className="text-slate-500 text-sm mb-8">학습 이력이 저장되지 않습니다.</p>
              <div className="flex gap-3">
                <button type="button" onClick={() => setShowExitConfirmModal(false)} className="flex-1 py-3 rounded-xl font-bold border-2 border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors">
                  취소
                </button>
                <button type="button" onClick={handleExitConfirm} className="flex-1 py-3 rounded-xl font-bold bg-slate-900 text-white hover:bg-slate-800 transition-colors">
                  나가기
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {showRapidSolveModal && (
        <>
          <div className="lg:hidden fixed inset-0 z-[10050] flex items-center justify-center p-4 sm:p-5">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" aria-hidden />
            <div
              className="relative z-10 w-full max-w-md rounded-2xl bg-white shadow-2xl border border-slate-100 px-5 py-6 sm:p-8 animate-scale-in max-h-[min(88dvh,100%)] overflow-y-auto text-center"
              role="dialog"
              aria-modal="true"
              aria-label={rapidSolveModalStep === 'ask' ? '학습 여부 확인' : '학습 반영 안내'}
            >
              <div className="w-12 h-12 rounded-full bg-[#99ccff]/50 flex items-center justify-center mx-auto mb-4">
                <Lightbulb className="w-6 h-6 text-[#1e56cd]" aria-hidden />
              </div>
              {rapidSolveModalStep === 'ask' ? (
                <>
                  <p className="text-slate-800 font-bold text-base text-center mb-1">
                    혹시 지금 문제를 풀고 있나요?
                  </p>
                  <p className="text-slate-500 text-xs text-center mb-5 leading-relaxed">
                    아주 빠르게 연속으로 넘어간 경우에만 가끔 여쭤봐요. 편하게 선택해 주세요.
                  </p>
                  <div className="flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={handleRapidSolveConfirmLearning}
                      className="w-full min-h-[48px] rounded-xl font-bold bg-[#1e56cd] text-white hover:bg-[#1644a8]"
                    >
                      네, 학습 중이에요
                    </button>
                    <button
                      type="button"
                      onClick={handleRapidSolveChooseBrowse}
                      className="w-full min-h-[48px] rounded-xl font-bold border-2 border-slate-200 text-slate-700 hover:bg-slate-50"
                    >
                      아니오, 기능을 둘러보고 있어요
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-slate-800 font-medium text-sm text-center mb-6 leading-relaxed">
                    기능을 살펴보고 계시군요. 현재 풀이는 학습 이해도에 반영되지 않습니다.
                  </p>
                  <button
                    type="button"
                    onClick={handleRapidSolveAckBrowse}
                    className="w-full min-h-[48px] rounded-xl font-bold bg-[#1e56cd] text-white hover:bg-[#1644a8]"
                  >
                    확인
                  </button>
                </>
              )}
            </div>
          </div>
          <div className="hidden lg:flex fixed inset-0 z-[10050] items-center justify-center p-5">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" aria-hidden />
            <div
              className="relative z-10 w-full max-w-md rounded-2xl bg-white shadow-2xl p-8 text-center"
              role="dialog"
              aria-modal="true"
              aria-label={rapidSolveModalStep === 'ask' ? '학습 여부 확인' : '학습 반영 안내'}
            >
              <div className="w-14 h-14 rounded-full bg-[#99ccff]/50 flex items-center justify-center mx-auto mb-6">
                <Lightbulb className="w-7 h-7 text-[#1e56cd]" aria-hidden />
              </div>
              {rapidSolveModalStep === 'ask' ? (
                <>
                  <h3 className="text-lg font-black text-slate-900 mb-2">
                    혹시 지금 문제를 풀고 있나요?
                  </h3>
                  <p className="text-slate-500 text-sm mb-8 leading-relaxed">
                    아주 빠르게 연속으로 넘어간 경우에만 가끔 여쭤봐요. 편하게 선택해 주세요.
                  </p>
                  <div className="flex flex-col gap-3">
                    <button
                      type="button"
                      onClick={handleRapidSolveConfirmLearning}
                      className="w-full min-h-[48px] rounded-xl font-bold bg-[#1e56cd] text-white hover:bg-[#1644a8]"
                    >
                      네, 학습 중이에요
                    </button>
                    <button
                      type="button"
                      onClick={handleRapidSolveChooseBrowse}
                      className="w-full min-h-[48px] rounded-xl font-bold border-2 border-slate-200 text-slate-700 hover:bg-slate-50"
                    >
                      아니오, 기능을 둘러보고 있어요
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-slate-800 font-medium text-sm mb-8 leading-relaxed">
                    기능을 살펴보고 계시군요. 현재 풀이는 학습 이해도에 반영되지 않습니다.
                  </p>
                  <button
                    type="button"
                    onClick={handleRapidSolveAckBrowse}
                    className="w-full min-h-[48px] rounded-xl font-bold bg-[#1e56cd] text-white hover:bg-[#1644a8]"
                  >
                    확인
                  </button>
                </>
              )}
            </div>
          </div>
        </>
      )}

      {/* 약점 다시풀기 종료: 모바일=바텀 시트 */}
      {showWeaknessRetryEndModal && (
        <>
          <MobileSheet
            open={showWeaknessRetryEndModal}
            onClose={() => setShowWeaknessRetryEndModal(false)}
            title="마지막 문제입니다"
            description="다시 풀거나 종료할 수 있어요."
            size="md"
          >
            <div className="p-4 pb-8 flex flex-col gap-2">
              <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center text-green-600 mx-auto mb-2">
                <CheckCircle size={24} />
              </div>
              <button
                type="button"
                onClick={() => {
                  setCurrentQIndex(0);
                  setSessionHistory([]);
                  setSelectedOption(null);
                  setIsSubmitted(false);
                  setShowWeaknessRetryEndModal(false);
                }}
                className="w-full min-h-[48px] rounded-xl font-bold border-2 border-slate-200 text-slate-600 hover:bg-slate-50 flex items-center justify-center gap-1.5"
              >
                <RotateCcw size={18} /> 다시 풀기
              </button>
              <button
                type="button"
                onClick={() => { setShowWeaknessRetryEndModal(false); onExit(); }}
                className="w-full min-h-[48px] rounded-xl font-bold bg-slate-900 text-white hover:bg-slate-800 flex items-center justify-center gap-1.5"
              >
                <X size={18} /> 종료하기
              </button>
            </div>
          </MobileSheet>
          <div className="hidden lg:flex fixed inset-0 z-[9999] items-center justify-center p-5">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
            <div className="bg-white w-full max-w-sm rounded-[2rem] p-8 relative z-10 animate-slide-up shadow-2xl text-center">
              <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center text-green-600 mx-auto mb-6">
                <CheckCircle size={28} />
              </div>
              <h3 className="text-xl font-black text-slate-900 mb-2">마지막 문제입니다</h3>
              <p className="text-slate-500 text-sm mb-8">다시 풀거나 종료할 수 있어요.</p>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setCurrentQIndex(0);
                    setSessionHistory([]);
                    setSelectedOption(null);
                    setIsSubmitted(false);
                    setShowWeaknessRetryEndModal(false);
                  }}
                  className="flex-1 py-3 rounded-xl font-bold border-2 border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors flex items-center justify-center gap-1.5"
                >
                  <RotateCcw size={18} /> 다시 풀기
                </button>
                <button
                  type="button"
                  onClick={() => { setShowWeaknessRetryEndModal(false); onExit(); }}
                  className="flex-1 py-3 rounded-xl font-bold bg-slate-900 text-white hover:bg-slate-800 transition-colors flex items-center justify-center gap-1.5"
                >
                  <X size={18} /> 종료하기
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* 문제 신고: 모바일=전면 모달, 데스크톱=중앙 카드 */}
      {reportModalOpen && currentQ && (
        <>
          <MobileFullScreenModal
            open={reportModalOpen}
            onClose={closeReportModal}
            title="문제 오류 신고"
            footer={
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={closeReportModal}
                  disabled={reportSending}
                  className="min-h-[44px] px-4 rounded-xl border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={() => void handleReportSubmit()}
                  disabled={reportSending || reportType === null || !user}
                  className="min-h-[44px] px-4 rounded-xl bg-[#0034d3] text-white text-sm font-medium hover:bg-[#002a9e] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {reportSending ? '전송 중...' : '전송'}
                </button>
              </div>
            }
          >
            <div className="p-4 space-y-4">
              <p className="text-sm text-slate-600">문제에 오류가 있다면 유형을 선택해 주세요.</p>
              {!user && (
                <p className="text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-sm">
                  신고는 로그인 후 이용할 수 있습니다.
                </p>
              )}
              <div className="space-y-2">
                {[
                  { type: 'wrong_answer' as const, label: '정답이 틀렸어요' },
                  { type: 'typo_or_error' as const, label: '오타나 지문 오류가 있어요' },
                  { type: 'out_of_scope' as const, label: '출제 범위를 벗어났어요' },
                ].map(({ type, label }) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setReportType(type)}
                    className={`w-full min-h-[48px] text-left px-4 py-3 rounded-xl border text-sm font-medium transition-colors ${
                      reportType === type ? 'border-[#0034d3] bg-[#0034d3]/10 text-[#0034d3]' : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                    disabled={reportSending}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </MobileFullScreenModal>
          <div className="hidden lg:flex fixed inset-0 z-[9999] items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/50" onClick={closeReportModal} aria-hidden="true" />
            <div className="relative z-10 bg-white rounded-2xl shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-lg font-bold text-slate-900 mb-3">문제에 오류가 있다면 알려주세요</h3>
              {!user && (
                <p className="text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-sm mb-4">
                  신고는 로그인 후 이용할 수 있습니다.
                </p>
              )}
              <div className="space-y-2 mb-4">
                {[
                  { type: 'wrong_answer' as const, label: '정답이 틀렸어요' },
                  { type: 'typo_or_error' as const, label: '오타나 지문 오류가 있어요' },
                  { type: 'out_of_scope' as const, label: '출제 범위를 벗어났어요' },
                ].map(({ type, label }) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setReportType(type)}
                    className={`w-full text-left px-4 py-3 rounded-xl border text-sm font-medium transition-colors ${
                      reportType === type ? 'border-[#0034d3] bg-[#0034d3]/10 text-[#0034d3]' : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                    disabled={reportSending}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={closeReportModal} disabled={reportSending} className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 disabled:opacity-50">
                  취소
                </button>
                <button
                  type="button"
                  onClick={() => void handleReportSubmit()}
                  disabled={reportSending || reportType === null || !user}
                  className="px-4 py-2 rounded-xl bg-[#0034d3] text-white text-sm font-medium hover:bg-[#002a9e] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {reportSending ? '전송 중...' : '전송'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      <FlashToast
        message={reportToast?.message ?? copyrightFlash}
        onDismiss={() => {
          if (reportToast) dismissReportToast();
          else dismissCopyrightFlash();
        }}
        variant={reportToast?.variant ?? 'neutral'}
        duration={reportToast ? 2800 : 4200}
      />

    </div>
  );
};
