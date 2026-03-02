import React, { useState, useEffect } from 'react';
import { Lock, ClipboardCheck, BookOpen, X, Info, Monitor, Check } from 'lucide-react';
import { DashboardSidebar } from './components/DashboardSidebar';
import { useIsMobile } from './hooks/use-mobile';
import { EmptyState } from './components/dashboard/empty-state';
import { LoginModal } from './components/LoginModal';
import { MyPage } from './pages/MyPage';
import { ExamList } from './pages/ExamList';
import { Quiz } from './pages/Quiz';
import { Result } from './pages/Result';
import { Admin } from './pages/Admin';
import { AdminCerts } from './pages/AdminCerts';
import { AdminQuestions } from './pages/AdminQuestions';
import { Checkout } from './pages/Checkout';
import { AccountSettings } from './pages/AccountSettings';
import { User } from './types';
import { CERTIFICATIONS, CERT_IDS_WITH_QUESTIONS, EXAM_ROUNDS, getRoundLabel } from './constants';
import { useAuth } from './contexts/AuthContext';
import { submitQuizResult } from './services/gradingService';
import { invalidateMyPageCache, syncQuestionIndex } from './services/db/localCacheDB';
import { clearGuestQuizProgress } from './utils/guestQuizStorage';
import { ensureUserSubscription, setPaymentComplete, getStoredGoogleRedirectIntent, clearStoredGoogleRedirectIntent } from './services/authService';
import { getQuestionsForRound, fetchSubjectStrengthTraining50, fetchWeakTypeFocus50, fetchWeakConceptFocus50, fetchQuestionsFromPools } from './services/examService';
import { logClientError } from './services/errorLogService';
import { doc, getDoc } from 'firebase/firestore';
import { db } from './firebase';

type Route = '/' | '/mypage' | '/account-settings' | '/exam-list' | '/quiz' | '/result' | '/admin' | '/admin/certs' | '/admin/questions' | '/admin/billing';
type LoginModalIntent = import('./components/LoginModal').LoginModalIntent;

