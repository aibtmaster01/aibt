import React from "react";
import { LayoutDashboard, ClipboardList } from "lucide-react";
import type { User } from "../types";
import type { Route } from "../hooks/useAppNavigation";
import type { MobileRouteShellKind } from "../mobile/shellPolicy";
import { MobileHeader } from "./mobile/MobileHeader";
import { MobilePageContainer } from "./mobile/MobilePageContainer";

export type { MobileRouteShellKind };

export interface MobileAppShellProps {
  title: string;
  onOpenMenu: () => void;
  children: React.ReactNode;
  showBottomNav: boolean;
  route: Route;
  examListHref: string;
  onNavigate: (path: string) => void;
  user: User | null;
  /** 라우트 성격: default(일반 스크롤) | immersive(퀴즈/결과) */
  routeShell: MobileRouteShellKind;
  /**
   * 전역 모달 셸(login/checkout/오리엔테이션 등) 활성 시:
   * 앱 헤더·하단 탭을 숨겨 배경과 오버레이의 이중 크롬을 막는다.
   */
  suppressChrome?: boolean;
  /** immersive + 퀴즈: 페이지 자체 상단 바만 사용 */
  hideAppBar?: boolean;
}

/**
 * 모바일 전용 앱 셸. 데스크톱에서는 부모가 md:hidden 으로 감싼다.
 */
export function MobileAppShell({
  title,
  onOpenMenu,
  children,
  showBottomNav,
  route,
  examListHref,
  onNavigate,
  user,
  routeShell,
  suppressChrome = false,
  hideAppBar = false,
}: MobileAppShellProps) {
  const homeActive = route === "/" || route === "/mypage";
  const examActive = route === "/exam-list";

  const pageVariant = routeShell === "immersive" ? "immersive" : "scroll";
  const showAppHeader = !suppressChrome && !hideAppBar;
  const showTabBar = !suppressChrome && showBottomNav && user;

  return (
    <div className="flex md:hidden flex-1 flex-col min-h-0 w-full bg-[#edf1f5]">
      {showAppHeader && <MobileHeader title={title} onOpenMenu={onOpenMenu} />}
      <MobilePageContainer variant={pageVariant}>{children}</MobilePageContainer>
      {showTabBar && (
        <nav
          className="shrink-0 flex border-t border-slate-200 bg-white/95 backdrop-blur-md pb-[max(0.25rem,env(safe-area-inset-bottom))]"
          aria-label="주요 메뉴"
        >
          <button
            type="button"
            onClick={() => onNavigate("/")}
            className={`flex-1 min-h-[52px] flex flex-col items-center justify-center gap-0.5 text-xs font-semibold transition-colors ${
              homeActive ? "text-[#1e56cd]" : "text-slate-500 active:text-[#1e56cd]"
            }`}
          >
            <LayoutDashboard className="w-6 h-6" strokeWidth={2} />
            학습 홈
          </button>
          <button
            type="button"
            onClick={() => onNavigate(examListHref)}
            className={`flex-1 min-h-[52px] flex flex-col items-center justify-center gap-0.5 text-xs font-semibold transition-colors ${
              examActive ? "text-[#1e56cd]" : "text-slate-500 active:text-[#1e56cd]"
            }`}
          >
            <ClipboardList className="w-6 h-6" strokeWidth={2} />
            모의고사
          </button>
        </nav>
      )}
    </div>
  );
}
