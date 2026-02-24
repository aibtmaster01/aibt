import React, { useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { User } from '../types';
import { LogOut, User as UserIcon, Shield, Menu, Check, ChevronDown, Settings } from 'lucide-react';
import { recordVisit } from '../services/adminService';

interface LayoutProps {
  children: React.ReactNode;
  user: User | null;
  onLogout: () => void;
  onNavigate: (path: string) => void;
  /** 비로그인 시 상단 "로그인" / "시작하기" 클릭 시 로그인 화면에서 보여줄 탭 */
  onNavigateToAuth?: (mode: 'login' | 'signup') => void;
  currentPath: string;
}

export const Layout: React.FC<LayoutProps> = ({ children, user, onLogout, onNavigate, onNavigateToAuth, currentPath }) => {
  const [isMenuOpen, setIsMenuOpen] = React.useState(false);
  const [showLogoutModal, setShowLogoutModal] = React.useState(false);
  const [userDropdownOpen, setUserDropdownOpen] = React.useState(false);
  const userDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!userDropdownOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (userDropdownRef.current && !userDropdownRef.current.contains(e.target as Node)) {
        setUserDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [userDropdownOpen]);

  // 오늘 방문자 집계 (로그인 유저, 당일 1회)
  useEffect(() => {
    if (!user?.id) return;
    recordVisit(user.id);
  }, [user?.id]);

  const handleLogoutClick = () => {
    setShowLogoutModal(true);
    setUserDropdownOpen(false);
  };
  const handleLogoutConfirm = () => {
    onLogout();
    setShowLogoutModal(false);
    setIsMenuOpen(false);
  };

  const isDashboardWithSidebar =
    currentPath === '/mypage' ||
    currentPath === '/exam-list' ||
    currentPath === '/quiz' ||
    currentPath === '/result' ||
    (currentPath === '/' && !!user);

  return (
    <div className={`bg-[#edf1f5] flex flex-col ${isDashboardWithSidebar ? 'h-screen overflow-hidden' : 'min-h-screen'}`}>
      {!isDashboardWithSidebar && (
      <header className="bg-white/90 backdrop-blur-md border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-5 py-4 flex items-center justify-between">
          <button
            type="button"
            className="flex items-center gap-2 cursor-pointer group focus:outline-none"
            onClick={() => onNavigate('/')}
          >
            <div className="w-9 h-9 bg-[#0034d3] rounded-lg flex items-center justify-center text-white shadow-sm group-hover:bg-[#003087] transition-colors">
              <Check size={20} strokeWidth={3} />
            </div>
            <span className="text-xl font-black text-slate-900 tracking-tight">
              합격해
            </span>
          </button>

          {/* Desktop Nav */}
          <div className="hidden md:flex items-center gap-6 text-sm font-semibold">
            {user?.isAdmin && (
              <button onClick={() => onNavigate('/admin')} className="text-red-500 hover:text-red-600 flex items-center gap-1">
                <Shield size={16} /> Admin
              </button>
            )}
            {user ? (
              <div className="flex items-center gap-4">
                <button 
                  onClick={() => onNavigate('/mypage')}
                  className={`hover:text-[#003087] transition-colors ${currentPath === '/mypage' ? 'text-[#003087]' : 'text-slate-600'}`}
                >
                  나의 학습
                </button>
                <div className="relative pl-4 border-l border-slate-200" ref={userDropdownRef}>
                  <button
                    type="button"
                    onClick={() => setUserDropdownOpen((v) => !v)}
                    className="flex items-center gap-1.5 text-slate-900 hover:text-slate-700 font-semibold"
                  >
                    {user.name}님
                    <ChevronDown size={18} className={userDropdownOpen ? 'rotate-180' : ''} />
                  </button>
                  {userDropdownOpen && (
                    <div className="absolute right-0 top-full mt-1 py-1 min-w-[160px] bg-white rounded-xl border border-slate-200 shadow-lg z-50">
                      <button
                        type="button"
                        onClick={() => { onNavigate('/account-settings'); setUserDropdownOpen(false); }}
                        className="w-full flex items-center gap-2 px-4 py-2.5 text-left text-slate-700 hover:bg-slate-50 rounded-lg"
                      >
                        <Settings size={16} /> 계정설정
                      </button>
                      <button
                        type="button"
                        onClick={handleLogoutClick}
                        className="w-full flex items-center gap-2 px-4 py-2.5 text-left text-slate-600 hover:bg-slate-50 rounded-lg"
                      >
                        <LogOut size={16} /> 로그아웃
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <button onClick={() => (onNavigateToAuth ? onNavigateToAuth('login') : onNavigate('/login'))} className="text-slate-500 hover:text-slate-900">
                  로그인
                </button>
                <button onClick={() => (onNavigateToAuth ? onNavigateToAuth('signup') : onNavigate('/login'))} className="bg-[#0034d3] text-white px-6 py-2 rounded-lg hover:bg-[#003087] transition-all shadow-md font-bold">
                  시작하기
                </button>
              </div>
            )}
          </div>

          {/* Mobile Menu Button */}
          <button className="md:hidden text-slate-600" onClick={() => setIsMenuOpen(!isMenuOpen)}>
            <Menu size={24} />
          </button>
        </div>

        {/* Mobile Menu */}
        {isMenuOpen && (
          <div className="md:hidden bg-white border-t border-slate-100 p-4 space-y-4 shadow-xl">
             {user ? (
              <>
                <div className="font-bold text-slate-900 flex items-center gap-2">
                  <UserIcon size={16} /> {user.name}님
                </div>
                <button onClick={() => {onNavigate('/mypage'); setIsMenuOpen(false);}} className="block w-full text-left py-2 text-slate-600">나의 학습</button>
                <button onClick={() => {onNavigate('/account-settings'); setIsMenuOpen(false);}} className="block w-full text-left py-2 text-slate-600">계정설정</button>
                {user.isAdmin && <button onClick={() => {onNavigate('/admin'); setIsMenuOpen(false);}} className="block w-full text-left py-2 text-red-500">관리자</button>}
                <button onClick={() => {handleLogoutClick(); setIsMenuOpen(false);}} className="block w-full text-left py-2 text-slate-400">로그아웃</button>
              </>
            ) : (
              <>
                <button onClick={() => { onNavigateToAuth ? onNavigateToAuth('login') : onNavigate('/login'); setIsMenuOpen(false); }} className="block w-full text-left py-2 text-slate-600 font-medium">
                  로그인
                </button>
                <button onClick={() => { onNavigateToAuth ? onNavigateToAuth('signup') : onNavigate('/login'); setIsMenuOpen(false); }} className="block w-full bg-[#0034d3] text-white font-bold py-3 rounded-xl text-center mt-2">
                  시작하기
                </button>
              </>
            )}
          </div>
        )}
      </header>
      )}

      {/* 로그아웃 확인 모달 - body에 포탈로 렌더링 */}
      {showLogoutModal && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-5">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowLogoutModal(false)} />
          <div className="bg-white w-full max-w-sm rounded-[2rem] p-8 relative z-10 animate-slide-up shadow-2xl text-center">
            <div className="w-14 h-14 bg-slate-100 rounded-full flex items-center justify-center text-slate-600 mx-auto mb-6">
              <LogOut size={24} />
            </div>
            <h3 className="text-xl font-black text-slate-900 mb-2">로그아웃</h3>
            <p className="text-slate-500 text-sm mb-8">로그아웃 하시겠습니까?</p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowLogoutModal(false)}
                className="flex-1 py-3 rounded-xl font-bold border-2 border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
              >
                취소
              </button>
              <button
                onClick={handleLogoutConfirm}
                className="flex-1 py-3 rounded-xl font-bold bg-slate-900 text-white hover:bg-slate-800 transition-colors"
              >
                로그아웃
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      <main className="flex-1 w-full min-h-0 bg-[#edf1f5]">
        {children}
      </main>

      {!isDashboardWithSidebar && (
        <footer className="bg-gray-100 border-t border-slate-200 py-10 mt-auto">
          <div className="max-w-6xl mx-auto px-5 text-center text-slate-400 text-xs">
            <p className="mb-2 font-bold text-slate-300">합격해 (AI Based Test)</p>
            <p>© 2024 합격해 Corp. All rights reserved.</p>
          </div>
        </footer>
      )}
    </div>
  );
};