import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export interface OrientationPopupProps {
  /** true: 최초 진입(쿠폰 미등록) → 4페이지에 쿠폰 입력, 등록 전까지 닫기 불가 */
  forced?: boolean;
  /** true: LNB에서 연 경우 → 4페이지에 닫기 버튼만 */
  fromLNB?: boolean;
  onClose: () => void;
  onCouponRegistered?: () => void;
  userId?: string;
  userEmail?: string;
}

const SLIDES = [
  {
    id: 1,
    title: <span className="font-bold text-blue-600">안녕하세요, <br/> AiBT 베타테스터에 참여해주셔서 감사합니다!</span>,
    content:
      '현재 AiBT는 최적화된 분석 환경을 위해 <b> 웹 버전</b>만 운영 중입니다.\n\n다음 안내에 따라 당신만의 합격 세트를 경험해 보세요.',
    hasPrev: false,
  },
  {
    id: 2,
    title: <span className="font-bold text-blue-600">AI 학습 모드 vs 실전 모드</span>,
    content:
      '원하는 학습모드를 자유롭게 선택하여 문제를 풀 수 있습니다.\n\n<b>AI 학습 모드</b>에서는 1문제씩 풀며 정답과 오답 피드백을 즉시 확인할 수 있습니다.\n\n<b>실전 모드에서</b>는 실제 시험처럼 일괄 풀이 후 채점을 진행합니다.\n',
    hasPrev: true,
    image: '/ot/OT1.png',
  },
  {
    id: 3,
    title: <span className="font-bold text-blue-600">내 실력 기반 맞춤형 모의고사</span>,
    content:
      '학습을 진행하는 동안 AI가 학습자님의 정답률과 풀이 스타일을 <b>실시간으로 분석</b>합니다.\n현재 내 실력에 <b>가장 필요한 문제부터 큐레이션</b>하여 최단기 합격 루트를 설계해 드립니다.\n\n',
    hasPrev: true,
    image: '/ot/OT2.png',
  },
  {
    id: 4,
    title: <span className="font-bold text-blue-600">대시보드 활용</span>,
    content:
      '학습이 끝나면 대시보드에서 나의 학습 현황을 확인해 보세요.\n\n예측 합격률을 확인하고, <b>취약한 과목/유형/개념을 집중 훈련</b>할 수 있습니다.\n\n',
    hasPrev: true,
    image: '/ot/OT3.png',
  },
  {
    id: 5,
    title: <span className="font-bold text-blue-600">쿠폰코드 입력</span>,
    content: null, // 쿠폰 페이지는 별도 UI
    hasPrev: true,
  },
];

function renderContent(text: string) {
  return text.split('\n').map((line, i) => {
    const parts = line.split(/(<b>.*?<\/b>)/g);
    return (
      <p key={i} className="mb-3 last:mb-0">
        {parts.map((part, j) => {
          if (part.startsWith('<b>') && part.endsWith('</b>')) {
            return <b key={j}>{part.slice(3, -4)}</b>;
          }
          return part;
        })}
      </p>
    );
  });
}

