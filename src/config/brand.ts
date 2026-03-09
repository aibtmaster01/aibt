/**
 * 빌드 모드별 브랜드/기능 플래그 (실서버=핀셋, 베타=AiBT + 쿠폰)
 */
const raw = import.meta.env.VITE_APP_BRAND as string | undefined;
export const APP_BRAND: string = typeof raw === 'string' && raw.trim() ? raw.trim() : '핀셋';

/** 랜딩 상단 문구: 실서버 "핀셋-MVP", 베타 "AiBT" */
export const APP_BRAND_LANDING: string = APP_BRAND === 'AiBT' ? 'AiBT' : '핀셋-MVP';

/** 베타 전용 쿠폰 노출 여부 */
export const FEATURE_COUPON: boolean = import.meta.env.VITE_FEATURE_COUPON === 'true';

/** 베타 로컬 전용: 레벨 선택·저장 등 새 플로우 (배포 베타 서버에는 미적용) */
export const isBetaLocal: boolean =
  import.meta.env.DEV && (FEATURE_COUPON || APP_BRAND === 'AiBT');

/** 베타 로컬에서만 certifications_beta 사용. 베타 실서버는 certifications 유지(신뢰도 보호) */
export const useBetaCertifications: boolean = isBetaLocal;

/** Firestore certifications 컬렉션명. 베타일 때 BIGDATA는 certifications_beta 사용 */
export function getCertificationsCollection(certCode: string): 'certifications' | 'certifications_beta' {
  return useBetaCertifications && certCode === 'BIGDATA' ? 'certifications_beta' : 'certifications';
}

/** 실서버 호스트 (관리자 화면 노출용). 이 호스트에서만 관리자 메뉴·라우트 표시 */
const PRODUCTION_HOST = (import.meta.env.VITE_PRODUCTION_HOST as string) || 'aibt-99bc6.web.app';

/** 현재 접속이 실서버인지. 관리자 화면은 실서버에서만 노출 */
export function isProductionHost(): boolean {
  if (typeof window === 'undefined') return false;
  return window.location.hostname === PRODUCTION_HOST;
}

/** 관리자 메뉴/라우트 노출 여부 (실서버 + isAdmin) */
export function canShowAdmin(user: { isAdmin?: boolean } | null): boolean {
  return !!(user?.isAdmin && isProductionHost());
}
