import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, type User as FirebaseUser } from 'firebase/auth';
import { auth } from '../firebase';
import { User } from '../types';
import { loginWithEmailPassword, logoutUser, getSessionForCurrentAuth, registerWithEmailAndPassword, loginWithGoogle, resendVerificationEmail } from '../services/authService';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, familyName: string, givenName: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  resendVerificationEmail: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  updateUser: (updater: (prev: User) => User) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const login = async (email: string, password: string) => {
    const appUser = await loginWithEmailPassword(email, password);
    setUser(appUser);
  };

  const register = async (email: string, password: string, familyName: string, givenName: string) => {
    await registerWithEmailAndPassword(email, password, familyName, givenName);
    setUser(null);
  };

  const loginWithGoogleHandler = async () => {
    const appUser = await loginWithGoogle();
    setUser(appUser);
  };

  const resendVerification = async (email: string, password: string) => {
    await resendVerificationEmail(email, password);
  };

  const logout = async () => {
    await logoutUser();
    setUser(null);
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser: FirebaseUser | null) => {
      if (!firebaseUser) {
        setUser(null);
        setLoading(false);
        return;
      }

      try {
        const appUser = await getSessionForCurrentAuth(firebaseUser.uid);
        setUser(appUser);
        // 세션이 없어도 즉시 로그아웃하지 않음 — 회원가입 직후 setDoc 전에 여기 올 수 있어, 로그아웃하면 setDoc 권한 오류 발생
        if (!appUser) {
          setUser(null);
        }
      } catch {
        setUser(null);
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  const updateUser = (updater: (prev: User) => User) => {
    setUser((prev) => (prev ? updater(prev) : null));
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
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
