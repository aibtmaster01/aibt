import React, { useState, useRef, useEffect } from "react";
import { List, LogOut, LogIn, LayoutDashboard, Database, Code, FileText, Settings, Users, BookOpen, Ticket } from "lucide-react";
import { CERTIFICATIONS, DISABLED_CERT_IDS } from "../constants";
import { APP_BRAND, FEATURE_COUPON } from "../config/brand";
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
  /** 베타 전용: 쿠폰 입력 모달 열기 */
  onOpenCoupon?: () => void;
}

const certIconMap: Record<string, React.ReactNode> = {
  BIGDATA: <Database className="h-5 w-5" />,
  SQLD: <Code className="h-5 w-5" />,
  ADSP: <FileText className="h-5 w-5" />,
};

export function DashboardSidebar({
  user,
  certId,
  currentPath,
  onNavigate,
  onLogout,
  onOpenCoupon,
}: DashboardSidebarProps) {
  const [listPopupOpen, setListPopupOpen] = useState(false);
  const [profilePopupOpen, setProfilePopupOpen] = useState(false);
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

  return (
    <aside className="h-full bg-[#1e56cd] w-16 md:w-20 flex-shrink-0 flex flex-col items-center py-6 md:py-8">
      {/* 로고 */}
      <button
        type="button"
        onClick={() => onNavigate('/')}
        className="text-white font-black text-sm md:text-base mb-6 md:mb-8 tracking-tight"
      >
        {APP_BRAND}
      </button>
      {/* 프로필 영역 - 로그인 시에만 표시, 클릭 시 계정설정/로그아웃 팝업 */}
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

      {/* 로그아웃 확인 모달 (앱 스타일) */}
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
                }}
                className="flex-1 py-3.5 text-sm font-bold text-[#0034d3] hover:bg-[#99ccff]/30 transition-colors"
              >
                로그아웃
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 리스트(자격증 선택) - 일반 회원만 표시 / 어드민은 자격증관리 아이콘으로 대체 */}
      {!user?.isAdmin && (
        <div ref={listPopupRef} className={`relative ${user ? "mt-8 md:mt-12" : "mt-6 md:mt-8"}`}>
          <button
            type="button"
            onClick={() => setListPopupOpen((v) => !v)}
            className={`text-white/80 hover:text-white ${listPopupOpen ? "text-white" : ""}`}
          >
            <List className="w-6 h-6 md:w-8 md:h-8" />
          </button>
          {listPopupOpen && (
            <div className="absolute left-full top-0 ml-3 mt-0 min-w-[200px] py-2 bg-white rounded-xl border border-slate-200 shadow-xl z-50">
              <p className="px-4 py-2 text-xs font-bold text-slate-400 uppercase">자격증 선택</p>
              {CERTIFICATIONS.map((cert) => {
                const isDisabled = DISABLED_CERT_IDS.includes(cert.id);
                return (
                  <button
                    key={cert.id}
                    type="button"
                    onClick={() => {
                      if (!isDisabled) {
                        onNavigate(`/mypage?cert=${cert.id}`);
                        setListPopupOpen(false);
                      }
                    }}
                    disabled={isDisabled}
                    className={`w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm font-semibold transition-colors ${
                      certId === cert.id
                        ? "bg-[#99ccff] text-[#0034d3]"
                        : isDisabled
                          ? "text-slate-300 cursor-not-allowed"
                          : "text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${isDisabled ? "bg-slate-100 text-slate-300" : "bg-[#99ccff] text-[#0034d3]"}`}>
                      {certIconMap[cert.code] ?? <FileText className="h-5 w-5" />}
                    </div>
                    <span>{getCertDisplayName(cert, certInfos[cert.code] ?? null)}</span>
                    {isDisabled && <span className="text-[10px] text-slate-400 ml-auto">준비 중</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
      {/* 대시보드 - 로그인 시에만 표시 (어드민이면 첫 메뉴로 mt 더 넓게) */}
      {user && (
        <button
          type="button"
          onClick={() => onNavigate('/mypage')}
          className={`${user.isAdmin ? 'mt-8 md:mt-12' : 'mt-6 md:mt-8'} ${currentPath === '/mypage' || currentPath === '/' ? "text-white" : "text-white/80 hover:text-white"}`}
        >
          <LayoutDashboard className="w-6 h-6 md:w-8 md:h-8" strokeWidth={2} />
        </button>
      )}
      {/* 회원 관리 - 관리자만 표시 */}
      {user?.isAdmin && (
        <button
          type="button"
          onClick={() => onNavigate('/admin')}
          className={`mt-6 md:mt-8 ${currentPath === '/admin' ? "text-white" : "text-white/80 hover:text-white"}`}
          aria-label="회원 관리"
        >
          <Users className="w-6 h-6 md:w-8 md:h-8" strokeWidth={2} />
        </button>
      )}
      {/* 자격증 관리 - 관리자만 표시 (List 아이콘) */}
      {user?.isAdmin && (
        <button
          type="button"
          onClick={() => onNavigate('/admin/certs')}
          className={`mt-6 md:mt-8 ${currentPath === '/admin/certs' ? "text-white" : "text-white/80 hover:text-white"}`}
          aria-label="자격증 관리"
        >
          <List className="w-6 h-6 md:w-8 md:h-8" />
        </button>
      )}
      {/* 문제 관리 - 관리자만 표시 */}
      {user?.isAdmin && (
        <button
          type="button"
          onClick={() => onNavigate('/admin/questions')}
          className={`mt-6 md:mt-8 ${currentPath === '/admin/questions' ? "text-white" : "text-white/80 hover:text-white"}`}
          aria-label="문제 관리"
        >
          <BookOpen className="w-6 h-6 md:w-8 md:h-8" strokeWidth={2} />
        </button>
      )}
      {/* 쿠폰 관리 - 관리자만 표시 (결제 관리 화면은 추후 별도 메뉴 예정) */}
      {user?.isAdmin && (
        <button
          type="button"
          onClick={() => onNavigate('/admin/billing')}
          className={`mt-6 md:mt-8 ${currentPath === '/admin/billing' ? "text-white" : "text-white/80 hover:text-white"}`}
          aria-label="쿠폰 관리"
        >
          <Ticket className="w-6 h-6 md:w-8 md:h-8" strokeWidth={2} />
        </button>
      )}

      <div className="flex-1 min-h-[24px]" />

      {/* 비로그인 시 하단 로그인 버튼 */}
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
  );
}
