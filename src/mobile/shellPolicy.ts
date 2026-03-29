import type { Route } from '../hooks/useAppNavigation';

/** 라우트 기준 콘텐츠 셸(페이지 몰입도). 모달 셸과는 별개. */
export type MobileRouteShellKind = 'default' | 'immersive';

/** 화면을 덮는 전역 플로우(로그인·결제 등). 한 번에 하나만 primary 로 둔다. */
export type MobileGlobalOverlayKind =
  | 'none'
  | 'orientation'
  | 'login'
  | 'checkout'
  | 'verification'
  | 'signup_success';

/**
 * 퀴즈·결과는 상·하단 네비와 스크롤 정책이 다름 → immersive.
 */
export function getMobileRouteShellKind(route: Route): MobileRouteShellKind {
  if (route === '/quiz' || route === '/result') return 'immersive';
  return 'default';
}

/**
 * 모바일에서 앱 셸(헤더·하단 탭)을 숨길지 여부.
 * 전역 플로우가 켜지면 배경은 유지하되 셸 크롬만 제거해 이중 헤더/탭을 막는다.
 */
export function getPrimaryMobileGlobalOverlay(params: {
  isMobile: boolean;
  showOrientationPopup: unknown;
  showLoginModal: boolean;
  showCheckoutModal: boolean;
  showResendVerificationModal: boolean;
  showSignupSuccessModal: boolean;
}): MobileGlobalOverlayKind {
  if (!params.isMobile) return 'none';
  if (params.showOrientationPopup) return 'orientation';
  if (params.showLoginModal) return 'login';
  if (params.showCheckoutModal) return 'checkout';
  if (params.showResendVerificationModal) return 'verification';
  if (params.showSignupSuccessModal) return 'signup_success';
  return 'none';
}

export function shouldSuppressMobileShellChrome(overlay: MobileGlobalOverlayKind): boolean {
  return overlay !== 'none';
}

/** 향후 모달·시트 z-index 정렬용(한 레이어에 하나의 인터랙티브 오버레이). */
export const MOBILE_Z_INDEX = {
  shellHeader: 40,
  drawerBackdrop: 85,
  drawerPanel: 90,
  sheet: 95,
  modal: 100,
  modalElevated: 110,
  modalAuth: 120,
} as const;
