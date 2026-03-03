import React, { useState } from 'react';
import { ArrowLeft, CreditCard, Ticket, ShieldCheck, Lock } from 'lucide-react';
import { CERTIFICATIONS } from '../constants';
import { getCertDisplayName } from '../services/gradingService';
import { useCertificationInfo } from '../hooks/useCertificationInfo';
import { FEATURE_COUPON } from '../config/brand';
import { validateBetaCoupon, redeemBetaCoupon } from '../services/couponService';

interface CheckoutProps {
  certId?: string;
  onBack: () => void;
  onComplete: () => void;
  userEmail?: string;
  userId?: string;
}

export const Checkout: React.FC<CheckoutProps> = ({ certId, onBack, onComplete, userEmail, userId }) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [couponCode, setCouponCode] = useState('');
  const [couponError, setCouponError] = useState('');
  const [couponSuccess, setCouponSuccess] = useState(false);
  const cert = CERTIFICATIONS.find(c => c.id === certId) || CERTIFICATIONS[0];
  const { certInfo } = useCertificationInfo(cert?.code);

  const handlePayment = () => {
    setIsProcessing(true);
    setTimeout(() => onComplete(), 2000);
  };

  const handleCouponSubmit = async () => {
    setCouponError('');
    const code = couponCode.trim();
    if (!code) {
      setCouponError('쿠폰 코드를 입력해 주세요.');
      return;
    }
    if (!userEmail || !userId) {
      setCouponError('로그인 후 쿠폰을 사용할 수 있습니다.');
      return;
    }
    setIsProcessing(true);
    try {
      const { valid } = await validateBetaCoupon(code);
      if (!valid) {
        setCouponError('유효하지 않거나 이미 사용된 쿠폰입니다.');
        return;
      }
      await redeemBetaCoupon(code, userEmail, userId);
      setCouponSuccess(true);
      setTimeout(() => onComplete(), 1500);
    } catch {
      setCouponError('쿠폰 적용 중 오류가 발생했습니다.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#edf1f5] py-12 px-5">
      <div className="max-w-4xl mx-auto">
        <button onClick={onBack} className="flex items-center text-slate-500 hover:text-slate-900 mb-8 font-bold">
          <ArrowLeft size={20} className="mr-2" /> 뒤로가기
        </button>

        <h1 className="text-3xl font-black text-slate-900 mb-8">주문/결제</h1>

        <div className="grid md:grid-cols-3 gap-8">
          {/* Left: Order Info */}
          <div className="md:col-span-2 space-y-6">
            <div className="bg-white rounded-3xl p-8 border border-slate-200 shadow-sm">
              <h2 className="font-bold text-lg mb-6 flex items-center gap-2">
                <Ticket className="text-brand-500" /> 주문 상품 정보
              </h2>
              <div className="flex items-start gap-6 border-b border-slate-100 pb-6 mb-6">
                 <div className="w-24 h-24 bg-slate-100 rounded-2xl flex items-center justify-center font-black text-slate-400 text-2xl shrink-0">
                    {cert.code.substring(0,2)}
                 </div>
                 <div>
                   <div className="text-brand-600 font-bold text-xs uppercase mb-1">열공모드</div>
                   <h3 className="font-black text-xl text-slate-900 mb-2">{getCertDisplayName(cert, certInfo)} 합격 패키지</h3>
                   <ul className="text-sm text-slate-500 space-y-1">
                     <li>- AI 약점 공략 모의고사 무제한</li>
                     <li>- 오답노트 & 상세 해설</li>
                     <li>- 합격 예측 리포트 제공</li>
                   </ul>
                 </div>
              </div>
              
              <div className="flex items-center gap-2 text-brand-600 bg-brand-50 p-4 rounded-xl font-bold text-sm">
                <ShieldCheck size={18} />
                <span>테스트기간 무료!</span>
              </div>
            </div>

            {!FEATURE_COUPON && (
              <div className="bg-white rounded-3xl p-8 border border-slate-200 shadow-sm">
                <h2 className="font-bold text-lg mb-6 flex items-center gap-2">
                  <CreditCard className="text-brand-500" /> 결제 수단
                </h2>
                <div className="grid grid-cols-2 gap-4">
                  <button className="border-2 border-brand-500 bg-brand-50 text-brand-700 font-bold py-4 rounded-xl flex flex-col items-center gap-2">
                    <CreditCard /> 신용/체크카드
                  </button>
                  <button className="border border-slate-200 hover:border-slate-300 text-slate-600 font-bold py-4 rounded-xl flex flex-col items-center gap-2">
                    <span>📱</span> 카카오페이
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Right: Summary (일반) 또는 베타 쿠폰 전용 */}
          <div className="md:col-span-1">
            <div className="bg-white rounded-3xl p-8 border border-slate-200 shadow-lg sticky top-24">
              {FEATURE_COUPON ? (
                <>
                  <h2 className="font-bold text-lg mb-2">베타테스터 전용 쿠폰 입력</h2>
                  <p className="text-sm text-slate-500 mb-6">쿠폰 코드를 입력하면 열공 모드가 적용됩니다.</p>
                  <input
                    type="text"
                    value={couponCode}
                    onChange={(e) => setCouponCode(e.target.value)}
                    placeholder="쿠폰 코드 입력"
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 mb-3 focus:ring-2 focus:ring-[#0034d3] focus:border-transparent outline-none"
                    disabled={isProcessing || couponSuccess}
                  />
                  {couponError && <p className="text-sm text-red-600 mb-3">{couponError}</p>}
                  {couponSuccess && <p className="text-sm text-green-600 mb-3">쿠폰이 적용되었습니다.</p>}
                  <button
                    type="button"
                    onClick={handleCouponSubmit}
                    disabled={isProcessing || couponSuccess}
                    className="w-full bg-slate-900 text-white font-bold py-4 rounded-xl hover:bg-slate-800 transition-all shadow-lg disabled:opacity-70 disabled:cursor-wait flex items-center justify-center gap-2"
                  >
                    {isProcessing ? (
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : couponSuccess ? (
                      '적용 완료'
                    ) : (
                      <>쿠폰 적용</>
                    )}
                  </button>
                  <p className="text-xs text-slate-400 mt-4 text-center">로그인한 이메일로 쿠폰 사용 이력이 기록됩니다.</p>
                </>
              ) : (
                <>
                  <h2 className="font-bold text-lg mb-6">결제 금액</h2>
                  <div className="space-y-4 mb-8 text-sm">
                    <div className="flex justify-between text-slate-500">
                      <span>상품 금액</span>
                      <span>0원</span>
                    </div>
                    <div className="flex justify-between text-brand-600 font-bold">
                      <span>테스트기간 무료!</span>
                      <span>0원</span>
                    </div>
                    <div className="border-t border-slate-100 pt-4 flex justify-between items-center">
                      <span className="font-bold text-slate-900">최종 결제 금액</span>
                      <span className="font-black text-2xl text-slate-900">0원</span>
                    </div>
                  </div>
                  <button
                    onClick={handlePayment}
                    disabled={isProcessing}
                    className="w-full bg-slate-900 text-white font-bold py-4 rounded-xl hover:bg-slate-800 transition-all shadow-lg hover:shadow-xl hover:-translate-y-1 disabled:opacity-70 disabled:cursor-wait flex items-center justify-center gap-2"
                  >
                    {isProcessing ? (
                      <>
                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                        결제 중...
                      </>
                    ) : (
                      <>
                        <Lock size={18} /> 결제하기
                      </>
                    )}
                  </button>
                  <p className="text-xs text-slate-400 mt-4 text-center leading-relaxed">
                    위 주문 내용을 확인하였으며, 정보 제공 등에 동의합니다.
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
