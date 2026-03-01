import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Question, User } from '../types';
import {
  getQuestionsForRound,
  checkExamAccess,
} from '../services/examService';
import { EXAM_ROUNDS, CERTIFICATIONS, QUIZ_THEME, SUBJECT_NAMES_BY_CERT } from '../constants';
import { getCertificationInfo } from '../services/gradingService';
import type { CertificationInfo } from '../types';
import { saveGuestQuizProgress, loadGuestQuizProgress } from '../utils/guestQuizStorage';
import { CheckCircle, XCircle, AlertTriangle, StickyNote, ChevronLeft, ChevronRight, ChevronDown, Crown, Lightbulb, AlertCircle, Search, RotateCcw, X, Pin, Menu, LogOut } from 'lucide-react';
import { WRONG_FEEDBACK_PLACEHOLDER } from '../services/examService';
import { RichText } from '../components/RichText';
import { to1BasedAnswer } from '../utils/questionUtils';
import { ErrorView } from '../components/ErrorView';
import { getErrorCode } from '../utils/errorCodes';
import { isPremiumUnlocked } from '../utils/dateUtils';

/** 비회원 Round 1: 20문제에서 멈추고 로그인 유도 */
const GUEST_QUESTION_LIMIT = 20;

/** 메모 입력 최대 글자 수 (회차당, 문제번호 포함) */
const MEMO_MAX_LENGTH = 500;

export interface QuizAnswerRecord {
  qid: string;
  selected: number;
  isCorrect: boolean;
  isConfused: boolean;
  /** 해당 문항 풀이에 걸린 시간(초). 스탯 업데이트 시 estimated_time의 절반 미만이면 찍은 것으로 간주 */
  elapsedSec?: number;
}

/** 회차별 메모 (핀으로 찍은 문제 + 자유 메모) - 오답 화면에서도 노출 */
export interface RoundMemo {
  freeText: string;
  pins: { qNumber: number; text: string }[];
}

interface QuizProps {
  roundId: string;
  certId: string;
  user: User | null;
  mode?: 'exam' | 'study';
  preFetchedQuestions?: Question[] | null;
  startIndex?: number;
  onFinish: (score: number, total: number, sessionHistory?: QuizAnswerRecord[], questions?: Question[], roundMemo?: RoundMemo) => void;
  onExit: () => void;
  onWeaknessRetrySave?: (score: number, total: number, sessionHistory: QuizAnswerRecord[], questions: Question[]) => void;
  onGuestLimitReached?: (params: { certId: string; roundId: string }) => void;
  onRequestCheckout?: () => void;
  onUpdateUser?: (updater: (prev: User) => User) => void;
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
  const [showImageEnlarged, setShowImageEnlarged] = useState(false);
  const [enlargedImageSrc, setEnlargedImageSrc] = useState<string | null>(null);
  const [imageLoadError, setImageLoadError] = useState(false);
  const questionBodyRef = useRef<HTMLDivElement>(null);
  const questionStartTimeRef = useRef<number>(Date.now());