export function OrientationPopup({
  forced = false,
  fromLNB = false,
  onClose,
  onCouponRegistered,
  userId = '',
  userEmail = '',
}: OrientationPopupProps) {
  const [page, setPage] = useState(0);
  const [couponCode, setCouponCode] = useState('');
  const [couponError, setCouponError] = useState('');
  const [couponLoading, setCouponLoading] = useState(false);

  const slide = SLIDES[page];
  const isLastPage = page === SLIDES.length - 1;
  const isCouponPage = slide?.content === null; // 5페이지: 쿠폰코드 입력
  const showCouponInput = isCouponPage && forced && !fromLNB;
  const showCloseOnly = isCouponPage && fromLNB;

  const handleCouponSubmit = async () => {
    if (!couponCode.trim()) {
      setCouponError('쿠폰 코드를 입력해 주세요.');
      return;
    }
    if (!userId || !userEmail) {
      setCouponError('로그인 정보가 없습니다.');
      return;
    }
    setCouponError('');
    setCouponLoading(true);
    try {
      const { redeemBetaCoupon } = await import('../services/couponService');
      await redeemBetaCoupon(couponCode.trim(), userEmail, userId);
      onCouponRegistered?.();
      onClose();
    } catch (err) {
      setCouponError(err instanceof Error ? err.message : '쿠폰 등록에 실패했습니다.');
    } finally {
      setCouponLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div
        className="relative w-full max-w-4xl bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[95vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 고정 헤더 */}
        <div className="shrink-0 px-6 py-4 border-b border-slate-200 bg-slate-50">
          <h2 className="text-lg font-bold text-slate-900">🚀 AiBT 베타테스터 핵심 기능 가이드</h2>
        </div>

        {/* 슬라이드 영역 */}
        <div className="flex-1 overflow-hidden min-h-[560px] relative flex items-center justify-center">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={page}
              initial={{ x: 80, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -80, opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="absolute inset-0 px-8 py-6 flex flex-col items-center justify-center overflow-auto"
            >
              <div className="w-full max-w-2xl flex flex-col items-center justify-center text-center">
                {slide.title && !(isCouponPage && showCloseOnly) && <div className="mb-5">{slide.title}</div>}
                {slide.content !== null ? (
                  <>
                    <div className="text-slate-700 text-base leading-relaxed whitespace-pre-line break-words">
                      {renderContent(slide.content)}
                    </div>
                    {'image' in slide && slide.image && (
                      <div className="mt-5 flex justify-center items-center h-[247px] min-w-0">
                        <img
                          src={slide.image}
                          alt=""
                          className="h-[247px] w-auto max-w-none object-contain object-center rounded-lg"
                        />
                      </div>
                    )}
                  </>
                ) : (
                  /* 5페이지: 쿠폰코드 입력(최초) 또는 LNB 도움말 마지막(쿠폰 등록 후) */
                  <div className="text-slate-700 text-base leading-relaxed text-center w-full">
                    {showCouponInput && (
                      <>
                        <p className="mb-4">카카오톡 메신저를 통해 받으신 쿠폰번호를 입력해주세요.</p>
                        <input
                          type="text"
                          value={couponCode}
                          onChange={(e) => { setCouponCode(e.target.value); setCouponError(''); }}
                          placeholder="쿠폰 코드 입력"
                          className="w-full px-4 py-3.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium text-center"
                          disabled={couponLoading}
                        />
                        {couponError && <p className="mt-2 text-sm text-red-600">{couponError}</p>}
                        <p className="mt-6 text-slate-600 text-sm">
                          혹시 쿠폰코드를 아직 못받으셨거나, 문제가 있으실 경우
                          <br />
                          카카오톡 <span className="font-semibold text-slate-800">@aibt_beta</span> 로 문의주시면 베타 헬퍼가 도와드리겠습니다.
                        </p>
                      </>
                    )}
                    {showCloseOnly && (
                      <div className="text-slate-700 text-base leading-relaxed">
                        <p className="mb-4 text-blue-600 font-semibold">모든 학습자님들의 12회 빅데이터분석기사 필기 시험 합격을 기원합니다!</p>
                        <p className="mb-3">사용하시며 궁금하신 내용이나 발견한 오류 혹은 기대하시는 점들을 개발자에게 알려주세요!</p>
                        <p className="text-slate-600 text-sm">카카오톡 <span className="font-semibold text-slate-800">@aibt_beta</span></p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* 하단 버튼 */}
        <div className="shrink-0 px-6 py-4 border-t border-slate-200 bg-white flex items-center justify-between gap-3">
          {showCloseOnly ? (
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 rounded-xl bg-slate-900 text-white font-bold hover:bg-slate-800"
            >
              닫기
            </button>
          ) : showCouponInput ? (
            <>
              <button
                type="button"
                onClick={() => setPage((p) => p - 1)}
                className="px-5 py-3 rounded-xl border border-slate-300 font-bold text-slate-700 hover:bg-slate-50"
              >
                이전
              </button>
              <button
                type="button"
                onClick={handleCouponSubmit}
                disabled={couponLoading}
                className="flex-1 py-3 rounded-xl bg-blue-600 text-white font-bold hover:bg-blue-700 disabled:opacity-50"
              >
                {couponLoading ? '등록 중...' : '등록하기'}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={!slide.hasPrev}
                className="px-5 py-3 rounded-xl border border-slate-300 font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:pointer-events-none"
              >
                이전
              </button>
              <button
                type="button"
                onClick={() => setPage((p) => (p < SLIDES.length - 1 ? p + 1 : p))}
                className="flex-1 py-3 rounded-xl bg-blue-600 text-white font-bold hover:bg-blue-700"
              >
                다음
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
