import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { APP_BRAND, FEATURE_COUPON } from '../config/brand';

/** 베타 빌드: 구글 로그인만 노출 (FEATURE_COUPON 또는 AiBT 브랜드) */
const IS_BETA_GOOGLE_ONLY = FEATURE_COUPON || APP_BRAND === 'AiBT';
import { AuthError, type GoogleRedirectIntent } from '../services/authService';
import { canResend, recordResend, RESEND_COOLDOWN_SEC } from '../utils/verificationResendLimit';

export type LoginModalIntent = 'standalone' | 'guestContinue' | 'checkout' | 'guestQuizLogin';

export interface LoginModalProps {
  initialMode?: 'login' | 'signup';
  /** 구글 로그인 리다이렉트 시 복귀 후 게스트 이어하기 복원용 (guestContinue일 때만 전달) */
  intentDataForGoogle?: GoogleRedirectIntent | null;
  onBack?: () => void;
  onAuthSuccess?: (options?: {
    isNewUser?: boolean;
    /** 가입 후 이메일 인증 대기: 모달 닫고 상단 노란 배너로 안내, 인증완료 버튼으로 로그인 적용 */
    needsVerificationBanner?: boolean;
    email?: string;
    password?: string;
  }) => void;
  /** true면 바깥 클릭/닫기 없음, 로그인 필수 */
  persistent?: boolean;
  /** 게스트 20문제 후 이어하기 등: 인증 대기 문구·미인증 시 21번 차단 */
  intent?: LoginModalIntent;
}