  const roundInfo = EXAM_ROUNDS.find((r) => r.id === roundId);
  const round = roundInfo?.round ?? 1;
  const isWeaknessRound = round >= 6;
  const weaknessRetryMode = roundId === '__weakness_retry__' || roundId === '__subject_retry__';
  const isPremium = !!(user && certId && isPremiumUnlocked(user, certId));

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
          : (roundInfo?.title ?? '연습 모의고사');

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
        if (!weaknessRetryMode) {
          const access = checkExamAccess({
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
          qs = await getQuestionsForWeaknessRound(certId, user);
        } else {
          qs = await getQuestionsForRound(certId, round, user);
        }

        if (!cancelled) {
          setQuestions(qs);
          if (qs.length === 0) {
            setError('문제를 불러올 수 없습니다.');
            setErrorRaw(null);
          }
          if (qs.length > 0 && roundInfo && round === 1) {
            if (user && startIndex != null && startIndex > 0) {
              const saved = loadGuestQuizProgress();
              if (saved?.certId === certId && saved?.roundId === roundId && saved.answers?.length >= startIndex) {
                setSessionHistory(saved.answers.slice(0, startIndex));
                setCurrentQIndex(startIndex);
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
            markWeaknessTrialUsed(user.id, certId).then(() => {
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
  }, [certId, roundId, round, isWeaknessRound, user, onUpdateUser, preFetchedQuestions, startIndex]);

  useEffect(() => {
    if (questions.length === 0 || !user || startIndex == null || startIndex <= 0 || round !== 1) return;
    const saved = loadGuestQuizProgress();
    if (saved?.certId === certId && saved?.roundId === roundId && saved.answers?.length >= startIndex) {
      setSessionHistory(saved.answers.slice(0, startIndex));
      setCurrentQIndex(startIndex);
    }
  }, [questions.length, user, startIndex, certId, roundId, round]);

  useEffect(() => {
    if (mode === 'study' && isSubmitted && explanationBoxRef.current) {
      const t = setTimeout(() => {
        explanationBoxRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
      return () => clearTimeout(t);
    }
  }, [mode, isSubmitted, currentQIndex]);

  const currentQ = questions[currentQIndex];
  const isViewingPast = mode === 'study' && currentQIndex < sessionHistory.length;
  const effectiveSelected = isViewingPast && sessionHistory[currentQIndex] ? sessionHistory[currentQIndex].selected : selectedOption;
  const effectiveSubmitted = isViewingPast || isSubmitted;

  const handleSubmit = useCallback(() => {
    if (selectedOption === null || !currentQ) return;
    setIsSubmitted(true);
  }, [selectedOption, currentQ]);

  const handleNext = useCallback((overrideSelected?: number) => {
    if (!currentQ) return;
    const chosen = overrideSelected !== undefined ? overrideSelected : selectedOption;
    if (chosen === null && overrideSelected === undefined) return;
    const answer1Based = to1BasedAnswer(currentQ.answer, currentQ.options.length);
    const isCorrect = chosen === answer1Based;
    const elapsedSec = Math.round((Date.now() - questionStartTimeRef.current) / 1000);
    const nextHistory = [
      ...sessionHistory,
      { qid: currentQ.id, selected: chosen ?? 0, isCorrect, isConfused, elapsedSec },
    ];
    setSessionHistory(nextHistory);

    if (!user && round === 1 && currentQIndex === GUEST_QUESTION_LIMIT - 1 && onGuestLimitReached) {
      saveGuestQuizProgress({
        certId,
        roundId,
        round: 1,
        startedAt: new Date().toISOString(),
        answers: nextHistory,
        currentIndex: GUEST_QUESTION_LIMIT,
      });
      onGuestLimitReached({ certId, roundId });
      return;
    }

    if (!user && roundInfo) {
      saveGuestQuizProgress({
        certId,
        roundId,
        round: roundInfo.round,
        startedAt: new Date().toISOString(),
        answers: nextHistory,
        currentIndex: currentQIndex + 1,
      });
    }

    if (currentQIndex < questions.length - 1) {
      setCurrentQIndex((prev) => prev + 1);
      setSelectedOption(null);
      setIsSubmitted(false);
      setIsConfused(false);
    } else {
      const finalCorrect = isCorrect
        ? sessionHistory.filter((a) => a.isCorrect).length + 1
        : sessionHistory.filter((a) => a.isCorrect).length;
      const finalElapsed = Math.round((Date.now() - questionStartTimeRef.current) / 1000);
      const finalHistory = [...sessionHistory, { qid: currentQ.id, selected: chosen ?? 0, isCorrect, isConfused, elapsedSec: finalElapsed }];
      if (weaknessRetryMode) {
        onWeaknessRetrySave?.(finalCorrect, questions.length, finalHistory, questions);
        setShowWeaknessRetryEndModal(true);
      } else {
        const currentRoundMemo = roundMemos[roundId] ?? { freeText: '', pins: [] };
        onFinish(finalCorrect, questions.length, finalHistory, questions, currentRoundMemo);
      }
    }
  }, [currentQ, selectedOption, currentQIndex, questions.length, sessionHistory, isConfused, onFinish, onWeaknessRetrySave, user, certId, roundId, roundInfo, round, onGuestLimitReached, weaknessRetryMode, roundMemos]);

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

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#edf1f5]">
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
  const certCode = CERTIFICATIONS.find((c) => c.id === certId)?.code ?? '';
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
    <div className="flex h-screen bg-[#edf1f5] text-slate-800 font-sans overflow-hidden">
      {/* 모바일 LNB 백드롭 (클릭 시 닫힘) */}
      <div
        className={`lg:hidden fixed inset-0 z-40 bg-black/40 transition-opacity duration-300 ${lnbOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={() => setLnbOpen(false)}
        aria-hidden="true"
      />

      

      <main className="flex-1 min-w-0 flex flex-col h-full overflow-hidden relative">
        {/* 모바일 상단 헤더 (LNB 토글 + 나가기) */}
        <div className="lg:hidden h-14 bg-white border-b border-slate-200 flex items-center justify-between px-4 shrink-0 shadow-sm z-10">
          <div className="flex items-center min-w-0">
            <button type="button" onClick={() => setLnbOpen(true)} className="p-2 -ml-2 text-slate-600 hover:text-slate-900 shrink-0" aria-label="문항 목록 열기">
              <Menu size={24} />
            </button>
            <span className="ml-2 font-bold text-slate-800 truncate">{quizPageTitle}</span>
          </div>
          <button type="button" onClick={confirmExit} className="p-2 text-slate-600 hover:text-slate-900 shrink-0" aria-label="시험 종료">
            <LogOut className="w-5 h-5 rotate-180" />
          </button>
        </div>

        <div className="flex-1 min-h-0 flex flex-col p-4 md:p-6 lg:p-8 overflow-hidden">
          <div className="flex flex-1 min-h-0 w-full max-w-[90rem] relative">
            {/* 1. 문제 카드: 상단 고정 높이 + 하단 보기 고정 */}
            <div className="flex-1 min-h-0 bg-white rounded-3xl shadow-sm border border-slate-200 flex flex-col overflow-hidden relative min-w-0 z-10">
              <header className={`relative border-b border-gray-100 px-6 md:px-8 py-4 flex items-center justify-center shrink-0 ${mode === 'exam' ? 'bg-blue-50/30' : 'bg-[#99ccff]/50'}`}>
                <div className="absolute left-6 md:left-8 top-1/2 -translate-y-1/2 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={confirmExit}
                    className="hidden lg:flex items-center justify-center w-9 h-9 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors"
                    aria-label="시험 종료"
                  >
                    <LogOut className="w-5 h-5 rotate-180" />
                  </button>
                  <span className={`${theme.tag} text-sm px-3 py-1 rounded-full font-bold shadow-sm`}>
                    Q.{String(currentQIndex + 1).padStart(2, '0')}
                  </span>
                </div>
                <div className="flex flex-col items-center text-center">
                  <span className={`text-xs md:text-sm font-semibold ${mode === 'exam' ? 'text-blue-600' : 'text-[#0034d3]'}`}>
                    {quizPageTitle} | {modeLabel}
                  </span>
                  <span className="text-sm md:text-base font-bold text-slate-800 mt-0.5">{subjectLabel}</span>
                </div>
                <div className="absolute right-6 md:right-8 top-1/2 -translate-y-1/2">
                  <span className={`text-xs md:text-sm font-semibold px-3 py-1 rounded-full ${mode === 'exam' ? 'bg-blue-100 text-blue-700' : 'bg-[#99ccff] text-[#0034d3]'}`}>
                    {currentQIndex + 1}/{questions.length}
                  </span>
                </div>
              </header>

              <div className="h-1 bg-gray-100 w-full shrink-0">
                <div className={`h-full transition-all duration-300 ease-out ${mode === 'exam' ? 'bg-blue-600' : 'bg-[#0034d3]'}`} style={{ width: `${progress}%` }} />
              </div>

              <div className="flex-1 min-h-0 flex flex-col">
                {/* 좌측: 문제(고정높이) + 보기(하단고정) | 우측: 해설 */}
                <div className={`flex-1 min-h-0 p-6 md:p-8 flex flex-col ${mode === 'study' ? 'xl:flex-row xl:gap-8 xl:items-stretch' : ''}`}>
                  {/* 좌측: 지문(영역 내 스크롤) + 보기(영역 내 스크롤) + 버튼 고정. 전체 높이 고정으로 문제 영역 크기 유지 */}
                  <div className={`min-w-0 flex-1 min-h-0 flex flex-col ${mode === 'study' ? 'xl:flex-[7]' : ''} ${mode === 'exam' ? 'max-w-4xl mx-auto w-full' : ''}`}>
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
                    {/* 지문+테이블+이미지: 고정 높이, 초과 시 영역 내에서만 스크롤 */}
                    <div
                      ref={questionBodyRef}
                      className={
                        'shrink-0 h-[40vh] overflow-y-auto overflow-x-auto pr-2 ' +
                        'text-base text-gray-800 leading-relaxed break-keep w-full ' +
                        '[&_table]:w-full [&_table]:min-w-[400px] [&_table]:border-collapse [&_table]:my-4 [&_table]:text-sm ' +
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
                          <div className="relative max-w-md w-full rounded-xl overflow-hidden border border-slate-200 bg-slate-50 min-h-[180px]">
                            {imageLoadError ? (
                              <img src="/sample-question-image.png" alt="문제" className="w-full h-auto object-contain max-h-80 min-h-[180px]" />
                            ) : (
                              <img
                                src={currentQ.imageUrl}
                                alt="문제"
                                className="w-full h-auto object-contain max-h-80 min-h-[180px]"
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
                    {/* 보기 영역: 남는 높이만 사용, 길면 영역 내 스크롤 */}
                    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                    <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto">
                    <div className="bg-slate-50/50 rounded-2xl p-5 border border-slate-100">
                      <div className="space-y-2.5">
                        {currentQ.options.map((opt, idx) => {
                          const optNum = idx + 1;
                          const isSelected = effectiveSelected === optNum;
                          const isCorrectOpt = optNum === answerNum;
                          const isWrongSelected = effectiveSubmitted && isSelected && !isCorrectOpt;
                          let btnClass = 'w-full min-h-[52px] px-4 py-3 rounded-xl text-left flex items-center gap-3 transition-all select-none border bg-white ';
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
                      <label className="mt-4 flex items-center justify-end gap-2 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={isViewingPast ? (sessionHistory[currentQIndex]?.isConfused ?? false) : isConfused}
                          onChange={(e) => {
                            if (isViewingPast) {
                              setSessionHistory((prev) => {
                                const next = [...prev];
                                const rec = next[currentQIndex];
                                if (!rec) return prev;
                                next[currentQIndex] = { ...rec, isConfused: !rec.isConfused };
                                return next;
                              });
                            } else setIsConfused(e.target.checked);
                          }}
                          className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="text-sm text-slate-500 font-medium">헷갈려요</span>
                      </label>
                    </div>
                    </div>
                    {/* 버튼 영역: 고정 */}
                    <div className="w-full shrink-0 pt-4">
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
                  {/* 우측: 정답·해설 영역 (학습 모드, 7:3 비율 중 3). 길면 영역 내 스크롤 */}
                  {mode === 'study' && (
                    <div ref={explanationBoxRef} className="xl:flex-[3] xl:shrink-0 flex flex-col xl:min-h-0 min-h-0">
                      <div className="bg-blue-50/50 border border-blue-100 rounded-2xl p-5 shadow-sm overflow-y-auto overflow-x-auto flex-1 min-h-0 flex flex-col">
                        {effectiveSubmitted ? (
                          <div className="animate-slide-up">
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
                                {effectiveSelected !== null && effectiveSelected === answerNum && currentQ.wrongFeedback?.[String(effectiveSelected)] ? (
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
                            {effectiveSelected !== null && effectiveSelected !== answerNum && (
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
                        ) : (
                          /* 풀이 중: 해설 숨김, 전구 아이콘만 표시 */
                          <div className="flex-1 flex items-start justify-center pt-8">
                            <Lightbulb className="w-12 h-12 text-blue-200" aria-hidden />
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

          </div>
        </div>
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

      {/* 모바일 메모 바텀시트 백드롭 (클릭 시 닫힘) */}
      <div
        className={`lg:hidden fixed inset-0 z-40 transition-opacity duration-300 bg-black/40 ${memoOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
        onClick={() => setMemoOpen(false)}
        aria-hidden="true"
      />

      {/* 모바일 FAB - 메모 열기 (좌측 하단, 노란색) */}
      <div className={`lg:hidden fixed bottom-6 left-6 z-30 transition-transform duration-300 ease-in-out ${memoOpen ? 'scale-0' : 'scale-100'}`}>
        <button
          type="button"
          onClick={() => setMemoOpen(true)}
          className="w-14 h-14 rounded-full shadow-lg bg-amber-400 text-white flex items-center justify-center hover:bg-amber-500 active:scale-95 transition-all border border-amber-300"
          aria-label="메모 열기"
        >
          <StickyNote className="w-6 h-6" />
        </button>
      </div>

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

      {/* 모바일 메모 바텀 시트 (노란색+흰색) */}
      <div
        className={`lg:hidden fixed inset-x-0 bottom-0 z-50 flex flex-col h-[50vh] bg-yellow-100 rounded-t-[2rem] shadow-[0_-10px_40px_rgba(0,0,0,0.1)] transition-transform duration-300 ease-in-out border-t border-amber-200 ${memoOpen ? 'translate-y-0' : 'translate-y-full'}`}
      >
        <div
          className="flex items-center justify-between px-6 py-4 cursor-pointer shrink-0 border-b border-amber-200 rounded-t-[2rem] bg-white"
          onClick={() => setMemoOpen(false)}
          onKeyDown={(e) => e.key === 'Enter' && setMemoOpen(false)}
          role="button"
          tabIndex={0}
          aria-label="메모 닫기"
        >
          <span className="text-[15px] font-bold text-slate-900 flex items-center gap-2">
            <StickyNote className="w-5 h-5 text-amber-600" /> 메모
          </span>
          <ChevronDown className="w-5 h-5 text-slate-600" />
        </div>
        <div className="flex-1 min-h-0 flex flex-col p-5 bg-white/80">
          <textarea
            value={currentRoundMemo.freeText}
            onChange={(e) => setMemoFreeText(e.target.value.slice(0, MEMO_MAX_LENGTH))}
            placeholder="기억하고 싶은 내용을 적어보세요."
            maxLength={MEMO_MAX_LENGTH}
            className="w-full flex-1 p-2 text-sm text-slate-800 resize-none focus:outline-none bg-transparent placeholder:text-slate-400"
          />
          <div className="flex items-center justify-between pt-4 shrink-0 border-t border-amber-200">
            <span className="text-xs text-slate-500">{currentRoundMemo.freeText.length}/{MEMO_MAX_LENGTH}자</span>
            <button type="button" onClick={addPin} className="px-3 py-2 text-xs font-bold text-amber-800 bg-amber-100 hover:bg-amber-200 rounded-lg transition-colors flex items-center gap-1.5">
              <Pin className="w-3.5 h-3.5" /> Q.{String(currentQIndex + 1).padStart(2, '0')} 추가
            </button>
          </div>
        </div>
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
          <div className="relative max-w-full max-h-full flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
            <img src={enlargedImageSrc ?? ''} alt="문제 확대" className="max-w-full max-h-[90vh] w-auto h-auto object-contain" />
            <button type="button" onClick={() => setShowImageEnlarged(false)} className="absolute -top-10 right-0 text-white hover:text-slate-200 text-sm font-medium">
              닫기
            </button>
          </div>
        </div>
      )}

      {/* 학습 중단 확인 모달 */}
      {showExitConfirmModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-5">
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
      )}

      {/* 약점 다시풀기 종료 모달 */}
      {showWeaknessRetryEndModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-5">
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
      )}

    </div>
  );
};
