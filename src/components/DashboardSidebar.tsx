import React, { useState, useRef, useEffect } from "react";
import {
  List,
  LogOut,
  LogIn,
  LayoutDashboard,
  Database,
  Code,
  FileText,
  Settings,
  Users,
  BookOpen,
  Ticket,
  HelpCircle,
  X,
  ClipboardList,
  ChevronDown,
} from "lucide-react";
import { CERTIFICATIONS, DISABLED_CERT_IDS } from "../constants";
import { APP_BRAND, FEATURE_COUPON, canShowAdmin } from "../config/brand";
import { getCertDisplayName } from "../services/gradingService";
import { useAllCertificationInfos } from "../hooks/useCertificationInfo";
import type { User } from "../types";

const AVATAR_COLORS = ['#0034d3', '#003087', '#3399ff', '#ef4444', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899'];
function getAvatarColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = ((hash << 5) - hash) + userId.charCodeAt(i);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export interface DashboardSidebarProps {
  user: User | null;
  certId: string | null;
  currentPath: string;
  onNavigate: (path: string) => void;
  onLogout?: () => void;
  onOpenCoupon?: () => void;
  onOpenOrientation?: () => void;
  /** 모바일: 앱 바 햄버거로 열리는 단일 드로어(자격증·계정·관리 통합) */
  mobileDrawerOpen?: boolean;
  onMobileDrawerClose?: () => void;
}

const certIconMap: Record<string, React.ReactNode> = {
  BIGDATA: <Database className="h-5 w-5" />,
  SQLD: <Code className="h-5 w-5" />,
  ADSP: <FileText className="h-5 w-5" />,
};

/** 모바일 드로어: 섹션 제목 (depth 1 라벨) */
function MobileDrawerSectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-3 pt-4 pb-2 text-[11px] font-bold uppercase tracking-wider text-white/55 first:pt-1">
      {children}
    </p>
  );
}

