/**
 * 빌드 모드별 브랜드/기능 플래그.
 */
const raw = import.meta.env.VITE_APP_BRAND as string | undefined;
export const APP_BRAND: string = typeof raw === 'string' && raw.trim() ? raw.trim() : '핀셋';

/** 랜딩 상단 문구 */
export const APP_BRAND_LANDING: string = APP_BRAND === 'AiBT' ? 'AiBT' : '핀셋-MVP';

/** 쿠폰 노출 여부 (AiBT 빌드에서 보통 true) */
export const FEATURE_COUPON: boolean = import.meta.env.VITE_FEATURE_COUPON === 'true';

/** AiBT 빌드 여부. 난이도 선택·MyPageBeta·레벨드 진단·40/80 선택 등 적용 */
export const useBetaCertifications: boolean = APP_BRAND === 'AiBT';

/**
 * 결제·이용권·쿠폰·열공 업셀 등 상용 구독 카피/CTA 노출.
 * AiBT 베타 빌드에서는 false로 두고, 정책성 마케팅 문구만 숨긴다(학습 UX·잠금 규칙 로직은 유지).
 */
export const showCommercialSubscriptionCopy: boolean = !useBetaCertifications;

/** Firestore certifications 컬렉션명 */
export function getCertificationsCollection(_certCode: string): 'certifications' {
  return 'certifications';
}

/** 실서버 호스트 (관리자 화면 노출용). 이 호스트에서만 관리자 메뉴·라우트 표시 */
const PRODUCTION_HOST = (import.meta.env.VITE_PRODUCTION_HOST as string) || 'aibt-99bc6.web.app';

/** 현재 접속이 실서버인지. 관리자 화면은 실서버에서만 노출 */
export function isProductionHost(): boolean {
  if (typeof window === 'undefined') return false;
  return window.location.hostname === PRODUCTION_HOST;
}

/** 관리자 메뉴/라우트 노출 여부. Firestore users 문서의 isAdmin === true 이면 관리자 화면 노출 (호스트 무관). */
export function canShowAdmin(user: { isAdmin?: boolean } | null): boolean {
  return !!user?.isAdmin;
}