export const LoginModal: React.FC<LoginModalProps> = ({
  initialMode = 'login',
  intentDataForGoogle,
  onBack,
  onAuthSuccess,
  persistent = false,
  intent,
}) => {
  const { login, register, loginWithGoogle, resendVerificationEmail, deleteUnverifiedAccount } = useAuth();
  const [mode, setMode] = useState<'login' | 'signup'>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [familyName, setFamilyName] = useState('');
  const [givenName, setGivenName] = useState('');
  const [loading, setLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  /** 회원가입 후 이메일 인증 대기 화면 (인증완료 버튼 노출) */
  const [pendingVerification, setPendingVerification] = useState(false);
  const submittingRef = useRef(false);

  const SIGNUP_TIMEOUT_MS = 20000;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    setError('');
    setSuccessMessage('');
    setLoading(true);
    const clearLoading = () => {
      setLoading(false);
      submittingRef.current = false;
    };
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    if (mode === 'signup') {
      timeoutId = setTimeout(() => {
        clearLoading();
        setError('요청 시간이 초과되었습니다. 네트워크를 확인한 뒤 다시 시도해주세요.');
      }, SIGNUP_TIMEOUT_MS);
    }
    try {
      if (mode === 'login') {
        const loggedInUser = await login(email, password);
        if (intent === 'guestContinue' && loggedInUser.is_verified === false) {
          setError('이메일 인증을 완료한 뒤 로그인해주세요. 메일함을 확인해주세요.');
          return;
        }
        (onAuthSuccess ?? onBack)?.();
      } else {
        await register(email, password, familyName, givenName);
        (onAuthSuccess ?? onBack)?.({ isNewUser: true });
      }
    } catch (err) {
      if (timeoutId != null) clearTimeout(timeoutId);
      if (err instanceof AuthError && err.code === 'EMAIL_VERIFICATION_SENT') {
        clearLoading();
        // 게스트 20번 후 이어하기: 모달을 유지하고 인증완료 버튼만 표시 (백그라운드 20번 유지, 인증 후 모달 닫고 21번으로)
        if (intent === 'guestContinue') {
          setError('');
          setPendingVerification(true);
          return;
        }
        (onAuthSuccess ?? onBack)?.({
          isNewUser: true,
          needsVerificationBanner: true,
          email,
          password,
        });
        return;
      }
      const msg = err instanceof Error ? err.message : (mode === 'login' ? '로그인에 실패했습니다.' : '회원가입에 실패했습니다.');
      setError(msg);
    } finally {
      if (timeoutId != null) clearTimeout(timeoutId);
      clearLoading();
    }
  };

  const handleGoogleLogin = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setError('');
    setSuccessMessage('');
    setLoading(true);
    try {
      const appUser = await loginWithGoogle(intentDataForGoogle ?? undefined);
      if (appUser) {
        setLoading(false);
        submittingRef.current = false;
        (onAuthSuccess ?? onBack)?.({ isNewUser: true });
      }
      // 리다이렉트인 경우 페이지가 이동하므로 여기서 추가 호출 없음 (복귀 시 App에서 intent 복원)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Google 로그인에 실패했습니다.';
      setError(msg);
      setLoading(false);
      submittingRef.current = false;
    }
  };

  /** 인증완료 버튼: 로그인 시도 후 이메일 인증 여부 확인 */
  const handleConfirmVerification = async () => {
    if (!email.trim() || !password) return;
    setError('');
    setLoading(true);
    try {
      const loggedInUser = await login(email, password);
      if (loggedInUser.is_verified !== false) {
        setPendingVerification(false);
        (onAuthSuccess ?? onBack)?.({ isNewUser: true });
      } else {
        setError('이메일에서 인증을 완료해주세요.');
      }
    } catch {
      setError('이메일에서 인증을 완료해주세요.');
    } finally {
      setLoading(false);
    }
  };

  const [resendCooldownSec, setResendCooldownSec] = useState(0);
  const resendCooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startResendCooldown = () => {
    if (resendCooldownRef.current) clearInterval(resendCooldownRef.current);
    setResendCooldownSec(RESEND_COOLDOWN_SEC);
    resendCooldownRef.current = setInterval(() => {
      setResendCooldownSec((s) => {
        if (s <= 1) {
          if (resendCooldownRef.current) {
            clearInterval(resendCooldownRef.current);
            resendCooldownRef.current = null;
          }
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  };

  useEffect(() => {
    return () => {
      if (resendCooldownRef.current) {
        clearInterval(resendCooldownRef.current);
        resendCooldownRef.current = null;
      }
    };
  }, []);

  const handleResendVerification = async () => {
    if (!email.trim() || !password) {
      setError('이메일과 비밀번호를 입력한 뒤 재발송해주세요.');
      return;
    }
    const limit = canResend();
    if (!limit.allowed) {
      setError(limit.message ?? '잠시 후 다시 시도해 주세요.');
      return;
    }
    if (resendCooldownSec > 0) return;
    setResendLoading(true);
    setError('');
    setSuccessMessage('');
    try {
      await resendVerificationEmail(email, password);
      recordResend();
      setSuccessMessage('인증 메일을 다시 보냈습니다. 메일함을 확인해주세요.');
      startResendCooldown();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '재발송에 실패했습니다.';
      setError(msg);
      if (err instanceof AuthError && err.code === 'TOO_MANY_REQUESTS') {
        startResendCooldown();
      }
    } finally {
      setResendLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 overflow-y-auto">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={persistent ? undefined : onBack}
        onKeyDown={persistent ? undefined : (e) => e.key === 'Escape' && onBack?.()}
        role="presentation"
        aria-hidden
      />
      <div className="relative z-10 w-full max-w-4xl grid grid-cols-1 md:grid-cols-2 bg-white rounded-3xl shadow-2xl overflow-hidden min-h-[560px] animate-scale-in my-auto">
        {/* Left: 브랜드 (기존 로그인 페이지와 동일) */}
        <div className="bg-slate-900 p-8 md:p-10 flex flex-col justify-between relative overflow-hidden text-white">
          <div className="absolute top-0 right-0 w-64 h-64 bg-[#0034d3] rounded-full blur-[80px] opacity-20 translate-x-1/2 -translate-y-1/2" aria-hidden />
          <div className="relative z-10">
            <div className="w-10 h-10 bg-[#0034d3] rounded-lg flex items-center justify-center text-white font-black text-xl mb-6 shadow-md">
              <Check size={24} strokeWidth={3} />
            </div>
            <h2 className="text-3xl md:text-4xl font-black mb-6 leading-tight">
              합격으로 가는
              <br />
              가장 빠른 길,
              <br />
              {APP_BRAND}
            </h2>
            <ul className="space-y-4 text-slate-300">
              <li className="flex items-center gap-3">
                <span className="text-[#0034d3]">✓</span> 모든 시험 기록 저장 및 관리
              </li>
              <li className="flex items-center gap-3">
                <span className="text-[#0034d3]">✓</span> 취약점 분석을 통한 정답률 관리
              </li>
              <li className="flex items-center gap-3">
                <span className="text-[#0034d3]">✓</span> 틀린 문제만 모아보는 오답노트
              </li>
            </ul>
          </div>
          <p className="text-xs text-slate-500 relative z-10">© 2026 반지고리. All Rights Reserved.</p>
        </div>

        {/* Right: 폼 (기존 로그인 페이지와 동일) */}
        <div className="p-8 md:p-10 flex flex-col justify-center relative">
          {!persistent && onBack && (
            <button
              type="button"
              onClick={onBack}
              className="absolute top-6 left-6 text-slate-400 hover:text-slate-900"
              aria-label="닫기"
            >
              <ArrowLeft size={20} />
            </button>
          )}
          <div className="mb-6 text-center">
            <h3 className="text-2xl font-black text-slate-900">
              {IS_BETA_GOOGLE_ONLY ? '로그인' : pendingVerification ? '이메일 인증' : mode === 'login' ? '로그인' : '회원가입'}
            </h3>
            {!pendingVerification && (
              <p className="text-slate-400 text-sm mt-1">
                {mode === 'login'
                  ? '학습 기록을 저장하려면 로그인하세요.'
                  : '새 계정을 만들어 학습을 시작하세요.'}
              </p>
            )}
          </div>

          {pendingVerification && !IS_BETA_GOOGLE_ONLY ? (
            <div className="space-y-4">
              <p className="text-xs font-bold text-slate-500 uppercase mb-1">인증 메일을 보낸 주소</p>
              <p className="text-sm font-medium text-slate-800 break-all rounded-lg bg-slate-100 px-3 py-2.5 border border-slate-200">
                {email || '(이메일 없음)'}
              </p>
              {error && <p className="text-sm text-red-600 font-medium">{error}</p>}
              <button
                type="button"
                disabled={loading}
                onClick={handleConfirmVerification}
                className="w-full bg-[#0034d3] text-white font-bold py-4 rounded-xl hover:bg-[#003087] transition-colors shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? '확인 중...' : '인증완료'}
              </button>
              <button
                type="button"
                disabled={resendLoading || resendCooldownSec > 0}
                onClick={handleResendVerification}
                className="w-full py-2.5 text-sm font-bold text-[#0034d3] border border-[#0034d3] rounded-xl hover:bg-[#0034d3]/5 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {resendLoading
                  ? '재발송 중...'
                  : resendCooldownSec > 0
                    ? `${resendCooldownSec}초 후 재발송`
                    : '인증 메일 재발송'}
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={async () => {
                  if (!email.trim() || !password) return;
                  setError('');
                  setLoading(true);
                  try {
                    await deleteUnverifiedAccount(email, password);
                    setPendingVerification(false);
                    setEmail('');
                    setPassword('');
                    setSuccessMessage('');
                  } catch (err) {
                    setError(err instanceof Error ? err.message : '계정 삭제에 실패했습니다. 잠시 후 다시 시도해 주세요.');
                  } finally {
                    setLoading(false);
                  }
                }}
                className="w-full py-2.5 text-sm font-bold text-slate-600 border border-slate-300 rounded-xl hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                이메일 수정 (다른 주소로 다시 가입)
              </button>
            </div>
          ) : IS_BETA_GOOGLE_ONLY ? (
            /* 베타: 구글 로그인만 */
            <div className="space-y-6">
              <p className="text-sm text-slate-600 text-center">
                베타테스터는 구글 로그인만 사용할 수 있습니다.
                <br />
                이메일 가입·인증은 실서버에서만 제공됩니다.
              </p>
              {error && <p className="text-sm text-red-600 font-medium text-center">{error}</p>}
              <button
                type="button"
                disabled={loading}
                onClick={handleGoogleLogin}
                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl border-2 border-slate-200 font-bold text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-colors disabled:opacity-50"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden>
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
                구글로 로그인
              </button>
            </div>
          ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'signup' && (
              <>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">성</label>
                  <input
                    type="text"
                    value={familyName}
                    onChange={(e) => setFamilyName(e.target.value)}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#0034d3] font-medium"
                    placeholder="김"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">이름</label>
                  <input
                    type="text"
                    value={givenName}
                    onChange={(e) => setGivenName(e.target.value)}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#0034d3] font-medium"
                    placeholder="이름"
                    required
                  />
                </div>
              </>
            )}
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#0034d3] font-medium"
                placeholder="email@example.com"
                autoComplete="email"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#0034d3] font-medium"
                placeholder={mode === 'signup' ? '6자 이상' : '비밀번호'}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                required
                minLength={mode === 'signup' ? 6 : undefined}
              />
            </div>
            {successMessage && <p className="text-sm text-emerald-600 font-medium">{successMessage}</p>}
            {error && <p className="text-sm text-red-600 font-medium">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#0034d3] text-white font-bold py-4 rounded-xl hover:bg-[#003087] transition-colors shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (mode === 'login' ? '로그인 중...' : '가입 중...') : (mode === 'login' ? '로그인' : '회원가입')}
            </button>
            {(error && (error.includes('인증') || error.includes('이메일 인증'))) && mode === 'login' && (
              <button
                type="button"
                disabled={resendLoading || resendCooldownSec > 0}
                onClick={handleResendVerification}
                className="w-full mt-2 py-2.5 text-sm font-bold text-[#0034d3] border border-[#0034d3] rounded-xl hover:bg-[#0034d3]/5 disabled:opacity-50"
              >
                {resendLoading ? '재발송 중...' : resendCooldownSec > 0 ? `${resendCooldownSec}초 후 재발송` : '인증 메일 재발송'}
              </button>
            )}
            {successMessage && successMessage.includes('인증 메일') && (
              <button
                type="button"
                disabled={resendLoading || resendCooldownSec > 0}
                onClick={handleResendVerification}
                className="w-full mt-2 py-2.5 text-sm font-bold text-[#0034d3] border border-[#0034d3] rounded-xl hover:bg-[#0034d3]/5 disabled:opacity-50"
              >
                {resendLoading ? '재발송 중...' : resendCooldownSec > 0 ? `${resendCooldownSec}초 후 재발송` : '인증 메일 재발송'}
              </button>
            )}
            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-slate-200" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-white px-3 text-slate-400">또는</span>
              </div>
            </div>
            <button
              type="button"
              disabled={loading}
              onClick={handleGoogleLogin}
              className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl border-2 border-slate-200 font-bold text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-colors disabled:opacity-50"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden>
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              구글로 로그인
            </button>
          </form>
          )}
          <div className="mt-6 text-center text-sm">
            {IS_BETA_GOOGLE_ONLY ? null : mode === 'login' ? (
              <>
                <span className="text-slate-400">계정이 없으신가요? </span>
                <button type="button" onClick={() => { setMode('signup'); setPendingVerification(false); setError(''); setSuccessMessage(''); setLoading(false); submittingRef.current = false; }} className="font-bold text-[#003087] hover:underline">
                  회원가입
                </button>
              </>
            ) : !pendingVerification ? (
              <>
                <span className="text-slate-400">이미 계정이 있으신가요? </span>
                <button type="button" onClick={() => { setMode('login'); setError(''); setSuccessMessage(''); setLoading(false); submittingRef.current = false; }} className="font-bold text-[#003087] hover:underline">
                  로그인
                </button>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
};
