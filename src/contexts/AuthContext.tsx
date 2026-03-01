import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, type User as FirebaseUser } from 'firebase/auth';
import { auth } from '../firebase';
import { User } from '../types';
import { loginWithEmailPassword, logoutUser, getSessionForCurrentAuth, registerWithEmailAndPassword, loginWithGoogle, getGoogleRedirectUser, resendVerificationEmail } from '../services/authService';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  /** 로그인 성공 시 해당 User 반환 (guestContinue 플로우에서 is_verified 확인용) */
  login: (email: string, password: string) => Promise<User>;
  register: (email: string, password: string, familyName: string, givenName: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  resendVerificationEmail: (email: string, password: string) => Promise<void>;
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

  const loginWithGoogleHandler = () => {
    loginWithGoogle(); // 리다이렉트 발생 → 복귀 시 getGoogleRedirectUser로 처리
  };

  const resendVerification = async (email: string, password: string) => {
    await resendVerificationEmail(email, password);
  };

  const logout = async () => {
    await logoutUser();
    setUser(null);
  };

  useEffect(() => {
    let cancelled = false;

    getGoogleRedirectUser()
      .then((appUser) => {
        if (cancelled) return;
        if (appUser) {
          setUser(appUser);
          setLoading(false);
        }
      })
      .catch(() => {});

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser: FirebaseUser | null) => {
      if (!firebaseUser) {
        setUser(null);
        setLoading(false);
        return;
      }

      try {
        const appUser = await getSessionForCurrentAuth(firebaseUser.uid);
        setUser(appUser);
        if (!appUser) setUser(null);
      } catch {
        setUser(null);
      } finally {
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
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
