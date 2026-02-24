import React, { useEffect } from 'react';
import type { AiAnalysisContext } from '../services/aiRoundCurationService';

interface AiLoadingOverlayProps {
  context: AiAnalysisContext;
  onComplete: () => void;
}

/**
 * 맞춤형 모의고사 준비 중 오버레이.
 * context.daysLeft == null 이면 "다음 시험 일정이 곧 업데이트됩니다" 등 안내.
 */
export const AiLoadingOverlay: React.FC<AiLoadingOverlayProps> = ({ context, onComplete }) => {
  useEffect(() => {
    const t = setTimeout(onComplete, 3000);
    return () => clearTimeout(t);
  }, [onComplete]);

  const message =
    context.daysLeft == null
      ? '다음 시험 일정이 곧 업데이트됩니다.'
      : '맞춤형 모의고사를 준비하고 있어요.';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="text-center text-white px-6">
        <p className="text-slate-300 text-sm mb-2">{message}</p>
        <p className="text-lg font-semibold">
          {context.mode === 'WEAKNESS_ATTACK' ? '약점 강화형' : '실전 대비형'}
        </p>
      </div>
    </div>
  );
};
