import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, type User as FirebaseUser } from 'firebase/auth';
import { auth } from '../firebase';
import { User } from '../types';
import { loginWithEmailPassword, logoutUser, getSessionForCurrentAuth, registerWithEmailAndPassword, loginWithGoogle, getGoogleRedirectUser, resendVerificationEmail, deleteUnverifiedUser, type GoogleRedirectIntent } from '../services/authService';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  /** 로그인 성공 시 해당 User 반환 (guestContinue 플로우에서 is_verified 확인용) */
  login: (email: string, password: string) => Promise<User>;
  register: (email: string, password: string, familyName: string, givenName: string) => Promise<void>;
  /** 구글 로그인. intentData 있으면 리다이렉트 시 저장. 팝업 성공 시 User 반환, 리다이렉트 시 void. */
  loginWithGoogle: (intentData?: GoogleRedirectIntent) => Promise<User | void>;
  resendVerificationEmail: (email: string, password: string) => Promise<void>;
  /** 미인증 계정 삭제 (이메일 수정 시 다른 주소로 다시 가입용) */
  deleteUnverifiedAccount: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  updateUser: (updater: (prev: User) => User) => void;
  /** Firestore에서 현재 유저 정보 재조회 (결제 완료 등 상태 반영용) */
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const login = async (email: string, password: string): Promise<User> => {
    const appUser = await loginWithEmailPassword(email, password);
    setUser(appUser);
    return appUser;
  };

  const register = async (email: string, password: string, familyName: string, givenName: string) => {
    await registerWithEmailAndPassword(email, password, familyName, givenName);
    setUser(null);
  };

  const loginWithGoogleHandler = async (intentData?: GoogleRedirectIntent): Promise<User | void> => {
    const appUser = await loginWithGoogle(intentData);
    if (appUser) setUser(appUser);
    return appUser;
  };

  const resendVerification = async (email: string, password: string) => {
    await resendVerificationEmail(email, password);
  };

  const deleteUnverifiedAccount = async (email: string, password: string) => {
    await deleteUnverifiedUser(email, password);
  };

  const logout = async () => {
    await logoutUser();
    setUser(null);
  };

  // 리다이렉트 복귀 시 getRedirectResult를 먼저 처리한 뒤 onAuthStateChanged 구독 (신규 구글 유저 Firestore 생성 후 세션 반영)
  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    getGoogleRedirectUser()
      .then((appUser) => {
        if (cancelled) return;
        if (appUser) setUser(appUser);
      })
      .catch(() => {})
      .finally(() => {
        if (cancelled) return;
        // loading은 onAuthStateChanged 첫 콜백 이후에만 false로 (persistence 복구 후 로그인 모달이 잠깐 뜨는 것 방지)
        unsubscribe = onAuthStateChanged(auth, async (firebaseUser: FirebaseUser | null) => {
          if (!firebaseUser) {
            setUser(null);
            setLoading(false);
            return;
          }
          try {
            const appUser = await getSessionForCurrentAuth(firebaseUser.uid);
            setUser(appUser ?? null);
          } catch {
            setUser(null);
          } finally {
            setLoading(false);
          }
        });
      });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  const updateUser = (updater: (prev: User) => User) => {
    setUser((prev) => (prev ? updater(prev) : null));
  };

  const refreshUser = async () => {
    const fb = auth.currentUser;
    if (!fb) return;
    try {
      const appUser = await getSessionForCurrentAuth(fb.uid);
      if (appUser) setUser(appUser);
    } catch {
      // 유지
    }
  };

  const value: AuthContextValue = {
    user,
    loading,
    login,
    register,
    loginWithGoogle: loginWithGoogleHandler,
    resendVerificationEmail: resendVerification,
    deleteUnverifiedAccount,
    logout,
    updateUser,
    refreshUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
