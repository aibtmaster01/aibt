/**
 * 빌드 모드별 브랜드/기능 플래그 (실서버=핀셋, 베타=AiBT + 쿠폰)
 */
const raw = import.meta.env.VITE_APP_BRAND as string | undefined;
export const APP_BRAND: string = typeof raw === 'string' && raw.trim() ? raw.trim() : '핀셋';

/** 랜딩 상단 문구: 실서버 "핀셋-MVP", 베타 "AiBT" */
export const APP_BRAND_LANDING: string = APP_BRAND === 'AiBT' ? 'AiBT' : '핀셋-MVP';

/** 베타 전용 쿠폰 노출 여부 */
export const FEATURE_COUPON: boolean = import.meta.env.VITE_FEATURE_COUPON === 'true';
