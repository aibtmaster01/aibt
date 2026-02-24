import React from 'react';
import { AlertCircle, ArrowLeft } from 'lucide-react';
import { getDisplayErrorCode } from '../utils/errorCodes';

interface ErrorViewProps {
  /** 화면에 띄울 짧은 메시지 (선택, 없으면 기본 문구만) */
  message?: string;
  /** 내부 원인 코드 (ERR_XXX). 유저에는 getDisplayErrorCode로 변환된 난수형 코드만 노출 */
  errorCode: string;
  /** 돌아가기 버튼 클릭 시 */
  onBack: () => void;
  /** 버튼 문구 */
  backLabel?: string;
  /** 권한 오류 시 추가 안내 (예: 배포 안내) */
  hint?: string;
}

/**
 * 서비스 디자인에 맞춘 공통 오류 화면
 * - 예상치 못한 오류 문구 + 오류코드(개발자 식별용) + 돌아가기
 */
export const ErrorView: React.FC<ErrorViewProps> = ({
  message,
  errorCode,
  onBack,
  backLabel = '돌아가기',
  hint,
}) => {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 p-5">
      <div className="bg-white w-full max-w-sm rounded-[2rem] p-8 shadow-2xl border border-slate-200 text-center">
        <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center text-red-600 mx-auto mb-6">
          <AlertCircle size={24} />
        </div>
        <h2 className="text-xl font-black text-slate-900 mb-2">
          예상치 못한 오류가 발생했습니다
        </h2>
        {message && (
          <p className="text-slate-500 text-sm mb-4 break-keep">
            {message}
          </p>
        )}
        {hint && (
          <p className="text-[#0034d3] text-xs mb-4 break-keep bg-[#99ccff] rounded-lg px-3 py-2">
            {hint}
          </p>
        )}
        <p className="text-slate-400 text-xs font-mono mb-6">
          오류코드: {getDisplayErrorCode(errorCode)}
        </p>
        <button
          type="button"
          onClick={onBack}
          className="w-full py-3.5 rounded-xl font-bold bg-slate-900 text-white hover:bg-slate-800 transition-colors flex items-center justify-center gap-2"
        >
          <ArrowLeft size={18} />
          {backLabel}
        </button>
      </div>
    </div>
  );
};