const App: React.FC = () => {
  const isMobile = useIsMobile();
  const { user, loading: authLoading, login, logout, updateUser, resendVerificationEmail, refreshUser } = useAuth();
  const [route, setRoute] = useState<Route>('/');
  const [selectedCertId, setSelectedCertId] = useState<string | null>(null);
  const [selectedRoundId, setSelectedRoundId] = useState<string | null>(null);
  const [quizMode, setQuizMode] = useState<'exam' | 'study'>('study');
  const [preFetchedQuestions, setPreFetchedQuestions] = useState<import('./types').Question[] | null>(null);
  const [quizResult, setQuizResult] = useState<{
    score: number;
    total: number;
    sessionHistory?: import('./pages/Result').QuizAnswerRecord[];
    questions?: import('./types').Question[];
    roundMemo?: import('./pages/Quiz').RoundMemo;
  } | null>(null);
  
  // State for new flow
  const [pendingGuestResult, setPendingGuestResult] = useState<{score: number, total: number, certId: string, dateId: string} | null>(null);
  const [showCouponEffect, setShowCouponEffect] = useState(false);
  /** 게스트 20번까지 풀고 로그인한 경우: 로그인 후 팝업 띄우고 21번부터 이어가기 */
  const [pendingGuestContinue, setPendingGuestContinue] = useState<{ certId: string; roundId: string } | null>(null);
  /** 게스트 1~20번 세션+문제 (인증 후 이어하기 시 점수/과목 반영용, 제출 후 삭제) */
  const [pendingGuestSession, setPendingGuestSession] = useState<{
    certId: string;
    roundId: string;
    sessionHistory: import('./pages/Quiz').QuizAnswerRecord[];
    questions: import('./types').Question[];
  } | null>(null);
  const [quizStartIndex, setQuizStartIndex] = useState<number | undefined>(undefined);
  const [showGuestContinueModal, setShowGuestContinueModal] = useState(false);
  /** 퀴즈 1~20에서 로그인 버튼으로 로그인한 경우: 성공 팝업만 띄우고 현재 문제 유지 */
  const [showQuizLoginSuccessModal, setShowQuizLoginSuccessModal] = useState(false);
  const [showSignupSuccessModal, setShowSignupSuccessModal] = useState(false);
  /** 퀴즈에서 오답 플레이스홀더 클릭 시 게스트 → 로그인 후 결제로 보내기 */
  const [pendingCheckoutCertId, setPendingCheckoutCertId] = useState<string | null>(null);
  /** 결제 화면: 페이지 대신 대형 모달로 표시 (문제 풀이 중 이탈 없이 결제 가능) */
  const [showCheckoutModal, setShowCheckoutModal] = useState(false);
  /** 결제 완료 후 서비스 디자인 맞춤 성공 모달 */
  const [showPaymentSuccessModal, setShowPaymentSuccessModal] = useState(false);
  const [paymentSuccessError, setPaymentSuccessError] = useState<string | null>(null);
  /** 로그인 모달 (전역): 페이지 이동 없이 블러 위에 모달 */
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [loginModalIntent, setLoginModalIntent] = useState<LoginModalIntent | null>(null);
  /** 로그인 모달 진입 시 처음 보여줄 탭 */
  const [loginInitialMode, setLoginInitialMode] = useState<'login' | 'signup' | null>(null);
  /** 미인증 사용자: 인증 메일 재발송 모달 */
  const [showResendVerificationModal, setShowResendVerificationModal] = useState(false);
  const [resendPassword, setResendPassword] = useState('');
  const [resendLoading, setResendLoading] = useState(false);
  const [resendError, setResendError] = useState<string | null>(null);
  /** 결과 화면에서 무료 회원 "다시 풀기" → AI/시험 모드 선택 모달 */
  const [showRetryModeModal, setShowRetryModeModal] = useState(false);
  /** 결과 화면에서 무료 회원 "다음 회차" → 결제 필요 팝업 후 결제 화면 */
  const [showNextRoundPaymentModal, setShowNextRoundPaymentModal] = useState(false);
  /** 결과 화면 "다음 회차" → 모드 선택 모달 (현재 화면) → 5초 생성 효과 → 퀴즈 직행 */
  const [showNextRoundModeModal, setShowNextRoundModeModal] = useState(false);
  const [nextRoundInfo, setNextRoundInfo] = useState<{ id: string; round: number; type: string } | null>(null);
  const [showNextRoundPreparing, setShowNextRoundPreparing] = useState(false);
  const [nextRoundPreparingCountdown, setNextRoundPreparingCountdown] = useState(5);
  const [nextRoundPreparingPhase, setNextRoundPreparingPhase] = useState<'countdown' | 'ready'>('countdown');
  const [nextRoundSelectedMode, setNextRoundSelectedMode] = useState<'exam' | 'study'>('exam');
  const [nextRoundFetchedQuestions, setNextRoundFetchedQuestions] = useState<import('./types').Question[] | null>(null);
  /** 로그아웃 완료 후 "로그아웃되었습니다" 토스트 */
  const [showLogoutToast, setShowLogoutToast] = useState(false);
  /** 로그인 성공 시 "로그인되었습니다" 토스트 (하단 작게) */
  const [showLoginToast, setShowLoginToast] = useState(false);
  /** 가입 후 이메일 인증 대기: 백그라운드 상단 노란 배너 + 인증완료 버튼으로 로그인 적용 */
  const [pendingVerificationBanner, setPendingVerificationBanner] = useState<{ email: string; password: string } | null>(null);
  const [verificationBannerError, setVerificationBannerError] = useState('');
  const [verificationBannerLoading, setVerificationBannerLoading] = useState(false);
  const [verificationBannerResendLoading, setVerificationBannerResendLoading] = useState(false);
  /** 마이페이지 집중학습(과목/유형/개념) 클릭 시 모드 선택 모달 → 선택 후 5초 오버레이 → 퀴즈 */
  const [pendingFocusTraining, setPendingFocusTraining] = useState<{
    type: 'subject_strength' | 'weak_type' | 'weak_concept';
    certId: string;
  } | null>(null);

  /** 결과 화면 "다음 회차" 모드 선택 후 5초 준비 → 퀴즈 직행 */
  useEffect(() => {
    if (!showNextRoundPreparing || !nextRoundInfo || !user || !selectedCertId) return;
    if (nextRoundPreparingPhase === 'countdown') {
      if (nextRoundPreparingCountdown <= 0) {
        setNextRoundPreparingPhase('ready');
        return;
      }
      const t = setInterval(() => setNextRoundPreparingCountdown((c) => (c <= 0 ? 0 : c - 1)), 1000);
      return () => clearInterval(t);
    }
    if (nextRoundPreparingPhase === 'ready') {
      const t = setTimeout(() => {
        const info = nextRoundInfo;
        const mode = nextRoundSelectedMode;
        const questions = nextRoundFetchedQuestions;
        setShowNextRoundPreparing(false);
        setNextRoundInfo(null);
        setNextRoundPreparingPhase('countdown');
        setNextRoundPreparingCountdown(5);
        setNextRoundFetchedQuestions(null);
        if (!info) return;
        if (info.round >= 4) {
          if (questions && questions.length > 0) {
            handleSelectAiRound(info.id, questions, mode);
          } else {
            navigate('/exam-list');
          }
        } else {
          handleSelectRound(info.id, mode);
        }
      }, 1800);
      return () => clearTimeout(t);
    }
  }, [showNextRoundPreparing, nextRoundInfo, nextRoundPreparingPhase, nextRoundPreparingCountdown, nextRoundSelectedMode, nextRoundFetchedQuestions, selectedCertId, user]);

  /** 맞춤형(round >= 4)일 때 5초 동안 문제 생성 요청 */
  useEffect(() => {
    if (!showNextRoundPreparing || !nextRoundInfo || nextRoundInfo.round < 4 || !user || !selectedCertId) return;
    let cancelled = false;
    getQuestionsForRound(selectedCertId, nextRoundInfo.round, user)
      .then((q) => { if (!cancelled) setNextRoundFetchedQuestions(q); })
      .catch(() => { if (!cancelled) setNextRoundFetchedQuestions([]); });
    return () => { cancelled = true; };
  }, [showNextRoundPreparing, nextRoundInfo?.id, nextRoundInfo?.round, user, selectedCertId]);

  // 앱 기동 시 index.json 로컬/서버 버전 비교 후 새 버전일 때만 다운로드 (BIGDATA)
  useEffect(() => {
    syncQuestionIndex('BIGDATA').catch(() => {});
  }, []);

  // 전역 오류 → Firestore error_logs 기록 (대시보드 오류 로그에서 확인)
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      logClientError(event.error ?? event.message, 'window.onerror');
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      logClientError(event.reason, 'unhandledrejection');
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  // 시험 결과 화면을 볼 때 마이페이지 캐시 무효화 → 이후 마이페이지 진입 시 최신 데이터 로드
  useEffect(() => {
    if (route !== '/result' || !user?.id || !selectedCertId) return;
    const certCode = CERTIFICATIONS.find((c) => c.id === selectedCertId)?.code;
    if (certCode) invalidateMyPageCache(user.id, certCode).catch(() => {});
  }, [route, user?.id, selectedCertId]);

  // 로그아웃 토스트 자동 숨김
  useEffect(() => {
    if (!showLogoutToast) return;
    const t = setTimeout(() => setShowLogoutToast(false), 2500);
    return () => clearTimeout(t);
  }, [showLogoutToast]);

  // 로그인 토스트 자동 숨김
  useEffect(() => {
    if (!showLoginToast) return;
    const t = setTimeout(() => setShowLoginToast(false), 2500);
    return () => clearTimeout(t);
  }, [showLoginToast]);

  // /exam-list 진입 시 selectedCertId가 비어 있으면 첫 자격증으로 설정 (흰 화면 방지)
  useEffect(() => {
    if (route !== '/exam-list' || selectedCertId) return;
    const fallback = user?.subscriptions?.[0]?.id ?? user?.paidCertIds?.[0] ?? CERTIFICATIONS[0]?.id;
    if (fallback) setSelectedCertId(fallback);
  }, [route, selectedCertId, user?.subscriptions, user?.paidCertIds]);

  // /quiz 진입 시 round/cert 없으면 목록으로 복귀 (흰 화면 방지)
  useEffect(() => {
    if (route !== '/quiz') return;
    if (selectedRoundId && selectedCertId) return;
    setPreFetchedQuestions(null);
    setQuizStartIndex(undefined);
    navigate(selectedCertId ? '/exam-list' : '/');
  }, [route, selectedRoundId, selectedCertId]);

  // Navigation Helper
  const navigate = (path: string) => {
    if (path !== '/login') setLoginInitialMode(null);
    const [pathname, search] = path.includes('?') ? path.split('?') : [path, ''];
    const params = new URLSearchParams(search);
    // 로그인 클릭 시 현재 화면 유지하면서 로그인 모달만 오픈
    if (pathname === '/login') {
      setLoginInitialMode('login');
      setShowLoginModal(true);
      // 퀴즈 화면에서 로그인 버튼으로 연 경우: 로그인 성공 시 현재 문제 유지
      setLoginModalIntent(route === '/quiz' && !user ? 'guestQuizLogin' : 'standalone');
      return;
    }
    if (pathname === '/exam-list') {
      const cert = params.get('cert');
      const round = params.get('round');
      if (cert) setSelectedCertId(cert);
      if (round) setSelectedRoundId(round);
    }
    if (pathname === '/mypage') {
      const cert = params.get('cert');
      if (cert) setSelectedCertId(cert);
    }
    // 결제: 페이지 이동 대신 모달 오픈 (현재 화면 유지 → 문제 풀이 이어하기 가능)
    if (pathname === '/checkout') {
      setShowCheckoutModal(true);
      return;
    }
    // Basic Auth Guard: 로그인 필요 경로 → 로그인 모달
    const needsLogin = pathname === '/mypage' || pathname === '/account-settings' || pathname.startsWith('/admin');
    if (needsLogin && !user) {
      setLoginInitialMode('login');
      setShowLoginModal(true);
      setLoginModalIntent('standalone');
      setRoute(pathname === '/mypage' ? '/' : pathname as Route);
      return;
    }
    setRoute(pathname as Route);
    // Scroll to top on navigation
    window.scrollTo(0, 0);
  };

  const navigateToAuth = (mode: 'login' | 'signup') => {
    setLoginInitialMode(mode);
    setShowLoginModal(true);
    setLoginModalIntent('standalone');
    window.scrollTo(0, 0);
  };

  const handleLogout = async () => {
    await logout();
    setShowLogoutToast(true);
    setRoute('/');
  };

  // Flow Handlers
  const handleStartExamFlow = (certId?: string, _mode: 'start' | 'continue' = 'continue') => {
    if (user) {
      const targetCertId = certId || CERTIFICATIONS[0].id;
      setSelectedCertId(targetCertId);

      const hasSubscription = user.subscriptions.some(s => s.id === targetCertId);

      if (!hasSubscription) {
        const newCert = CERTIFICATIONS.find(c => c.id === targetCertId);
        if (newCert) {
          updateUser((u) => ({
            ...u,
            subscriptions: [...u.subscriptions, newCert],
          }));
        }
      }

      navigate('/exam-list');
    } else {
      setLoginInitialMode('login');
      setShowLoginModal(true);
      setLoginModalIntent('standalone');
    }
  };

  // 메인 화면에서 자격증 선택 시 → 모의고사 회차 목록으로 이동 (게스트/회원 공통)
  const handleStartDiagnosticTest = (certId: string, _dateId?: string) => {
    if (!CERT_IDS_WITH_QUESTIONS.includes(certId)) {
      alert('해당 자격증은 현재 준비 중입니다.');
      return;
    }
    setSelectedCertId(certId);
    navigate('/exam-list');
  };

  /** 대시보드 "학습 시작하기" 클릭 시 → 목록만 보여주고 모달 자동 오픈 안 함 (유저가 회차 선택) */
  const handleSelectExamFromMyPage = (certId: string) => {
    setSelectedCertId(certId);
    setSelectedRoundId(null);
    navigate('/exam-list');
  };

  const handleSelectRound = (roundId: string, mode?: 'exam' | 'study') => {
    setSelectedRoundId(roundId);
    setQuizMode(mode ?? 'study');
    setPreFetchedQuestions(null);
    setQuizStartIndex(undefined);
    setPendingGuestSession(null);
    navigate('/quiz');
  };

  const handleSelectAiRound = (roundId: string, questions: import('./types').Question[], mode?: 'exam' | 'study') => {
    setSelectedRoundId(roundId);
    setQuizMode(mode ?? 'study');
    setPreFetchedQuestions(questions);
    setQuizStartIndex(undefined);
    setPendingGuestSession(null);
    navigate('/quiz');
  };

  /** 과목 강화 학습: 모드 선택 모달 → 5초 오버레이 → 50문항 큐레이션 후 퀴즈 */
  const [showSubjectStrengthPreparing, setShowSubjectStrengthPreparing] = useState(false);
  const handleStartSubjectStrengthTraining = (certId: string) => {
    if (!user?.id) return;
    setPendingFocusTraining({ type: 'subject_strength', certId });
  };

  /** 데이터 부족 시 규격화된 모달 (과목 강화 / 취약 유형 / 취약 개념) */
  const [showInsufficientDataModal, setShowInsufficientDataModal] = useState(false);

  /** 취약 유형 집중학습: 모드 선택 모달 → 5초 오버레이 → 50문항, 부족 시 팝업 */
  const [showWeakTypePreparing, setShowWeakTypePreparing] = useState(false);
  const handleStartWeakTypeFocus = (certId: string) => {
    if (!user?.id) return;
    setPendingFocusTraining({ type: 'weak_type', certId });
  };

  /** 취약 개념 집중학습: 모드 선택 모달 → 5초 오버레이 → 50문항, 부족 시 팝업 */
  const [showWeakConceptPreparing, setShowWeakConceptPreparing] = useState(false);
  const handleStartWeakConceptFocus = (certId: string) => {
    if (!user?.id) return;
    setPendingFocusTraining({ type: 'weak_concept', certId });
  };

  /** 집중학습 모드 선택(학습/시험) 후 실제 fetch + 퀴즈 진입 */
  const handleFocusModeSelect = async (mode: 'study' | 'exam') => {
    const pending = pendingFocusTraining;
    if (!pending || !user?.id) return;
    setPendingFocusTraining(null);
    const { type, certId } = pending;
    const delayMs = 3000;
    const setPreparing = (v: boolean) => {
      if (type === 'subject_strength') setShowSubjectStrengthPreparing(v);
      else if (type === 'weak_type') setShowWeakTypePreparing(v);
      else setShowWeakConceptPreparing(v);
    };
    setPreparing(true);
    try {
      if (type === 'subject_strength') {
        const [_, result] = await Promise.all([
          new Promise<void>((r) => setTimeout(r, delayMs)),
          fetchSubjectStrengthTraining50(user.id, certId),
        ]);
        setPreparing(false);
        if (result.questions.length < 20) {
          alert('아직 충분한 데이터가 쌓이지 않았어요.\n모의고사 1회 이상 풀어주신 뒤 이용해 주세요.');
          return;
        }
        setSelectedCertId(certId);
        setSelectedRoundId('__subject_strength__');
        setQuizMode(mode);
        setPreFetchedQuestions(result.questions);
        setQuizStartIndex(undefined);
        setPendingGuestSession(null);
        navigate('/quiz');
      } else if (type === 'weak_type') {
        const [_, result] = await Promise.all([
          new Promise<void>((r) => setTimeout(r, delayMs)),
          fetchWeakTypeFocus50(user.id, certId),
        ]);
        setPreparing(false);
        if (result.questions.length === 0) {
          alert('선별된 문제가 없습니다. 모의고사를 1회 이상 응시한 뒤 이용해 주세요.');
          return;
        }
        setSelectedCertId(certId);
        setSelectedRoundId('__weak_type_focus__');
        setQuizMode(mode);
        setPreFetchedQuestions(result.questions);
        setQuizStartIndex(undefined);
        setPendingGuestSession(null);
        navigate('/quiz');
      } else {
        const [_, result] = await Promise.all([
          new Promise<void>((r) => setTimeout(r, delayMs)),
          fetchWeakConceptFocus50(user.id, certId),
        ]);
        setPreparing(false);
        if (result.insufficient || result.questions.length < 50) {
          setShowInsufficientDataModal(true);
          return;
        }
        setSelectedCertId(certId);
        setSelectedRoundId('__weak_concept_focus__');
        setQuizMode(mode);
        setPreFetchedQuestions(result.questions);
        setQuizStartIndex(undefined);
        setPendingGuestSession(null);
        navigate('/quiz');
      }
    } catch (e) {
      setPreparing(false);
      const label = type === 'subject_strength' ? '과목 강화' : type === 'weak_type' ? '취약 유형' : '취약 개념';
      console.error(`[${label} 집중학습]`, e);
      alert('문제를 불러오는 중 오류가 발생했습니다.');
    }
  };

  const handleQuizFinish = (
    score: number,
    total: number,
    sessionHistory?: import('./pages/Result').QuizAnswerRecord[],
    questions?: import('./types').Question[],
    roundMemo?: import('./pages/Quiz').RoundMemo
  ) => {
    setQuizResult({ score, total, sessionHistory, questions, roundMemo });

    // 로그인 회원: 학습 이력 저장 + 참여 자격증 구독 반영 (마이페이지 진입 가능)
    if (user && sessionHistory?.length && questions?.length && selectedCertId) {
      const rid = selectedRoundId ?? undefined;
      const roundLabel = (() => {
        if (!rid || !questions.length) return undefined;
        if (rid === '__subject_strength__') {
          const subjects = new Set(questions.map((q) => q.subject_number ?? 1));
          const n = subjects.size;
          return `과목 강화 학습 - ${n}과목 강화`;
        }
        if (rid === '__weak_type_focus__') {
          const count: Record<string, number> = {};
          for (const q of questions) {
            for (const pt of q.problem_types ?? []) {
              const t = String(pt).trim();
              if (t) count[t] = (count[t] ?? 0) + 1;
            }
          }
          const main = Object.entries(count).sort((a, b) => b[1] - a[1])[0]?.[0];
          return main ? `취약 유형 집중 학습 - ${main} 강화` : '취약 유형 집중 학습';
        }
        if (rid === '__weak_concept_focus__') {
          const concepts = [...new Set(questions.map((q) => (q.core_concept ?? '').trim()).filter(Boolean))];
          const n = concepts.length;
          const first = concepts[0];
          if (n <= 0) return '취약 개념 집중 학습';
          if (n === 1) return `취약 개념 집중 학습 - ${first} 강화`;
          return `취약 개념 집중 학습 - ${first} 외 ${n - 1}개 개념 강화`;
        }
        return getRoundLabel(rid);
      })();
      submitQuizResult(user.id, selectedCertId, sessionHistory, questions, { roundId: rid, roundLabel: roundLabel ?? undefined })
        .then((result) => {
          if (result) {
            const certCode = CERTIFICATIONS.find((c) => c.id === selectedCertId)?.code;
            if (certCode) invalidateMyPageCache(user.id, certCode).catch(() => {});
          } else {
            console.warn('[퀴즈 결과 저장 실패] submitQuizResult가 null 반환 (certCode 변환 실패 가능)');
          }
        })
        .catch((e) => {
          console.error('[퀴즈 결과 저장 실패]', {
            error: e,
            userId: user.id,
            certId: selectedCertId,
            questionCount: sessionHistory.length,
            stack: e instanceof Error ? e.stack : undefined,
          });
        });
      ensureUserSubscription(user.id, selectedCertId).catch((e) => console.error('구독 반영 실패', e));
      if (!user.subscriptions.some((s) => s.id === selectedCertId)) {
        const newCert = CERTIFICATIONS.find((c) => c.id === selectedCertId);
        if (newCert) {
          updateUser((u) => ({ ...u, subscriptions: [...u.subscriptions, newCert] }));
        }
      }
      setPendingGuestSession(null);
      clearGuestQuizProgress();
    }

    navigate('/result');
  };

  /** 마이페이지 나의 학습 기록에서 "오답확인" 클릭 시 해당 시험 결과 화면으로 이동 */
  const handleViewExamResult = async (examId: string) => {
    if (!user?.id) return;
    try {
      const snap = await getDoc(doc(db, 'users', user.id, 'exam_results', examId));
      if (!snap.exists()) {
        alert('해당 시험 결과를 찾을 수 없습니다.');
        return;
      }
      const data = snap.data();
      const certId = data?.certId as string | undefined;
      const certCode = data?.certCode as string | undefined;
      const roundId = data?.roundId ?? null;
      const answers = (data?.answers ?? []) as { qid: string; isCorrect?: boolean; isConfused?: boolean }[];
      const totalQuestions = Number(data?.totalQuestions) || 0;
      const correctCount = Number(data?.correctCount) || 0;
      if (!certCode || !certId || answers.length === 0) {
        alert('해당 시험 결과를 불러올 수 없습니다.');
        return;
      }
      const questions = await fetchQuestionsFromPools(certCode, answers.map((a) => a.qid));
      const sessionHistory = answers.map((a) => ({
        qid: a.qid,
        selected: 1,
        isCorrect: a.isCorrect === true,
        isConfused: a.isConfused === true,
      }));
      setSelectedCertId(certId);
      setQuizResult({
        score: correctCount,
        total: totalQuestions,
        sessionHistory,
        questions,
        roundMemo: null,
      });
      navigate('/result');
    } catch (e) {
      console.error('[오답확인] 결과 로드 실패', e);
      alert('시험 결과를 불러오는 중 오류가 발생했습니다.');
    }
  };

  const handleCheckoutComplete = async () => {
    setPaymentSuccessError(null);
    if (user && selectedCertId) {
      try {
        await setPaymentComplete(user.id, selectedCertId);
        await refreshUser();
        setShowCheckoutModal(false);
        setShowPaymentSuccessModal(true);
      } catch (err) {
        console.error('[결제 완료] Firestore 저장 실패', err);
        setPaymentSuccessError('상태 저장에 실패했습니다. 새로고침 후 다시 확인해주세요.');
        setShowCheckoutModal(false);
        setShowPaymentSuccessModal(true);
      }
    } else {
      setShowCheckoutModal(false);
      setShowPaymentSuccessModal(true);
    }
  };

  // 로그인된 상태면 인증 대기 배너 제거 (다른 탭에서 인증 후 로그인 등)
  React.useEffect(() => {
    if (user && pendingVerificationBanner) setPendingVerificationBanner(null);
  }, [user, pendingVerificationBanner]);

  // 구글 로그인 리다이렉트 복귀 시 guestContinue intent 복원 (팝업 대신 전체 화면 이동한 경우)
  React.useEffect(() => {
    if (authLoading || !user) return;
    const intent = getStoredGoogleRedirectIntent();
    if (!intent || intent.intent !== 'guestContinue') return;
    clearStoredGoogleRedirectIntent();
    setPendingGuestSession({
      certId: intent.certId,
      roundId: intent.roundId,
      sessionHistory: intent.sessionHistory,
      questions: intent.questions as import('./types').Question[],
    });
    setPendingGuestContinue({ certId: intent.certId, roundId: intent.roundId });
    setSelectedCertId(intent.certId);
    setSelectedRoundId(intent.roundId);
    setQuizStartIndex(20);
    setPreFetchedQuestions(intent.questions as import('./types').Question[]);
    setShowLoginModal(false);
    setLoginModalIntent(null);
    setRoute('/quiz');
    setShowGuestContinueModal(true);
  }, [user, authLoading]);

  // Check status for current selected cert
  const isCurrentCertPremium = user ? (user.isPremium || (selectedCertId && user.paidCertIds?.includes(selectedCertId))) : false;
  const isCurrentCertExpired = user ? (selectedCertId && user.expiredCertIds?.includes(selectedCertId)) : false;

  // Render Page Content based on Route
  const renderContent = () => {
    switch (route) {
      case '/':
        if (user?.isAdmin) {
          return <Admin currentUser={user} initialMenu="dashboard" hideSidebar />;
        }
        if (user) {
          return (
            <MyPage
              user={user}
              onNavigate={navigate}
              onSelectExam={handleSelectExamFromMyPage}
              onStartNewCert={handleStartExamFlow}
              onUpdateUser={updateUser}
              onStartWeaknessRetry={(certId) => {
                setSelectedCertId(certId);
                navigate('/exam-list');
              }}
              onStartSubjectStrengthTraining={handleStartSubjectStrengthTraining}
              showSubjectStrengthPreparing={showSubjectStrengthPreparing}
              onStartWeakTypeFocus={handleStartWeakTypeFocus}
              showWeakTypePreparing={showWeakTypePreparing}
              onStartWeakConceptFocus={handleStartWeakConceptFocus}
              showWeakConceptPreparing={showWeakConceptPreparing}
              onViewExamResult={handleViewExamResult}
              onLogout={handleLogout}
            />
          );
        }
        return (
          <EmptyState
            onStartCert={(id) => {
              setSelectedCertId(id);
              navigate('/exam-list');
            }}
          />
        );
      case '/mypage':
        if (user?.isAdmin) {
          return <Admin currentUser={user} initialMenu="dashboard" hideSidebar />;
        }
        return user ? (
          <MyPage
            user={user}
            initialCertId={selectedCertId ?? undefined}
            onNavigate={navigate}
            onSelectExam={handleSelectExamFromMyPage}
            onStartNewCert={handleStartExamFlow}
            onUpdateUser={updateUser}
            onStartWeaknessRetry={(certId) => {
              setSelectedCertId(certId);
              navigate('/exam-list');
            }}
            onStartSubjectStrengthTraining={handleStartSubjectStrengthTraining}
            showSubjectStrengthPreparing={showSubjectStrengthPreparing}
            onStartWeakTypeFocus={handleStartWeakTypeFocus}
            showWeakTypePreparing={showWeakTypePreparing}
            onStartWeakConceptFocus={handleStartWeakConceptFocus}
            showWeakConceptPreparing={showWeakConceptPreparing}
            onViewExamResult={handleViewExamResult}
            onLogout={handleLogout}
          />
        ) : null;
      case '/account-settings':
        return user ? (
          <AccountSettings
            user={user}
            onBack={() => navigate('/mypage')}
            onUpdateUser={updateUser}
            onLogout={handleLogout}
          />
        ) : null;
      case '/exam-list': {
        const examListCertId = selectedCertId ?? user?.subscriptions?.[0]?.id ?? user?.paidCertIds?.[0] ?? CERTIFICATIONS[0]?.id;
        return examListCertId ? (
          <ExamList 
            certId={examListCertId}
            user={user}
            onSelectRound={handleSelectRound}
            onSelectAiRound={handleSelectAiRound}
            onBack={() => navigate(user ? '/mypage' : '/')}
            onNavigate={navigate}
            isPremiumUser={!!isCurrentCertPremium}
            isExpired={!!isCurrentCertExpired}
            onLogout={handleLogout}
            currentPath="/exam-list"
            startNextAfterRoundId={null}
            onConsumedStartNext={() => {}}
            initialRoundId={selectedRoundId ?? undefined}
            onRequestLogin={() => {
              setLoginInitialMode('login');
              setShowLoginModal(true);
              setLoginModalIntent('standalone');
            }}
          />
        ) : null;
      }
      case '/quiz':
        return selectedRoundId && selectedCertId ? (
          <>
            <Quiz 
              key={`quiz-${selectedCertId}-${selectedRoundId}-${quizStartIndex ?? 0}`}
              roundId={selectedRoundId} 
              certId={selectedCertId}
              user={user}
              mode={quizMode}
              preFetchedQuestions={preFetchedQuestions}
              startIndex={quizStartIndex}
              initialSessionHistory={
                pendingGuestSession?.certId === selectedCertId && pendingGuestSession?.roundId === selectedRoundId
                  ? pendingGuestSession.sessionHistory
                  : undefined
              }
              onFinish={handleQuizFinish} 
              onExit={() => {
                setPreFetchedQuestions(null);
                setQuizStartIndex(undefined);
                navigate(user ? '/mypage' : '/');
              }}
              onGuestLimitReached={({ certId, roundId, sessionHistory, questions }) => {
                setPendingGuestSession({ certId, roundId, sessionHistory, questions });
                setPendingGuestContinue({ certId, roundId });
                setLoginInitialMode('signup');
                setShowLoginModal(true);
                setLoginModalIntent('guestContinue');
              }}
              onRequestCheckout={() => {
                if (!user) {
                  setPendingCheckoutCertId(selectedCertId);
                  setLoginInitialMode('login');
                  setShowLoginModal(true);
                  setLoginModalIntent('checkout');
                } else {
                  navigate('/checkout');
                }
              }}
            />
            {showGuestContinueModal && (
              <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 p-4">
                <div className="bg-white rounded-2xl p-8 max-w-sm w-full shadow-xl text-center">
                  <p className="text-lg font-bold text-slate-900 mb-2">로그인 완료!</p>
                  <p className="text-slate-600 text-sm mb-6">이어서 21번 문제부터 풀 수 있어요.</p>
                  <button
                    type="button"
                    onClick={() => setShowGuestContinueModal(false)}
                    className="w-full bg-slate-900 text-white font-bold py-4 rounded-xl hover:bg-slate-800"
                  >
                    이어서 진행
                  </button>
                </div>
              </div>
            )}
          </>
        ) : null;
      case '/result':
        return quizResult ? (
          <Result 
            score={quizResult.score} 
            total={quizResult.total} 
            certId={selectedCertId}
            roundId={selectedRoundId}
            user={user}
            isPaidUser={isCurrentCertPremium}
            sessionHistory={quizResult.sessionHistory}
            questions={quizResult.questions}
            roundMemo={quizResult.roundMemo}
            onHome={() => navigate('/')}
            onRetry={() => {
              if (selectedRoundId) setShowRetryModeModal(true);
              else navigate('/exam-list');
            }}
            onGoToList={() => {
              setSelectedRoundId(null);
              navigate(selectedCertId ? `/exam-list?cert=${selectedCertId}` : '/exam-list');
            }}
            onGoToDashboard={() => navigate('/mypage')}
            onNextRoundAuto={() => {
              if (!user || !selectedCertId) {
                navigate('/');
                return;
              }
              if (!isCurrentCertPremium) {
                setShowNextRoundPaymentModal(true);
                return;
              }
              if (!selectedRoundId) {
                setSelectedRoundId(null);
                navigate('/exam-list');
                return;
              }
              const certRounds = EXAM_ROUNDS.filter((r) => r.certId === selectedCertId).sort((a, b) => a.round - b.round);
              const current = certRounds.find((r) => r.id === selectedRoundId);
              if (!current) {
                setSelectedRoundId(null);
                navigate('/exam-list');
                return;
              }
              const currentIndex = certRounds.indexOf(current);
              const nextRound = currentIndex >= 0 && currentIndex < certRounds.length - 1 ? certRounds[currentIndex + 1] : null;
              if (!nextRound) {
                setSelectedRoundId(null);
                navigate('/exam-list');
                return;
              }
              setNextRoundInfo({ id: nextRound.id, round: nextRound.round, type: nextRound.type ?? 'practice' });
              setShowNextRoundModeModal(true);
            }}
            onLogin={() => { setLoginInitialMode('login'); setShowLoginModal(true); setLoginModalIntent('standalone'); }}
            onGoToCheckout={() => {
              if (selectedCertId) navigate('/checkout');
              else navigate('/'); 
            }}
            onContinueLearning={() => {
              if (selectedCertId) navigate('/exam-list');
              else navigate('/');
            }}
            onNextRoundPaymentRequest={() => setShowNextRoundPaymentModal(true)}
            showCouponEffect={showCouponEffect}
          />
        ) : null;
      case '/admin':
        return user?.isAdmin ? <Admin currentUser={user} initialMenu="users" hideSidebar /> : <div>Access Denied</div>;
      case '/admin/certs':
        return user?.isAdmin ? <AdminCerts /> : <div>Access Denied</div>;
      case '/admin/questions':
        return user?.isAdmin ? <AdminQuestions /> : <div>Access Denied</div>;
      case '/admin/billing':
        return user?.isAdmin ? (
          <div className="p-6 md:p-8 max-w-4xl">
            <h1 className="text-2xl font-black text-slate-900 mb-2">결제 관리 (쿠폰 및 정산)</h1>
            <p className="text-slate-500">준비 중입니다.</p>
          </div>
        ) : <div>Access Denied</div>;
      default:
        return <div>404 Not Found</div>;
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-slate-400 font-medium">로딩 중...</div>
      </div>
    );
  }

  // 랜딩만 사이드바 없음, 그 외 모든 화면에 좌측 사이드바 노출
  const isLanding = route === '/' && !user;
  const handleLoginModalAuthSuccess = (options?: {
    isNewUser?: boolean;
    needsVerificationBanner?: boolean;
    email?: string;
    password?: string;
  }) => {
    const intent = loginModalIntent;
    setShowLoginModal(false);
    setLoginModalIntent(null);
    if (options?.needsVerificationBanner && options?.email && options?.password) {
      setPendingVerificationBanner({ email: options.email, password: options.password });
      setVerificationBannerError('');
      return;
    }
    if (!options?.isNewUser) setShowLoginToast(true);
    if (intent === 'guestContinue' && pendingGuestContinue) {
      setRoute('/quiz');
      setSelectedCertId(pendingGuestContinue.certId);
      setSelectedRoundId(pendingGuestContinue.roundId);
      setQuizStartIndex(20);
      setPreFetchedQuestions(pendingGuestSession?.questions ?? null);
      setShowGuestContinueModal(true);
      setPendingGuestContinue(null);
    } else if (intent === 'guestQuizLogin') {
      setShowQuizLoginSuccessModal(true);
    } else if (intent === 'checkout') {
      setSelectedCertId(pendingCheckoutCertId ?? selectedCertId);
      setPendingCheckoutCertId(null);
      navigate('/checkout');
    } else if (options?.isNewUser) {
      setShowSignupSuccessModal(true);
    } else {
      setRoute('/mypage');
      window.scrollTo(0, 0);
    }
  };

  const handleVerificationBannerConfirm = async () => {
    if (!pendingVerificationBanner) return;
    setVerificationBannerError('');
    setVerificationBannerLoading(true);
    try {
      const u = await login(pendingVerificationBanner.email, pendingVerificationBanner.password);
      if (u.is_verified !== false) {
        setPendingVerificationBanner(null);
        setRoute('/mypage');
        window.scrollTo(0, 0);
      } else {
        setVerificationBannerError('이메일에서 인증을 완료해주세요.');
      }
    } catch {
      setVerificationBannerError('이메일에서 인증을 완료해주세요.');
    } finally {
      setVerificationBannerLoading(false);
    }
  };

  if (isLanding) {
    return (
      <>
        {showLoginModal && (
          <LoginModal
            initialMode={loginInitialMode ?? 'login'}
            persistent={loginModalIntent === 'guestContinue'}
            intent={loginModalIntent ?? undefined}
            intentDataForGoogle={
              loginModalIntent === 'guestContinue' && pendingGuestSession
                ? {
                    intent: 'guestContinue',
                    certId: pendingGuestSession.certId,
                    roundId: pendingGuestSession.roundId,
                    sessionHistory: pendingGuestSession.sessionHistory,
                    questions: pendingGuestSession.questions,
                  }
                : undefined
            }
            onBack={() => { setShowLoginModal(false); setLoginModalIntent(null); }}
            onAuthSuccess={handleLoginModalAuthSuccess}
          />
        )}
        {pendingVerificationBanner && !user && (
          <div className="bg-amber-400 text-amber-950 border-b border-amber-500/50 shadow-sm">
            <div className="max-w-4xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-medium">
                이메일 인증이 필요합니다. 메일함에서 인증 링크를 클릭한 뒤 아래 [인증완료] 버튼을 눌러주세요.
              </p>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  disabled={verificationBannerLoading || verificationBannerResendLoading}
                  onClick={handleVerificationBannerConfirm}
                  className="px-5 py-2 rounded-xl bg-amber-900 text-white font-bold text-sm hover:bg-amber-800 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                >
                  {verificationBannerLoading ? '확인 중...' : '인증완료'}
                </button>
                <button
                  type="button"
                  disabled={verificationBannerLoading || verificationBannerResendLoading}
                  onClick={async () => {
                    if (!pendingVerificationBanner) return;
                    setVerificationBannerError('');
                    setVerificationBannerResendLoading(true);
                    try {
                      await resendVerificationEmail(pendingVerificationBanner.email, pendingVerificationBanner.password);
                    } catch (e) {
                      setVerificationBannerError(e instanceof Error ? e.message : '재발송에 실패했습니다.');
                    } finally {
                      setVerificationBannerResendLoading(false);
                    }
                  }}
                  className="px-4 py-2 rounded-xl border border-amber-900 text-amber-900 font-bold text-sm hover:bg-amber-900/10 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                >
                  {verificationBannerResendLoading ? '재발송 중...' : '메일 재발송'}
                </button>
              </div>
            </div>
            {verificationBannerError && (
              <p className="max-w-4xl mx-auto px-4 pb-2 text-sm font-medium text-red-700">
                {verificationBannerError}
              </p>
            )}
          </div>
        )}
        {renderContent()}
        {showCheckoutModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm overflow-y-auto">
            <div className="relative w-full max-w-4xl max-h-[90vh] overflow-y-auto bg-[#edf1f5] rounded-3xl shadow-2xl animate-slide-up my-auto">
              <button
                type="button"
                onClick={() => setShowCheckoutModal(false)}
                className="absolute top-4 right-4 z-10 w-10 h-10 rounded-full bg-white/90 hover:bg-white border border-slate-200 flex items-center justify-center text-slate-600 hover:text-slate-900 transition-colors"
                aria-label="닫기"
              >
                <X size={24} />
              </button>
              <Checkout
                certId={selectedCertId || undefined}
                onBack={() => setShowCheckoutModal(false)}
                onComplete={handleCheckoutComplete}
              />
            </div>
          </div>
        )}
      </>
    );
  }

  // 구글 로그인 리다이렉트 복귀 시 intent 복원 중에는 메인(MyPage) 노출 방지 — 로딩만 표시
  const pendingGoogleRedirectIntent = user && !authLoading && getStoredGoogleRedirectIntent()?.intent === 'guestContinue';
  if (pendingGoogleRedirectIntent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#edf1f5]">
        <div className="text-slate-500 font-medium">로딩 중...</div>
      </div>
    );
  }

  if (isMobile) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-[#edf1f5] p-6 text-center">
        <div className="w-16 h-16 rounded-2xl bg-[#99ccff] flex items-center justify-center mb-6">
          <Monitor className="w-8 h-8 text-[#1e56cd]" />
        </div>
        <h1 className="text-xl font-bold text-slate-900 mb-2">핀셋은 PC에 최적화되었습니다</h1>
        <p className="text-slate-600 text-sm">PC로 학습해 주세요.</p>
      </div>
    );
  }

  return (
    <>
      {showLoginModal && (
        <LoginModal
          initialMode={loginInitialMode ?? 'login'}
          persistent={loginModalIntent === 'guestContinue'}
          intent={loginModalIntent ?? undefined}
          intentDataForGoogle={
            loginModalIntent === 'guestContinue' && pendingGuestSession
              ? {
                  intent: 'guestContinue',
                  certId: pendingGuestSession.certId,
                  roundId: pendingGuestSession.roundId,
                  sessionHistory: pendingGuestSession.sessionHistory,
                  questions: pendingGuestSession.questions,
                }
              : undefined
          }
          onBack={() => { setShowLoginModal(false); setLoginModalIntent(null); }}
          onAuthSuccess={handleLoginModalAuthSuccess}
        />
      )}
      {showQuizLoginSuccessModal && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl p-8 max-w-sm w-full shadow-xl text-center">
            <p className="text-lg font-bold text-slate-900 mb-2">로그인 완료!</p>
            <p className="text-slate-600 text-sm mb-6">현재 문제를 이어서 풀 수 있어요.</p>
            <button
              type="button"
              onClick={() => setShowQuizLoginSuccessModal(false)}
              className="w-full bg-slate-900 text-white font-bold py-4 rounded-xl hover:bg-slate-800"
            >
              확인
            </button>
          </div>
        </div>
      )}
      <div className="h-screen bg-[#edf1f5] flex overflow-hidden">
        <DashboardSidebar
          user={user}
          certId={selectedCertId}
          currentPath={route}
          onNavigate={navigate}
          onLogout={handleLogout}
        />
        <main className="flex-1 min-h-0 bg-[#edf1f5] rounded-tl-[40px] overflow-y-auto">
          {user && user.is_verified === false && (
            <div className="bg-amber-50 border-b border-amber-200 px-4 py-3 flex items-center justify-between gap-4 flex-wrap">
              <span className="text-amber-900 text-sm font-medium">
                이메일 인증을 완료해주세요. 메일이 오지 않았나요?
              </span>
              <button
                type="button"
                onClick={() => {
                  setResendError(null);
                  setResendPassword('');
                  setShowResendVerificationModal(true);
                }}
                className="text-amber-800 underline font-semibold text-sm hover:text-amber-900 shrink-0"
              >
                인증 메일 재발송
              </button>
            </div>
          )}
          {renderContent()}
        </main>
      </div>
      {showSignupSuccessModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl p-8 max-w-sm w-full shadow-xl text-center">
            <p className="text-lg font-bold text-slate-900 mb-2">회원 가입 완료</p>
            <p className="text-slate-600 text-sm mb-6">지금 바로 학습을 시작해보세요</p>
            <button
              type="button"
              onClick={() => {
                setShowSignupSuccessModal(false);
                navigate('/mypage');
              }}
              className="w-full bg-slate-900 text-white font-bold py-4 rounded-xl hover:bg-slate-800"
            >
              확인
            </button>
          </div>
        </div>
      )}

      {/* 로그아웃되었습니다 토스트 (앱 스타일) */}
      {showLogoutToast && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] animate-slide-up">
          <div className="px-6 py-3.5 rounded-2xl bg-slate-800 text-white shadow-xl border border-slate-700/50 text-sm font-bold">
            로그아웃되었습니다
          </div>
        </div>
      )}

      {/* 로그인되었습니다 토스트 (하단 작게) */}
      {showLoginToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] animate-slide-up">
          <div className="px-4 py-2.5 rounded-xl bg-slate-800 text-white shadow-lg border border-slate-700/50 text-xs font-semibold">
            로그인되었습니다
          </div>
        </div>
      )}

      {/* 미인증 사용자: 인증 메일 재발송 모달 */}
      {showResendVerificationModal && user?.email && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl">
            <h3 className="text-lg font-bold text-slate-900 mb-2">인증 메일 재발송</h3>
            <p className="text-slate-600 text-sm mb-4">비밀번호를 입력하면 {user.email}로 인증 메일을 다시 보냅니다.</p>
            <input
              type="password"
              value={resendPassword}
              onChange={(e) => { setResendPassword(e.target.value); setResendError(null); }}
              placeholder="비밀번호"
              className="w-full border border-slate-200 rounded-xl px-4 py-3 text-slate-900 placeholder:text-slate-400 mb-3"
              autoFocus
            />
            {resendError && <p className="text-red-600 text-sm mb-2">{resendError}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowResendVerificationModal(false);
                  setResendPassword('');
                  setResendError(null);
                }}
                className="flex-1 py-3 rounded-xl border border-slate-200 text-slate-600 font-semibold hover:bg-slate-50"
              >
                취소
              </button>
              <button
                type="button"
                disabled={!resendPassword.trim() || resendLoading}
                onClick={async () => {
                  if (!resendPassword.trim() || !user?.email) return;
                  setResendLoading(true);
                  setResendError(null);
                  try {
                    await resendVerificationEmail(user.email, resendPassword.trim());
                    setShowResendVerificationModal(false);
                    setResendPassword('');
                    alert('인증 메일을 발송했습니다. 받은편지함과 스팸함을 확인해주세요.');
                  } catch (e: unknown) {
                    const msg = e instanceof Error ? e.message : '재발송에 실패했습니다. 비밀번호를 확인해주세요.';
                    setResendError(msg);
                  } finally {
                    setResendLoading(false);
                  }
                }}
                className="flex-1 py-3 rounded-xl bg-[#0034d3] text-white font-bold hover:bg-[#003087] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {resendLoading ? '발송 중…' : '재발송'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 결제 화면: 대형 모달 (페이지 이동 없이 현재 화면 유지 → 퀴즈 이어하기 가능) */}
      {showCheckoutModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm overflow-y-auto">
          <div className="relative w-full max-w-4xl max-h-[90vh] overflow-y-auto bg-[#edf1f5] rounded-3xl shadow-2xl animate-slide-up my-auto">
            <button
              type="button"
              onClick={() => setShowCheckoutModal(false)}
              className="absolute top-4 right-4 z-10 w-10 h-10 rounded-full bg-white/90 hover:bg-white border border-slate-200 flex items-center justify-center text-slate-600 hover:text-slate-900 transition-colors"
              aria-label="닫기"
            >
              <X size={24} />
            </button>
            <Checkout
              certId={selectedCertId || undefined}
              onBack={() => {
                setShowCheckoutModal(false);
              }}
              onComplete={handleCheckoutComplete}
            />
          </div>
        </div>
      )}

      {/* 결제 완료 성공 모달 (서비스 디자인) */}
      {showPaymentSuccessModal && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-5">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => { setShowPaymentSuccessModal(false); setPaymentSuccessError(null); }} />
          <div className="relative z-10 w-full max-w-sm rounded-2xl bg-white p-8 shadow-2xl text-center animate-scale-in">
            <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-5">
              <Check className="w-7 h-7 text-emerald-600" strokeWidth={2.5} />
            </div>
            <h3 className="text-xl font-black text-slate-900 mb-2">결제가 완료되었습니다</h3>
            {paymentSuccessError ? (
              <p className="text-sm text-red-600 mb-6">{paymentSuccessError}</p>
            ) : (
              <p className="text-sm text-slate-500 mb-6">
                열공 모드가 적용되었습니다.
                <br />
                새로고침 후에도 유지됩니다.
              </p>
            )}
            <button
              type="button"
              onClick={() => { setShowPaymentSuccessModal(false); setPaymentSuccessError(null); }}
              className="w-full py-3.5 rounded-xl bg-slate-900 text-white font-bold text-sm hover:bg-slate-800 transition-colors"
            >
              확인
            </button>
          </div>
        </div>
      )}

      {/* 결과 화면 "다음 회차" → 모드 선택(현재 화면) → 5초 생성 효과 → 퀴즈 직행 */}
      {showNextRoundModeModal && nextRoundInfo && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-5">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => { setShowNextRoundModeModal(false); setNextRoundInfo(null); }} />
          <div className="relative z-10 w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl animate-scale-in">
            <h3 className="text-lg font-black text-slate-900 mb-2">다음 회차 모드 선택</h3>
            <p className="text-sm text-slate-500 mb-5">풀이 방식을 선택하면 모의고사가 준비된 뒤 바로 시작됩니다.</p>
            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={() => {
                  setShowNextRoundModeModal(false);
                  setNextRoundSelectedMode('study');
                  setNextRoundPreparingCountdown(5);
                  setNextRoundPreparingPhase('countdown');
                  setNextRoundFetchedQuestions(null);
                  // 모달이 닫힌 다음 틱에 딤+준비 오버레이 표시 (렌더 타이밍 보장)
                  setTimeout(() => setShowNextRoundPreparing(true), 0);
                }}
                className="flex items-center gap-3 w-full rounded-xl border-2 border-slate-200 p-4 text-left hover:border-brand-400 hover:bg-brand-50/50 transition-colors"
              >
                <div className="w-10 h-10 rounded-lg bg-brand-100 flex items-center justify-center shrink-0">
                  <BookOpen className="w-5 h-5 text-brand-600" />
                </div>
                <div>
                  <span className="font-bold text-slate-900 block">AI 학습 모드</span>
                  <span className="text-xs text-slate-500">해설 보면서 자유롭게 풀기</span>
                </div>
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowNextRoundModeModal(false);
                  setNextRoundSelectedMode('exam');
                  setNextRoundPreparingCountdown(5);
                  setNextRoundPreparingPhase('countdown');
                  setNextRoundFetchedQuestions(null);
                  setTimeout(() => setShowNextRoundPreparing(true), 0);
                }}
                className="flex items-center gap-3 w-full rounded-xl border-2 border-slate-200 p-4 text-left hover:border-brand-400 hover:bg-brand-50/50 transition-colors"
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
              onClick={() => { setShowNextRoundModeModal(false); setNextRoundInfo(null); }}
              className="mt-4 w-full py-2.5 text-sm font-bold text-slate-500 hover:bg-slate-50 rounded-xl"
            >
              취소
            </button>
          </div>
        </div>
      )}

      {/* 결과 화면 다음 회차 5초 준비 오버레이 (딤 + 팝업) */}
      {showNextRoundPreparing && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="text-center text-white px-8 py-10 rounded-3xl bg-slate-800/95 border border-slate-600 shadow-2xl min-w-[280px]">
            {nextRoundPreparingPhase === 'countdown' ? (
              <>
                <p className="text-slate-300 text-sm mb-3">맞춤형 모의고사를 준비하고 있어요</p>
                <p className="text-5xl font-black text-white tabular-nums">{nextRoundPreparingCountdown}</p>
                <p className="text-slate-400 text-xs mt-2">초 후 시작</p>
              </>
            ) : (
              <>
                <p className="text-xl font-bold text-white mb-1">모의고사가 준비되었습니다</p>
                <p className="text-slate-300 text-sm">곧 시작됩니다</p>
              </>
            )}
          </div>
        </div>
      )}

      {/* 결과 화면 "다시 풀기" → AI 학습 모드 / 실전 모드 선택 후 바로 퀴즈 시작 */}
      {showRetryModeModal && selectedRoundId && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-5">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowRetryModeModal(false)} />
          <div className="relative z-10 w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl animate-scale-in">
            <h3 className="text-lg font-black text-slate-900 mb-2">모의고사 모드 선택</h3>
            <p className="text-sm text-slate-500 mb-5">풀이 방식을 선택해 주세요.</p>
            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={() => {
                  setShowRetryModeModal(false);
                  const round = EXAM_ROUNDS.find((r) => r.id === selectedRoundId);
                  if (round?.type === 'ai-generated' && quizResult?.questions?.length) {
                    handleSelectAiRound(selectedRoundId, quizResult.questions, 'study');
                  } else {
                    handleSelectRound(selectedRoundId, 'study');
                  }
                }}
                className="flex items-center gap-3 w-full rounded-xl border-2 border-slate-200 p-4 text-left hover:border-brand-400 hover:bg-brand-50/50 transition-colors"
              >
                <div className="w-10 h-10 rounded-lg bg-brand-100 flex items-center justify-center shrink-0">
                  <BookOpen className="w-5 h-5 text-brand-600" />
                </div>
                <div>
                  <span className="font-bold text-slate-900 block">AI 학습 모드</span>
                  <span className="text-xs text-slate-500">해설 보면서 자유롭게 풀기</span>
                </div>
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowRetryModeModal(false);
                  const round = EXAM_ROUNDS.find((r) => r.id === selectedRoundId);
                  if (round?.type === 'ai-generated' && quizResult?.questions?.length) {
                    handleSelectAiRound(selectedRoundId, quizResult.questions, 'exam');
                  } else {
                    handleSelectRound(selectedRoundId, 'exam');
                  }
                }}
                className="flex items-center gap-3 w-full rounded-xl border-2 border-slate-200 p-4 text-left hover:border-brand-400 hover:bg-brand-50/50 transition-colors"
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
              onClick={() => setShowRetryModeModal(false)}
              className="mt-4 w-full py-2.5 text-sm font-bold text-slate-500 hover:bg-slate-50 rounded-xl"
            >
              취소
            </button>
          </div>
        </div>
      )}

      {/* 마이페이지 집중학습(과목/유형/개념) → 모의고사 모드 선택 후 5초 오버레이 → 퀴즈 */}
      {pendingFocusTraining && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-5">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setPendingFocusTraining(null)} />
          <div className="relative z-10 w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl animate-scale-in">
            <h3 className="text-lg font-black text-slate-900 mb-2">모의고사 모드 선택</h3>
            <p className="text-sm text-slate-500 mb-5">풀이 방식을 선택해 주세요.</p>
            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={() => handleFocusModeSelect('study')}
                className="flex items-center gap-3 w-full rounded-xl border-2 border-slate-200 p-4 text-left hover:border-brand-400 hover:bg-brand-50/50 transition-colors"
              >
                <div className="w-10 h-10 rounded-lg bg-brand-100 flex items-center justify-center shrink-0">
                  <BookOpen className="w-5 h-5 text-brand-600" />
                </div>
                <div>
                  <span className="font-bold text-slate-900 block">AI 학습 모드</span>
                  <span className="text-xs text-slate-500">해설 보면서 자유롭게 풀기</span>
                </div>
              </button>
              <button
                type="button"
                onClick={() => handleFocusModeSelect('exam')}
                className="flex items-center gap-3 w-full rounded-xl border-2 border-slate-200 p-4 text-left hover:border-brand-400 hover:bg-brand-50/50 transition-colors"
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
              onClick={() => setPendingFocusTraining(null)}
              className="mt-4 w-full py-2.5 text-sm font-bold text-slate-500 hover:bg-slate-50 rounded-xl"
            >
              취소
            </button>
          </div>
        </div>
      )}

      {/* 무료 회원 2회차 결과 "다음 학습" → 열공모드 가입 안내 팝업 (확인 시 결제 모달) */}
      {showNextRoundPaymentModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-5">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowNextRoundPaymentModal(false)} />
          <div className="relative z-10 w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl text-center animate-scale-in">
            <div className="w-12 h-12 rounded-full bg-brand-100 flex items-center justify-center mx-auto mb-4">
              <Lock className="w-6 h-6 text-brand-600" />
            </div>
            <h3 className="text-lg font-black text-slate-900 mb-2">열공모드 가입이 필요합니다</h3>
            <p className="text-sm text-slate-500 mb-5">
              2회차까지 무료로 이용 가능합니다.
              <br />
              열공모드에 가입하면 전체 및 맞춤형 모의고사를 이용하실 수 있습니다.
            </p>
            <button
              type="button"
              onClick={() => {
                setShowNextRoundPaymentModal(false);
                if (selectedCertId) setShowCheckoutModal(true);
              }}
              className="w-full py-3.5 rounded-xl bg-slate-900 text-white font-bold text-sm hover:bg-slate-800"
            >
              확인
            </button>
            <button
              type="button"
              onClick={() => setShowNextRoundPaymentModal(false)}
              className="mt-3 w-full py-2.5 text-sm font-bold text-slate-500 hover:bg-slate-50 rounded-xl"
            >
              취소
            </button>
          </div>
        </div>
      )}

      {/* 데이터 부족 안내 (과목 강화 / 취약 유형 / 취약 개념 50문항 미달 시) */}
      {showInsufficientDataModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-5">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowInsufficientDataModal(false)} />
          <div className="relative z-10 w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl text-center animate-scale-in">
            <div className="w-12 h-12 rounded-full bg-[#99ccff] flex items-center justify-center mx-auto mb-4">
              <Info className="w-6 h-6 text-[#1e56cd]" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 mb-2">아직 충분한 데이터가 쌓이지 않았어요</h3>
            <p className="text-sm text-slate-500 mb-5">조금 더 학습을 진행해주세요.</p>
            <button
              type="button"
              onClick={() => setShowInsufficientDataModal(false)}
              className="w-full py-3.5 rounded-xl bg-[#1e56cd] text-white font-bold text-sm hover:bg-[#1e56cd]/90"
            >
              확인
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export default App;