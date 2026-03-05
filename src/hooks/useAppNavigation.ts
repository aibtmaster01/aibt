/**
 * 앱 라우팅: route 상태, navigate, navigateToAuth.
 * 로그인/결제 등 모달·URL 파라미터 분기는 navigate 내부에서 처리.
 */
import { useState, useCallback } from 'react';
import type { User } from '../types';
import type { LoginModalIntent } from '../components/LoginModal';

export type Route =
  | '/'
  | '/mypage'
  | '/account-settings'
  | '/exam-list'
  | '/quiz'
  | '/result'
  | '/admin'
  | '/admin/certs'
  | '/admin/questions'
  | '/admin/billing';

export interface UseAppNavigationParams {
  user: User | null;
  setLoginInitialMode: (v: 'login' | 'signup' | null) => void;
  setShowLoginModal: (v: boolean) => void;
  setLoginModalIntent: (v: LoginModalIntent | null) => void;
  setSelectedCertId: (v: string | null) => void;
  setSelectedRoundId: (v: string | null) => void;
  setShowCheckoutModal: (v: boolean) => void;
}

export interface UseAppNavigationReturn {
  route: Route;
  setRoute: (r: Route) => void;
  navigate: (path: string) => void;
  navigateToAuth: (mode: 'login' | 'signup') => void;
}

export function useAppNavigation(params: UseAppNavigationParams): UseAppNavigationReturn {
  const {
    user,
    setLoginInitialMode,
    setShowLoginModal,
    setLoginModalIntent,
    setSelectedCertId,
    setSelectedRoundId,
    setShowCheckoutModal,
  } = params;

  const [route, setRouteState] = useState<Route>('/');

  const setRoute = useCallback((r: Route) => {
    setRouteState(r);
  }, []);

  const navigate = useCallback(
    (path: string) => {
      if (path !== '/login') setLoginInitialMode(null);
      const [pathname, search] = path.includes('?') ? path.split('?') : [path, ''];
      const params = new URLSearchParams(search);
      if (pathname === '/login') {
        setLoginInitialMode('login');
        setShowLoginModal(true);
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
      if (pathname === '/checkout') {
        setShowCheckoutModal(true);
        return;
      }
      const needsLogin =
        pathname === '/mypage' ||
        pathname === '/account-settings' ||
        pathname.startsWith('/admin');
      if (needsLogin && !user) {
        setLoginInitialMode('login');
        setShowLoginModal(true);
        setLoginModalIntent('standalone');
        setRouteState(pathname === '/mypage' ? '/' : (pathname as Route));
        return;
      }
      setRouteState(pathname as Route);
      window.scrollTo(0, 0);
    },
    [
      user,
      route,
      setLoginInitialMode,
      setShowLoginModal,
      setLoginModalIntent,
      setSelectedCertId,
      setSelectedRoundId,
      setShowCheckoutModal,
    ]
  );

  const navigateToAuth = useCallback(
    (mode: 'login' | 'signup') => {
      setLoginInitialMode(mode);
      setShowLoginModal(true);
      setLoginModalIntent('standalone');
      window.scrollTo(0, 0);
    },
    [setLoginInitialMode, setShowLoginModal, setLoginModalIntent]
  );

  return { route, setRoute, navigate, navigateToAuth };
}
