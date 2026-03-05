/**
 * 앱 공통 초기화·가드: document.title, index 동기화, 전역 에러 로깅, 라우트별 보정.
 */
import { useEffect } from 'react';
import { CERTIFICATIONS } from '../constants';
import { syncQuestionIndex } from '../services/db/localCacheDB';
import { logClientError } from '../services/errorLogService';
import { invalidateMyPageCache } from '../services/db/localCacheDB';
import { APP_BRAND } from '../config/brand';
import type { Route } from './useAppNavigation';
import type { User } from '../types';

export interface UseAppBootstrapParams {
  route: Route;
  user: User | null;
  selectedCertId: string | null;
  setSelectedCertId: (v: string | null) => void;
}

export function useAppBootstrap(params: UseAppBootstrapParams): void {
  const { route, user, selectedCertId, setSelectedCertId } = params;

  useEffect(() => {
    document.title = `${APP_BRAND} - 합격으로 가는 가장 빠른 길`;
  }, []);

  useEffect(() => {
    syncQuestionIndex('BIGDATA').catch(() => {});
  }, []);

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

  useEffect(() => {
    if (route !== '/result' || !user?.id || !selectedCertId) return;
    const certCode = CERTIFICATIONS.find((c) => c.id === selectedCertId)?.code;
    if (certCode) invalidateMyPageCache(user.id, certCode).catch(() => {});
  }, [route, user?.id, selectedCertId]);

  useEffect(() => {
    if (route !== '/exam-list' || selectedCertId) return;
    const fallback =
      user?.subscriptions?.[0]?.id ?? user?.paidCertIds?.[0] ?? CERTIFICATIONS[0]?.id;
    if (fallback) setSelectedCertId(fallback);
  }, [route, selectedCertId, user?.subscriptions, user?.paidCertIds, setSelectedCertId]);
}