export function DashboardSidebar({
  user,
  certId,
  currentPath,
  onNavigate,
  onLogout,
  onOpenCoupon,
  onOpenOrientation,
  mobileDrawerOpen = false,
  onMobileDrawerClose,
}: DashboardSidebarProps) {
  const [listPopupOpen, setListPopupOpen] = useState(false);
  const [profilePopupOpen, setProfilePopupOpen] = useState(false);
  /** 모바일: 자격증 목록 아코디언 (2단계: 헤더 → 항목) */
  const [mobileCertPickerOpen, setMobileCertPickerOpen] = useState(true);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const listPopupRef = useRef<HTMLDivElement>(null);
  const profilePopupRef = useRef<HTMLDivElement>(null);
  const { certInfos } = useAllCertificationInfos();

  useEffect(() => {
    if (!listPopupOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (listPopupRef.current && !listPopupRef.current.contains(e.target as Node)) {
        setListPopupOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [listPopupOpen]);

  useEffect(() => {
    if (!profilePopupOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (profilePopupRef.current && !profilePopupRef.current.contains(e.target as Node)) {
        setProfilePopupOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [profilePopupOpen]);

  /** 성 빼고 이름 두글자 (김철수 → 철수) */
  const initials = user
    ? (user.givenName
        ? user.givenName.slice(0, 2)
        : user.name.length > 1 ? user.name.slice(1).slice(0, 2) : user.name.slice(0, 2)
      ) || '학습'
    : '?';
  const avatarBg = user ? getAvatarColor(user.id) : '#94a3b8';

  const closeMobileDrawer = () => {
    onMobileDrawerClose?.();
  };

  useEffect(() => {
    if (!mobileDrawerOpen || typeof document === "undefined") return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileDrawerOpen]);

  /** 드로어·데스크톱 팝업 공통 행 스타일 */
  const drawerNavBtn =
    "flex w-full min-h-[48px] items-center gap-3 rounded-xl px-3 text-left text-[15px] font-semibold text-white transition-colors hover:bg-white/10 active:bg-white/15";

  const activeCertLabel = !canShowAdmin(user)
    ? CERTIFICATIONS.find((c) => c.id === certId)
    : null;

  return (
    <>
    {/* ─── 데스크톱: 세로 아이콘 바 + 우측 팝업 (기존 패턴 유지) ─── */}
    <aside className="hidden md:flex h-full bg-[#1e56cd] w-16 md:w-20 flex-shrink-0 flex-col items-center py-6 md:py-8">
      <button
        type="button"
        onClick={() => onNavigate(user ? '/' : '/exam-list')}
        className="text-white font-black text-sm md:text-base mb-6 md:mb-8 tracking-tight"
      >
        {APP_BRAND}
      </button>
      {user && (
        <div ref={profilePopupRef} className="relative shrink-0">
          <button
            type="button"
            onClick={() => setProfilePopupOpen((v) => !v)}
            className="w-10 h-10 md:w-12 md:h-12 rounded-full flex items-center justify-center shadow-lg text-white font-bold text-sm md:text-base shrink-0 hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-white/50"
            style={{ backgroundColor: avatarBg }}
            aria-label="프로필 메뉴"
          >
            {initials}
          </button>
          {profilePopupOpen && (
            <div className="absolute left-full top-0 ml-3 mt-0 min-w-[160px] py-2 bg-white rounded-xl border border-slate-200 shadow-xl z-50">
              <button
                type="button"
                onClick={() => {
                  onNavigate("/account-settings");
                  setProfilePopupOpen(false);
                }}
                className="w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50 rounded-lg"
              >
                <Settings size={16} /> 계정설정
              </button>
              {FEATURE_COUPON && onOpenCoupon && (
                <button
                  type="button"
                  onClick={() => {
                    setProfilePopupOpen(false);
                    onOpenCoupon();
                  }}
                  className="w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50 rounded-lg"
                >
                  <Ticket size={16} /> 쿠폰 등록
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setProfilePopupOpen(false);
                  setShowLogoutConfirm(true);
                }}
                className="w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm font-semibold text-slate-600 hover:bg-slate-50 rounded-lg"
              >
                <LogOut size={16} /> 로그아웃
              </button>
            </div>
          )}
        </div>
      )}

      {!canShowAdmin(user) && (
        <div ref={listPopupRef} className={`relative ${user ? "mt-8 md:mt-12" : "mt-6 md:mt-8"}`}>
          <button
            type="button"
            onClick={() => setListPopupOpen((v) => !v)}
            className={`text-white/80 hover:text-white ${listPopupOpen ? "text-white" : ""}`}
            aria-label="자격증 선택"
          >
            <List className="w-6 h-6 md:w-8 md:h-8" />
          </button>
          {listPopupOpen && (
            <div className="absolute left-full top-0 ml-3 mt-0 min-w-[200px] py-2 bg-white rounded-xl border border-slate-200 shadow-xl z-50">
              <p className="px-4 py-2 text-xs font-bold text-slate-400 uppercase">자격증 선택</p>
              {CERTIFICATIONS.map((certItem) => {
                const isDisabled = DISABLED_CERT_IDS.includes(certItem.id);
                return (
                  <button
                    key={certItem.id}
                    type="button"
                    onClick={() => {
                      if (!isDisabled) {
                        onNavigate(`/mypage?cert=${certItem.id}`);
                        setListPopupOpen(false);
                      }
                    }}
                    disabled={isDisabled}
                    className={`w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm font-semibold transition-colors ${
                      certId === certItem.id
                        ? "bg-[#99ccff] text-[#0034d3]"
                        : isDisabled
                          ? "text-slate-300 cursor-not-allowed"
                          : "text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${isDisabled ? "bg-slate-100 text-slate-300" : "bg-[#99ccff] text-[#0034d3]"}`}>
                      {certIconMap[certItem.code] ?? <FileText className="h-5 w-5" />}
                    </div>
                    <span>{getCertDisplayName(certItem, certInfos[certItem.code] ?? null)}</span>
                    {isDisabled && <span className="text-[10px] text-slate-400 ml-auto">준비 중</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
      {user && (
        <button
          type="button"
          onClick={() => onNavigate('/mypage')}
          className={`${canShowAdmin(user) ? 'mt-8 md:mt-12' : 'mt-6 md:mt-8'} ${currentPath === '/mypage' || currentPath === '/' ? "text-white" : "text-white/80 hover:text-white"}`}
          aria-label="학습 홈"
        >
          <LayoutDashboard className="w-6 h-6 md:w-8 md:h-8" strokeWidth={2} />
        </button>
      )}
      {canShowAdmin(user) && (
        <>
          <button
            type="button"
            onClick={() => onNavigate('/admin')}
            className={`mt-6 md:mt-8 ${currentPath === '/admin' ? "text-white" : "text-white/80 hover:text-white"}`}
            aria-label="회원 관리"
          >
            <Users className="w-6 h-6 md:w-8 md:h-8" strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={() => onNavigate('/admin/certs')}
            className={`mt-6 md:mt-8 ${currentPath === '/admin/certs' ? "text-white" : "text-white/80 hover:text-white"}`}
            aria-label="자격증 관리"
          >
            <List className="w-6 h-6 md:w-8 md:h-8" strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={() => onNavigate('/admin/questions')}
            className={`mt-6 md:mt-8 ${currentPath === '/admin/questions' ? "text-white" : "text-white/80 hover:text-white"}`}
            aria-label="문제 관리"
          >
            <BookOpen className="w-6 h-6 md:w-8 md:h-8" strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={() => onNavigate('/admin/billing')}
            className={`mt-6 md:mt-8 ${currentPath === '/admin/billing' ? "text-white" : "text-white/80 hover:text-white"}`}
            aria-label="쿠폰 관리"
          >
            <Ticket className="w-6 h-6 md:w-8 md:h-8" strokeWidth={2} />
          </button>
        </>
      )}

      <div className="flex-1 min-h-[24px]" />

      {user && onOpenOrientation && (
        <button
          type="button"
          onClick={onOpenOrientation}
          className="text-white/80 hover:text-white mb-4"
          aria-label="핵심 기능 가이드"
        >
          <HelpCircle className="w-6 h-6 md:w-8 md:h-8" />
        </button>
      )}

      {!user && (
        <button
          type="button"
          onClick={() => onNavigate("/login")}
          className="text-white/90 hover:text-white"
          aria-label="로그인"
        >
          <LogIn className="w-6 h-6 md:w-8 md:h-8" />
        </button>
      )}
    </aside>

    {showLogoutConfirm && (
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
        <div
          className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm animate-fade-in"
          onClick={() => setShowLogoutConfirm(false)}
          aria-hidden
        />
        <div className="relative z-10 w-full max-w-[340px] rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden animate-slide-up">
          <div className="p-6 text-center">
            <p className="text-base font-bold text-slate-800">로그아웃 하시겠습니까?</p>
            <p className="mt-1 text-sm text-slate-500">다시 로그인하면 학습 이력이 유지됩니다.</p>
          </div>
          <div className="flex border-t border-slate-100">
            <button
              type="button"
              onClick={() => setShowLogoutConfirm(false)}
              className="flex-1 py-3.5 text-sm font-bold text-slate-600 hover:bg-slate-50 transition-colors"
            >
              취소
            </button>
            <button
              type="button"
              onClick={() => {
                setShowLogoutConfirm(false);
                onLogout?.();
                closeMobileDrawer();
              }}
              className="flex-1 py-3.5 text-sm font-bold text-[#0034d3] hover:bg-[#99ccff]/30 transition-colors"
            >
              로그아웃
            </button>
          </div>
        </div>
      </div>
    )}

    {/* ─── 모바일: 단일 좌측 드로어 (팝업 없음 — 자격증·프로필 액션 통합) ─── */}
    {mobileDrawerOpen && onMobileDrawerClose && (
      <div className="md:hidden fixed inset-0 z-[90]">
        <button
          type="button"
          className="absolute inset-0 bg-slate-900/45"
          aria-label="메뉴 닫기"
          onClick={closeMobileDrawer}
        />
        <aside
          className="absolute left-0 top-0 bottom-0 w-[min(320px,92vw)] bg-[#1e56cd] shadow-2xl flex flex-col overflow-hidden pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]"
          aria-modal="true"
          role="dialog"
          aria-labelledby="mobile-drawer-title"
        >
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-white/15 shrink-0">
            <span id="mobile-drawer-title" className="text-white font-black text-lg tracking-tight">
              {APP_BRAND}
            </span>
            <button
              type="button"
              onClick={closeMobileDrawer}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-white/90 hover:bg-white/10"
              aria-label="닫기"
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-2 pb-3">
            {user && (
              <div className="px-2 py-4 border-b border-white/10 mb-1">
                <div className="flex items-center gap-3 min-h-[48px]">
                  <div
                    className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold shadow-lg shrink-0"
                    style={{ backgroundColor: avatarBg }}
                    aria-hidden
                  >
                    {initials}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-white font-bold text-sm truncate">{user.name || "학습자"}</p>
                    {user.email && (
                      <p className="text-white/65 text-xs truncate">{user.email}</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            <nav className="flex flex-col" aria-label="모바일 메뉴">
              <MobileDrawerSectionTitle>바로 가기</MobileDrawerSectionTitle>
              {user && (
                <button
                  type="button"
                  className={drawerNavBtn}
                  onClick={() => {
                    onNavigate("/mypage");
                    closeMobileDrawer();
                  }}
                >
                  <LayoutDashboard className="w-5 h-5 shrink-0 opacity-95" />
                  학습 홈
                </button>
              )}
              <button
                type="button"
                className={drawerNavBtn}
                onClick={() => {
                  onNavigate(user && certId ? `/exam-list?cert=${certId}` : "/exam-list");
                  closeMobileDrawer();
                }}
              >
                <ClipboardList className="w-5 h-5 shrink-0 opacity-95" />
                모의고사 목록
              </button>

              {!canShowAdmin(user) && (
                <>
                  <MobileDrawerSectionTitle>자격증</MobileDrawerSectionTitle>
                  <div className="rounded-xl bg-white/5 border border-white/10 overflow-hidden mx-1">
                    <button
                      type="button"
                      onClick={() => setMobileCertPickerOpen((v) => !v)}
                      className="flex w-full min-h-[48px] items-center gap-2 px-3 text-left text-white font-semibold text-[14px] hover:bg-white/10"
                      aria-expanded={mobileCertPickerOpen}
                    >
                      <ChevronDown
                        className={`w-5 h-5 shrink-0 transition-transform ${mobileCertPickerOpen ? "rotate-0" : "-rotate-90"}`}
                      />
                      <span className="flex-1 truncate">
                        {activeCertLabel
                          ? getCertDisplayName(activeCertLabel, certInfos[activeCertLabel.code] ?? null)
                          : "자격증 선택"}
                      </span>
                    </button>
                    {mobileCertPickerOpen && (
                      <ul className="border-t border-white/10 py-1 pb-2" role="list">
                        {CERTIFICATIONS.map((c) => {
                          const isDisabled = DISABLED_CERT_IDS.includes(c.id);
                          return (
                            <li key={c.id}>
                              <button
                                type="button"
                                disabled={isDisabled}
                                className={`flex w-full min-h-[48px] items-center gap-3 pl-4 pr-3 text-left text-[14px] font-medium ${
                                  certId === c.id ? "bg-white/15 text-white" : "text-white/90 hover:bg-white/10"
                                } ${isDisabled ? "opacity-45 pointer-events-none" : ""}`}
                                onClick={() => {
                                  if (!isDisabled) {
                                    onNavigate(`/mypage?cert=${c.id}`);
                                    closeMobileDrawer();
                                  }
                                }}
                              >
                                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#99ccff] text-[#0034d3]">
                                  {certIconMap[c.code] ?? <FileText className="h-5 w-5" />}
                                </span>
                                <span className="truncate flex-1">
                                  {getCertDisplayName(c, certInfos[c.code] ?? null)}
                                </span>
                                {isDisabled && (
                                  <span className="text-[10px] text-white/50 shrink-0">준비 중</span>
                                )}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </>
              )}

              {(user && onOpenOrientation) || (FEATURE_COUPON && onOpenCoupon && user) ? (
                <>
                  <MobileDrawerSectionTitle>도움말 · 혜택</MobileDrawerSectionTitle>
                  {user && onOpenOrientation && (
                    <button
                      type="button"
                      className={drawerNavBtn}
                      onClick={() => {
                        closeMobileDrawer();
                        onOpenOrientation();
                      }}
                    >
                      <HelpCircle className="w-5 h-5 shrink-0 opacity-95" />
                      핵심 기능 가이드
                    </button>
                  )}
                  {FEATURE_COUPON && onOpenCoupon && user && (
                    <button
                      type="button"
                      className={drawerNavBtn}
                      onClick={() => {
                        closeMobileDrawer();
                        onOpenCoupon();
                      }}
                    >
                      <Ticket className="w-5 h-5 shrink-0 opacity-95" />
                      쿠폰 등록
                    </button>
                  )}
                </>
              ) : null}

              {user && (
                <>
                  <MobileDrawerSectionTitle>계정</MobileDrawerSectionTitle>
                  <button
                    type="button"
                    className={drawerNavBtn}
                    onClick={() => {
                      onNavigate("/account-settings");
                      closeMobileDrawer();
                    }}
                  >
                    <Settings className="w-5 h-5 shrink-0 opacity-95" />
                    계정설정
                  </button>
                  <button
                    type="button"
                    className={drawerNavBtn}
                    onClick={() => {
                      closeMobileDrawer();
                      setShowLogoutConfirm(true);
                    }}
                  >
                    <LogOut className="w-5 h-5 shrink-0 opacity-95" />
                    로그아웃
                  </button>
                </>
              )}

              {canShowAdmin(user) && (
                <>
                  <MobileDrawerSectionTitle>관리자</MobileDrawerSectionTitle>
                  <button
                    type="button"
                    className={drawerNavBtn}
                    onClick={() => {
                      onNavigate("/admin");
                      closeMobileDrawer();
                    }}
                  >
                    <Users className="w-5 h-5 shrink-0 opacity-95" />
                    회원 관리
                  </button>
                  <button
                    type="button"
                    className={drawerNavBtn}
                    onClick={() => {
                      onNavigate("/admin/certs");
                      closeMobileDrawer();
                    }}
                  >
                    <List className="w-5 h-5 shrink-0 opacity-95" />
                    자격증 관리
                  </button>
                  <button
                    type="button"
                    className={drawerNavBtn}
                    onClick={() => {
                      onNavigate("/admin/questions");
                      closeMobileDrawer();
                    }}
                  >
                    <BookOpen className="w-5 h-5 shrink-0 opacity-95" />
                    문제 관리
                  </button>
                  <button
                    type="button"
                    className={drawerNavBtn}
                    onClick={() => {
                      onNavigate("/admin/billing");
                      closeMobileDrawer();
                    }}
                  >
                    <Ticket className="w-5 h-5 shrink-0 opacity-95" />
                    쿠폰 배포 · 관리
                  </button>
                </>
              )}

              {!user && (
                <>
                  <MobileDrawerSectionTitle>시작하기</MobileDrawerSectionTitle>
                  <button
                    type="button"
                    className={`${drawerNavBtn} bg-white/10`}
                    onClick={() => {
                      onNavigate("/login");
                      closeMobileDrawer();
                    }}
                  >
                    <LogIn className="w-5 h-5 shrink-0 opacity-95" />
                    로그인 · 회원가입
                  </button>
                </>
              )}
            </nav>
          </div>
        </aside>
      </div>
    )}
    </>
  );
}
