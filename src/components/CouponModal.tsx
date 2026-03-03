import React, { useState } from 'react';
import { X, Ticket } from 'lucide-react';

export interface CouponModalProps {
  onClose: () => void;
  onSubmit?: (code: string) => Promise<void>;
}

/** 베타 전용: 쿠폰 코드 입력 모달 (FEATURE_COUPON 시에만 노출) */
export function CouponModal({ onClose, onSubmit }: CouponModalProps) {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) return;
    setLoading(true);
    setMessage('');
    try {
      if (onSubmit) {
        await onSubmit(trimmed);
        setMessage('쿠폰이 적용되었습니다.');
        setCode('');
      } else {
        setMessage('쿠폰 검증은 준비 중입니다.');
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '쿠폰 적용에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/50" onClick={onClose} aria-hidden />
      <div className="relative w-full max-w-sm rounded-2xl bg-white shadow-xl border border-slate-200 overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-slate-100">
          <h3 className="font-bold text-slate-900 flex items-center gap-2">
            <Ticket className="w-5 h-5 text-[#0034d3]" />
            쿠폰 등록
          </h3>
          <button type="button" onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100 text-slate-500">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="쿠폰 코드 입력"
            className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-[#0034d3] focus:border-transparent outline-none"
            disabled={loading}
          />
          {message && <p className="text-sm text-slate-600">{message}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-slate-200 font-medium text-slate-700 hover:bg-slate-50">
              취소
            </button>
            <button type="submit" disabled={loading || !code.trim()} className="flex-1 py-2.5 rounded-xl bg-[#0034d3] text-white font-medium hover:opacity-90 disabled:opacity-50">
              {loading ? '처리 중…' : '확인'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
