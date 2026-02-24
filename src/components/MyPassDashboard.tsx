import React from 'react';
import { ArrowRight } from 'lucide-react';
import { User } from '../types';
import { CERTIFICATIONS } from '../constants';

interface MyPassDashboardProps {
  user: User;
  activeCertId: string;
  daysLeft: number | null;
  onContinue: (certId: string) => void;
  onUpgrade: (certId: string) => void;
  onNavigateToGoalSetting: (certId: string) => void;
}

export const MyPassDashboard: React.FC<MyPassDashboardProps> = ({
  user,
  activeCertId,
  daysLeft,
  onContinue,
  onUpgrade,
  onNavigateToGoalSetting,
}) => {
  const cert = CERTIFICATIONS.find((c) => c.id === activeCertId);
  const certName = cert?.name ?? '자격증';
  const isPremium = user.isAdmin || user.isPremium;

  return (
    <div className="bg-white rounded-2xl shadow-md border border-slate-200 p-8 flex flex-col md:flex-row justify-between items-center gap-8">
      {/* 좌측: 정보 영역 */}
      <div className="flex-1 text-center md:text-left">
        {daysLeft != null ? (
          <>
            <div className="text-brand-500 font-black text-4xl md:text-5xl mb-2">D-{daysLeft}</div>
            <p className="text-slate-600 text-lg font-medium">
              {user.name}님, <span className="font-bold text-slate-900">{certName}</span> 합격까지 얼마 남지 않았어요!
            </p>
          </>
        ) : (
          <p className="text-slate-600 text-lg font-medium">아직 목표 시험일이 설정되지 않았어요.</p>
        )}
        <div className="mt-3">
          <span className={`text-xs font-bold px-2.5 py-1 rounded-md ${isPremium ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-600'}`}>
            {isPremium ? '열공모드 무제한' : '베이직'}
          </span>
        </div>
      </div>

      {/* 우측: 액션 영역 */}
      <div className="flex flex-col sm:flex-row gap-3 shrink-0">
        <button
          onClick={() => onContinue(activeCertId)}
          className="bg-slate-900 text-white font-bold py-3 px-6 rounded-xl hover:bg-slate-800 transition-all shadow-lg flex items-center justify-center gap-2"
        >
          모의고사 목록 입장하기 <ArrowRight size={18} />
        </button>
        {daysLeft == null && (
          <button
            onClick={() => onNavigateToGoalSetting(activeCertId)}
            className="bg-white border-2 border-slate-200 text-slate-700 font-bold py-3 px-6 rounded-xl hover:bg-slate-50 hover:border-slate-300 transition-all flex items-center justify-center"
          >
            목표 시험일 설정
          </button>
        )}
      </div>

      {/* 하단: 무료 회원 업셀링 띠 배너 */}
      {!isPremium && (
        <div
          className="w-full bg-yellow-50 text-yellow-800 p-3 rounded-lg mt-6 text-sm font-bold cursor-pointer text-center hover:bg-yellow-100 transition-colors"
          onClick={() => onUpgrade(activeCertId)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && onUpgrade(activeCertId)}
        >
          🔒 AI 약점 분석 기능이 잠겨있습니다. ⚡ [열공모드 50% 할인받고 열기]
        </div>
      )}
    </div>
  );
};
