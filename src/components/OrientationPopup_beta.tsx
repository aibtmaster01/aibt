/**
 * AiBT 전용 오리엔테이션 팝업.
 * - 난이도(레벨) 선택을 먼저 노출 (forced && !fromLNB 시).
 * - 오픈 베타: 마지막 슬라이드에서 안내 확인 후 진행.
 * App.tsx에서 useBetaCertifications일 때 이 컴포넌트 사용.
 */
import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { LogOut } from 'lucide-react';
import { APP_BRAND } from '../config/brand';

export type PrepLevel = 'beginner' | 'intermediate' | 'advanced';

export interface OrientationPopupBetaProps {
  forced?: boolean;
  fromLNB?: boolean;
  /** true: 업데이트 안내 후 플로우 → 난이도 선택 먼저, 마지막 페이지는 응원 문구+닫기만 */
  fromUpdateFlow?: boolean;
  onClose: () => void;
  onCouponRegistered?: () => void;
  onSelectLevel?: (level: PrepLevel) => void;
  onLogout?: () => void | Promise<void>;
  /** 레벨 선택 직전 업데이트 안내 화면에서 "새로운 진단 시작하기" 클릭 시 (seen 저장·이력 초기화 등) */
  onConfirmUpdateNotice?: () => void | Promise<void>;
  userId?: string;
  userEmail?: string;
}

const LEVEL_OPTIONS: { level: PrepLevel; icon: string; title: string; sub: string }[] = [
  { level: 'beginner', icon: '🔰', title: '초급이에요', sub: '요약정리만 1~2번 봤어요' },
  { level: 'intermediate', icon: '📚', title: '어느 정도 해봤어요', sub: '강의/교재 1회독 이상했어요' },
  { level: 'advanced', icon: '🎯', title: '많이 해봤어요', sub: '기출문제를 풀어봤어요' },
];

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
    title: <span className="font-bold text-blue-600">오픈 베타 안내</span>,
    content: null,
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

