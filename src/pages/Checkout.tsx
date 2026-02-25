import React, { useState } from 'react';
import { ArrowLeft, Check, CreditCard, Ticket, ShieldCheck, Lock } from 'lucide-react';
import { CERTIFICATIONS } from '../constants';
import { getCertDisplayName } from '../services/gradingService';
import { useCertificationInfo } from '../hooks/useCertificationInfo';

interface CheckoutProps {
  certId?: string;
  onBack: () => void;
  onComplete: () => void;
}

export const Checkout: React.FC<CheckoutProps> = ({ certId, onBack, onComplete }) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const cert = CERTIFICATIONS.find(c => c.id === certId) || CERTIFICATIONS[0];
  const { certInfo } = useCertificationInfo(cert?.code);
  
  const originalPrice = 50000;
  const discount = 10000;
  const finalPrice = originalPrice - discount;

  const handlePayment = () => {
    setIsProcessing(true);
    // Simulate payment processing
    setTimeout(() => {
      onComplete();
    }, 2000);
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
          </div>

          {/* Right: Summary */}
          <div className="md:col-span-1">
            <div className="bg-white rounded-3xl p-8 border border-slate-200 shadow-lg sticky top-24">
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
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