export function OrientationPopupBeta({
  forced = false,
  fromLNB = false,
  fromUpdateFlow = false,
  onClose,
  onCouponRegistered,
  onSelectLevel,
  onLogout,
  onConfirmUpdateNotice,
  userId = '',
  userEmail = '',
}: OrientationPopupBetaProps) {
  /** status 0·undefined·1 모두: 레벨 선택 플로우일 때 업뎃안내 무조건 먼저 → 레벨선택 → 오티(→ 마무리 안내) */
  const showLevelFirst = (forced && !fromLNB) || fromUpdateFlow;
  const [phase, setPhase] = useState<'update_notice' | 'level' | 'orientation'>(
    showLevelFirst ? 'update_notice' : 'orientation'
  );
  const [page, setPage] = useState(0);
  const [finishLoading, setFinishLoading] = useState(false);
  const [updateNoticeConfirming, setUpdateNoticeConfirming] = useState(false);

  const slide = SLIDES[page];
  const isCouponPage = slide?.content === null;
  const showOpenBetaFinishPage = isCouponPage && forced && !fromLNB && !fromUpdateFlow;
  const showCloseOnly = isCouponPage && (fromLNB || fromUpdateFlow);

  const handleLevelSelect = (level: PrepLevel) => {
    onSelectLevel?.(level);
    setPhase('orientation');
    setPage(0);
  };

  const handleOpenBetaFinish = async () => {
    setFinishLoading(true);
    try {
      onCouponRegistered?.();
      onClose();
    } finally {
      setFinishLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div
        className="relative w-full max-w-4xl bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[95vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-slate-900">
            {phase === 'update_notice'
              ? (APP_BRAND === 'AiBT' ? '🎉 AiBT 베타 2.0 - 더 똑똑해졌어요!' : '🎉 핀셋 베타 2.0 - 더 똑똑해졌어요!')
              : '🚀 AiBT 베타테스터 핵심 기능 가이드'}
          </h2>
          {onLogout && (
            <button
              type="button"
              onClick={async () => {
                await onLogout?.();
                onClose();
              }}
              className="flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-100 hover:border-slate-300 transition-colors"
            >
              <LogOut size={16} />
              로그아웃
            </button>
          )}
        </div>

        <div className="flex-1 overflow-hidden min-h-[560px] relative flex items-center justify-center">
          <AnimatePresence mode="wait" initial={false}>
            {phase === 'update_notice' ? (
              <motion.div
                key="update_notice"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
                className="absolute inset-0 px-8 py-6 flex flex-col items-center justify-center overflow-auto"
              >
                <div className="w-full max-w-2xl text-slate-600 text-base text-center space-y-4">
                  <p className="text-blue-600 font-semibold text-lg">
                    베타 테스터 피드백으로 더 나은 기능을 준비했습니다.
                  </p>
                  <p className="text-slate-400 text-xs text-center">
                    (26/3/10 12:00 기준)
                  </p>
                  <ul className="list-disc list-inside space-y-1.5 text-left text-slate-700">
                    <li>진단 50% 단축 (240→120문항)</li>
                    <li>문제 내 오류신고 기능 추가</li>
                    <li>과목별 안전도 영역 로직 개선</li>
                    <li>내 합격률 예측 로직 개선</li>
                  </ul>
                  <p className="text-slate-600 text-sm text-left">
                    * 합격률 예측은 정확한 측정을 위해, 실력 확인이 완료된 후 제공됩니다.
                  </p>
                  <p className="text-slate-500 text-sm text-left">
                    베타테스트 기간 푼 문제 데이터는, 개선된 로직에서 정교한 분석을 제공하기 위해 반영되지 않음을 양해 부탁드립니다.
                  </p>
                </div>
              </motion.div>
            ) : phase === 'level' ? (
              <motion.div
                key="level"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
                className="absolute inset-0 px-8 py-6 flex flex-col items-center justify-center overflow-auto"
              >
                <div className="w-full max-w-2xl flex flex-col items-center">
                  <h3 className="text-xl font-bold text-slate-900 mb-2">
                    빅데이터 분석기사 준비를 어디까지 해보셨나요?
                  </h3>
                  <p className="text-slate-600 mb-8">현재 학습 상태에 맞춰 실력을 진단합니다.</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full">
                    {LEVEL_OPTIONS.map((opt) => (
                      <button
                        key={opt.level}
                        type="button"
                        onClick={() => handleLevelSelect(opt.level)}
                        className="flex flex-col items-center justify-center p-6 rounded-xl border-2 border-slate-200 bg-white hover:border-blue-500 hover:bg-blue-50/50 transition-all text-left"
                      >
                        <span className="text-2xl mb-2">{opt.icon}</span>
                        <span className="font-semibold text-slate-900">{opt.title}</span>
                        <span className="text-sm text-slate-500 mt-1">{opt.sub}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </motion.div>
            ) : (
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
                  <div className="text-slate-700 text-base leading-relaxed text-center w-full">
                    {showOpenBetaFinishPage && (
                      <div className="text-slate-700 text-base leading-relaxed text-left max-w-xl mx-auto">
                        <p className="mb-4">
                          베타에 참여해 주셔서 감사합니다. 본 서비스는{' '}
                          <span className="font-semibold text-slate-900">2026년 4월 4일 빅데이터분석기사 필기 시험</span> 준비를 돕기 위해 무료로
                          제공되는 오픈 베타입니다.
                        </p>
                        <p className="text-slate-600 text-sm">
                          문의·피드백은 카카오톡 <span className="font-semibold text-slate-800">@aibt_beta</span> 로 연락 주세요.
                        </p>
                      </div>
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
            )}
          </AnimatePresence>
        </div>

        <div className="shrink-0 px-6 py-4 border-t border-slate-200 bg-white flex items-center justify-between gap-3">
          {phase === 'update_notice' ? (
            <button
              type="button"
              onClick={async () => {
                setUpdateNoticeConfirming(true);
                try {
                  await onConfirmUpdateNotice?.();
                  setPhase('level');
                } finally {
                  setUpdateNoticeConfirming(false);
                }
              }}
              disabled={updateNoticeConfirming}
              className="w-full py-3 rounded-xl bg-slate-900 text-white font-bold hover:bg-slate-800 disabled:opacity-50"
            >
              {updateNoticeConfirming ? '처리 중...' : '새로운 진단 시작하기'}
            </button>
          ) : phase === 'level' ? (
            <p className="text-slate-500 text-sm w-full text-center">위 카드 중 하나를 선택해 주세요.</p>
          ) : showCloseOnly ? (
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 rounded-xl bg-slate-900 text-white font-bold hover:bg-slate-800"
            >
              닫기
            </button>
          ) : showOpenBetaFinishPage ? (
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
                onClick={handleOpenBetaFinish}
                disabled={finishLoading}
                className="flex-1 py-3 rounded-xl bg-blue-600 text-white font-bold hover:bg-blue-700 disabled:opacity-50"
              >
                {finishLoading ? '처리 중...' : '학습 시작하기'}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  if (showLevelFirst && page === 0) setPhase('level');
                  else setPage((p) => Math.max(0, p - 1));
                }}
                disabled={!slide.hasPrev && !(showLevelFirst && page === 0)}
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
