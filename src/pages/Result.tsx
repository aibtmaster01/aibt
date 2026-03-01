import React, { useEffect, useState, useMemo } from 'react';
import { RefreshCcw, Lock, Ticket, CheckCircle, ArrowRight, FileText, ChevronDown, ChevronUp, StickyNote } from 'lucide-react';
import { User } from '../types';
import type { CertificationInfo, ExamResultSubjectScores, SubjectConfig } from '../types';
import { RichText } from '../components/RichText';
import { to1BasedAnswer } from '../utils/questionUtils';
import { getCertificationInfo } from '../services/gradingService';
import { CERTIFICATIONS } from '../constants';
import type { RoundMemo } from './Quiz';

export interface QuizAnswerRecord {
  qid: string;
  selected: number;
  isCorrect: boolean;
  isConfused?: boolean;
  elapsedSec?: number;
}

interface ResultProps {
  score: number;
  total: number;
  certId?: string | null;
  roundId?: string | null;
  user: User | null;
  isPaidUser?: boolean;
  sessionHistory?: QuizAnswerRecord[];
  questions?: import('../types').Question[];
  roundMemo?: RoundMemo | null;
  onHome: () => void;
  onRetry: () => void;
  /** 상단 우측 "학습 대시보드" 클릭 시 마이페이지로 이동 */
  onGoToDashboard?: () => void;
  /** CTA "다음 회차" 클릭 시 자동으로 다음 회차 불러오기 (맞춤형이면 5초 큐레이션 후 생성) */
  onNextRoundAuto?: () => void;
  onLogin: () => void;
  onGoToCheckout: () => void;
  /** 무료 회원이 2회차까지 이어서 학습할 때 (결제 화면이 아닌 모의고사 목록으로) */
  onContinueLearning?: () => void;
  showCouponEffect: boolean;
}

const MIN_SUBJECT_SCORE_FALLBACK = 40; // 과락선 기본값 (certification_info 없을 때)

type GradeBand = 'very_stable' | 'stable' | 'pass' | 'pass_but_subject_fail' | 'need_effort' | 'need_much_effort';

const GRADE_CONFIG: Record<
  GradeBand,
  { headline: string; guide: string; ctaLabel: string }
> = {
  very_stable: {
    headline: '대단해요! 완벽한 합격권입니다. 🎉',
    guide: '지금의 감각을 잊지 않도록, **최종 점검 훈련**으로 완벽하게 마무리해 볼까요?',
    ctaLabel: '합격 축하 쿠폰 받기',
  },
  stable: {
    headline: '안정적인 점수! 이 기세로 시험장까지 가요. 🚀',
    guide: '혹시 **[개념명]** 문제가 조금 헷갈리진 않으셨나요? 맞춤형 집중 훈련으로 실력을 더 탄탄하게 굳혀봐요!',
    ctaLabel: '맞춤형 집중 훈련하기',
  },
  pass: {
    headline: '합격입니다! 정말 고생 많으셨어요. 👍',
    guide: '시험장에서 실수하지 않도록, 헷갈렸던 **[개념명]** 집중 훈련으로 합격 확률을 확실히 높여두세요.',
    ctaLabel: '맞춤형 집중 훈련하기',
  },
  pass_but_subject_fail: {
    headline: '거의 다 왔어요! 합격선이 정말 코앞이에요 😲',
    guide: '**[과락한 과목명]**만 집중 훈련하면 합격 확률이 올라갈 거예요.',
    ctaLabel: '약점 집중 훈련하기',
  },
  need_effort: {
    headline: '완주 성공! 합격선이 정말 코앞이에요. 😊',
    guide: '**[개념명]** 같은 약점 개념들만 집중적으로 훈련하면,\n다음 라운드에선 무조건 합격할 수 있을 거예요!',
    ctaLabel: '약점 집중 훈련하기',
  },
  need_much_effort: {
    headline: '끝까지 풀어낸 끈기, 합격의 시작입니다! ✨',
    guide: '조급함은 잠시 내려두셔도 좋습니다.\n당신의 점수가 합격선에 닿을 때까지, **합격해**가 끝까지 함께 훈련할게요.',
    ctaLabel: '약점 집중 훈련하기',
  },
};

function computeSubjectScores(
  sessionHistory: QuizAnswerRecord[],
  questions: import('../types').Question[],
  subjects: SubjectConfig[]
): ExamResultSubjectScores {
  const qMap = new Map(questions.map((q) => [q.id, q]));
  const subjectCorrectTotal: Record<string, { correct: number; total: number }> = {};
  for (const rec of sessionHistory) {
    const q = qMap.get(rec.qid);
    const key = q?.subject_number != null ? String(q.subject_number) : '0';
    if (!subjectCorrectTotal[key]) subjectCorrectTotal[key] = { correct: 0, total: 0 };
    subjectCorrectTotal[key].total += 1;
    if (rec.isCorrect) subjectCorrectTotal[key].correct += 1;
  }
  const scorePerQ = subjects[0]?.score_per_question ?? 5;
  const out: ExamResultSubjectScores = {};
  for (const subj of subjects) {
    const key = String(subj.subject_number);
    const ct = subjectCorrectTotal[key] ?? { correct: 0, total: 0 };
    const totalPossible = (ct.total || 0) * scorePerQ;
    const score = totalPossible > 0
      ? Math.round((ct.correct * scorePerQ / totalPossible) * 100)
      : 0;
    out[key] = Math.min(100, Math.max(0, score));
  }
  return out;
}

function getGradeBand(totalScore100: number, hasSubjectFail?: boolean): GradeBand {
  if (totalScore100 >= 90 && !hasSubjectFail) return 'very_stable';
  if (totalScore100 >= 80 && !hasSubjectFail) return 'stable';
  if (totalScore100 >= 60 && hasSubjectFail) return 'pass_but_subject_fail';
  if (totalScore100 >= 60) return 'pass';
  if (totalScore100 >= 40) return 'need_effort';
  return 'need_much_effort';
}

function getWeakestHierarchy(
  sessionHistory: QuizAnswerRecord[],
  questions: import('../types').Question[]
): string {
  const qMap = new Map(questions.map((q) => [q.id, q]));
  const byHierarchy: Record<string, { correct: number; total: number }> = {};
  for (const rec of sessionHistory) {
    const q = qMap.get(rec.qid);
    const h = (q?.core_concept ?? '').trim() || '기타';
    if (!byHierarchy[h]) byHierarchy[h] = { correct: 0, total: 0 };
    byHierarchy[h].total += 1;
    if (rec.isCorrect) byHierarchy[h].correct += 1;
  }
  let worst = '기타';
  let worstRate = 1;
  for (const [h, v] of Object.entries(byHierarchy)) {
    if (v.total < 1) continue;
    const rate = v.correct / v.total;
    if (rate < worstRate) {
      worstRate = rate;
      worst = h;
    }
  }
  return worst;
}

/** 과목별 점수(만점 기준)가 과락선 미만이면 true */
function isSubjectFail(points: number, minSubjectScore: number): boolean {
  return points < minSubjectScore;
}

export const Result: React.FC<ResultProps> = ({
  score,
  total,
  certId,
  roundId,
  user,
  isPaidUser = false,
  sessionHistory,
  questions,
  roundMemo,
  onHome,
  onRetry,
  onGoToDashboard,
  onNextRoundAuto,
  onLogin,
  onGoToCheckout,
  onContinueLearning,
  showCouponEffect,
}) => {
  const [certInfo, setCertInfo] = useState<CertificationInfo | null>(null);

  const { subject_scores, subjectDetails, totalScore100, gradeBand, weakestConcept, conceptRatesThisRound, failedSubjectNames } = useMemo(() => {
    const subjects = certInfo?.subjects ?? [];
    let subjScores: ExamResultSubjectScores = {};
    const details: Record<string, { correct: number; total: number }> = {};
    if (sessionHistory?.length && questions?.length && subjects.length) {
      subjScores = computeSubjectScores(sessionHistory, questions, subjects);
      const qMap = new Map<string, import('../types').Question>(questions.map((q) => [q.id, q]));
      for (const rec of sessionHistory) {
        const q = qMap.get(rec.qid);
        const key = q?.subject_number != null ? String(q.subject_number) : '0';
        if (!details[key]) details[key] = { correct: 0, total: 0 };
        details[key].total += 1;
        if (rec.isCorrect) details[key].correct += 1;
      }
    }
    const totalScore100 =
      Object.keys(subjScores).length > 0
        ? Math.round(
            Object.values(subjScores).reduce((a, b) => a + b, 0) / Object.keys(subjScores).length
          )
        : Math.round((score / total) * 100);

    const minSubjectScore = certInfo?.exam_config?.pass_criteria?.min_subject_score ?? MIN_SUBJECT_SCORE_FALLBACK;
    const scorePerQ = subjects[0]?.score_per_question ?? 5;
    const failedSubjectNames: string[] = [];
    for (const subj of subjects) {
      const key = String(subj.subject_number);
      const ct = details[key] ?? { correct: 0, total: 0 };
      const points = ct.total > 0 ? ct.correct * scorePerQ : 0;
      if (isSubjectFail(points, minSubjectScore)) failedSubjectNames.push(subj.name);
    }
    const hasSubjectFail = failedSubjectNames.length > 0;

    const gradeBand = getGradeBand(totalScore100, hasSubjectFail);
    const weakestConcept =
      sessionHistory?.length && questions?.length
        ? getWeakestHierarchy(sessionHistory, questions)
        : '';

    // 해당 과목 전체 개념을 고정 순서로, 이 회차 기준 이해도(또는 N/A) 계산
    const conceptRatesThisRound: { name: string; rate: number | null }[] = (() => {
      const order = certInfo?.core_concept_order?.length
        ? certInfo.core_concept_order
        : (() => {
            if (!questions?.length) return [];
            const set = new Set<string>();
            questions.forEach((q) => {
              const h = (q.core_concept ?? '').trim() || '기타';
              set.add(h);
            });
            return Array.from(set).sort((a, b) => a.localeCompare(b));
          })();
      if (!order.length) return [];

      const qMap = new Map<string, import('../types').Question>(questions?.map((q) => [q.id, q]) ?? []);
      const byHierarchy: Record<string, { correct: number; total: number }> = {};
      for (const rec of sessionHistory ?? []) {
        const q = qMap.get(rec.qid);
        const h = (q?.core_concept ?? '').trim() || '기타';
        if (!byHierarchy[h]) byHierarchy[h] = { correct: 0, total: 0 };
        byHierarchy[h].total += 1;
        if (rec.isCorrect) byHierarchy[h].correct += 1;
      }

      return order.map((name) => {
        const stat = byHierarchy[name];
        if (!stat || stat.total < 1) return { name, rate: null };
        const rate = Math.round((stat.correct / stat.total) * 100);
        return { name, rate: Math.max(0, Math.min(100, rate)) };
      });
    })();

    return {
      subject_scores: subjScores,
      subjectDetails: details,
      totalScore100,
      gradeBand,
      weakestConcept,
      conceptRatesThisRound,
      failedSubjectNames,
    };
  }, [certInfo, sessionHistory, questions, score, total]);

  useEffect(() => {
    if (!certId) return;
    const cert = CERTIFICATIONS.find((c) => c.id === certId);
    if (!cert?.code) return;
    getCertificationInfo(cert.code).then(setCertInfo);
  }, [certId]);

  const isPass = totalScore100 >= 60 && failedSubjectNames.length === 0;
  const isGuest = !user;
  const showCouponCta = !isGuest && !isPaidUser;
  const [showFullReview, setShowFullReview] = useState(false);
  const canShowFullReview = !isGuest && questions && questions.length > 0 && sessionHistory && sessionHistory.length > 0;
  const wrongAnswerItems = canShowFullReview
    ? questions!
        .map((q, idx) => ({ q, idx, rec: sessionHistory![idx] }))
        .filter(({ rec }) => rec && !rec.isCorrect)
    : [];

  const gradeCfg = GRADE_CONFIG[gradeBand];
  const guideRaw = gradeBand === 'pass_but_subject_fail'
    ? gradeCfg.guide.replace(/\[과락한 과목명\]/g, failedSubjectNames.length > 0 ? failedSubjectNames.join(', ') : '해당 과목')
    : gradeCfg.guide.replace(/\[개념명\]/g, weakestConcept || '해당 개념');
  const guideWithBreaks = guideRaw.split(/\n/);

  const isFocusTrainingMode =
    roundId === '__subject_strength__' ||
    roundId === '__weak_type_focus__' ||
    roundId === '__weak_concept_focus__';

  useEffect(() => {
    if (showCouponEffect) {}
  }, [showCouponEffect]);

  const hasSubjectTable = certInfo?.subjects?.length && Object.keys(subject_scores).length > 0;

  return (
    <div className="min-h-screen bg-[#edf1f5] relative overflow-hidden">
      {showCouponEffect && (
        <div className="absolute inset-0 pointer-events-none z-50 overflow-hidden">
          <div className="absolute top-0 left-1/4 w-3 h-3 bg-red-500 rounded-full animate-[bounce_2s_infinite]"></div>
          <div className="absolute top-10 left-1/2 w-4 h-4 bg-blue-500 rotate-45 animate-[bounce_2.5s_infinite]"></div>
          <div className="absolute top-5 left-3/4 w-2 h-2 bg-yellow-500 rounded-full animate-[bounce_1.8s_infinite]"></div>
          <div className="absolute top-20 right-10 w-3 h-3 bg-green-500 animate-[bounce_3s_infinite]"></div>
        </div>
      )}

      <div className="max-w-6xl mx-auto px-5 py-12 pt-16 relative z-10">
        {/* 상단: 다시 풀기 / 학습 대시보드 */}
        <div className="flex justify-end gap-2 mb-4">
          <button
            type="button"
            onClick={onRetry}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-200 text-slate-600 text-sm font-semibold hover:bg-slate-50"
          >
            <RefreshCcw size={16} /> 다시 풀기
          </button>
          <button
            type="button"
            onClick={onGoToDashboard ?? onHome}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-brand-200 bg-brand-50 text-slate-800 text-sm font-semibold hover:bg-brand-100"
          >
            <ArrowRight size={16} /> 학습 대시보드
          </button>
        </div>

        <div className="text-center mb-8">
          <div className="mb-6 relative">
            {!isFocusTrainingMode && (
              <span className="text-6xl block animate-[pop_0.4s_ease-out]">{isPass ? '🎉' : '🔥'}</span>
            )}
          </div>
          <h1 className="text-4xl font-black text-slate-900 mb-2">
            {isFocusTrainingMode ? '집중 학습을 마쳤어요' : isGuest ? '수고하셨습니다!' : gradeCfg.headline}
          </h1>
          {!isGuest && !isFocusTrainingMode && guideWithBreaks.length > 0 && (
            <p className="text-slate-600 mb-2 text-lg">
              {guideWithBreaks.map((line, lineIdx) => (
                <React.Fragment key={lineIdx}>
                  {lineIdx > 0 && <br />}
                  {(() => {
                    const parts: { type: 'text' | 'highlight'; s: string }[] = [];
                    const lineRe = /\*\*([^*]+)\*\*/g;
                    let last = 0;
                    let mm: RegExpExecArray | null;
                    while ((mm = lineRe.exec(line)) !== null) {
                      if (mm.index > last) parts.push({ type: 'text', s: line.slice(last, mm.index) });
                      parts.push({ type: 'highlight', s: mm[1] });
                      last = mm.index + mm[0].length;
                    }
                    if (last < line.length) parts.push({ type: 'text', s: line.slice(last) });
                    return parts.map((part, i) =>
                      part.type === 'highlight' ? (
                        <span key={i} className="text-brand-600 font-bold">{part.s}</span>
                      ) : (
                        <span key={i}>{part.s}</span>
                      )
                    );
                  })()}
                </React.Fragment>
              ))}
            </p>
          )}
          {isGuest && (
            <p className="text-slate-500 mb-2 text-lg">첫 번째 모의고사를 끝까지 완료하셨네요.</p>
          )}
        </div>

        {/* Total Score + 과목별 (집중학습 모드에서는 미노출) */}
        {!isFocusTrainingMode && (
        <div className="bg-white border border-slate-200 rounded-[2rem] p-8 mb-6 shadow-xl shadow-slate-200/50">
          <div className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4">Total Score</div>
          <div className="flex items-baseline justify-center gap-1 mb-4">
            <span className={`text-6xl font-black ${isPass ? 'text-brand-500' : 'text-slate-800'}`}>
              {hasSubjectTable ? totalScore100 : Math.round((score / total) * 100)}
            </span>
            <span className="text-2xl text-slate-300 font-bold">/ 100</span>
          </div>
          <div className="w-full bg-slate-100 h-3 rounded-full overflow-hidden mb-2 relative">
            <div
              className={`h-full rounded-full transition-all duration-700 ${isPass ? 'bg-brand-500' : 'bg-slate-400'}`}
              style={{ width: `${Math.min(100, totalScore100)}%` }}
            />
            <div
              className="absolute top-0 w-0.5 h-full bg-[#0034d3] opacity-90"
              style={{ left: '60%' }}
              title="합격선 60점"
            />
          </div>
          <p className="text-xs text-slate-400 mb-4">
            <span className="inline-block w-2 h-0.5 bg-[#0034d3] align-middle mr-1" /> 합격선 60점
          </p>

          {hasSubjectTable && certInfo?.subjects && (
            <div className="border-t border-slate-100 pt-4">
              <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">과목별 점수</div>
              <table className="w-full text-left text-sm border border-slate-200 rounded-xl overflow-hidden">
                <thead>
                  <tr className="bg-slate-50 text-slate-600 border-b border-slate-200">
                    <th className="py-2.5 pl-4 font-semibold w-12">No.</th>
                    <th className="py-2.5 font-semibold">과목명</th>
                    <th className="py-2.5 pr-4 font-semibold text-right w-28">점수</th>
                    <th className="py-2.5 pr-4 font-semibold text-center w-20">과락</th>
                  </tr>
                </thead>
                <tbody>
                  {certInfo.subjects.map((subj, i) => {
                    const key = String(subj.subject_number);
                    const s = subject_scores[key] ?? 0;
                    const ct = subjectDetails[key] ?? { correct: 0, total: 0 };
                    const scorePerQ = subj.score_per_question ?? certInfo.subjects?.[0]?.score_per_question ?? 5;
                    const points = ct.total > 0 ? ct.correct * scorePerQ : 0;
                    const minSubjectScore = certInfo.exam_config?.pass_criteria?.min_subject_score ?? MIN_SUBJECT_SCORE_FALLBACK;
                    const failed = isSubjectFail(points, minSubjectScore);
                    return (
                      <tr key={subj.subject_number} className="border-b border-slate-100">
                        <td className="py-2.5 pl-4 text-slate-600">{i + 1}</td>
                        <td className="py-2.5 text-slate-800">{subj.name}</td>
                        <td className={`py-2.5 pr-4 text-right font-medium ${failed ? 'text-red-600 font-bold' : 'text-slate-800'}`}>
                          {points}점 ({ct.correct}/{ct.total})
                        </td>
                        <td className={`py-2.5 pr-4 text-center font-semibold ${failed ? 'text-red-600' : 'text-blue-600'}`}>
                          {failed ? '과락' : '합격'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-100 font-bold border-t-2 border-slate-200">
                    <td className="py-3 pl-4 text-slate-500">—</td>
                    <td className="py-3 text-slate-800">총점</td>
                    <td className={`py-3 pr-4 text-right ${totalScore100 >= 60 ? 'text-brand-600' : 'text-slate-700'}`}>
                      {totalScore100}/100
                    </td>
                    <td className={`py-3 pr-4 text-center font-bold ${isPass ? 'text-blue-600' : 'text-red-600'}`}>
                      {isPass ? '합격' : '불합격'}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
        )}

        {isGuest && (
          <div className="relative">
            <div className="filter blur-md opacity-50 select-none pointer-events-none" aria-hidden="true">
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="bg-white p-6 rounded-2xl border border-slate-200"><div className="h-4 bg-slate-200 rounded w-1/2 mb-2"></div><div className="h-8 bg-slate-300 rounded w-full"></div></div>
                <div className="bg-white p-6 rounded-2xl border border-slate-200"><div className="h-4 bg-slate-200 rounded w-1/2 mb-2"></div><div className="h-8 bg-slate-300 rounded w-full"></div></div>
              </div>
            </div>
            <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-full max-w-sm">
              <div className="bg-slate-900 text-white p-8 rounded-3xl shadow-2xl text-center border border-slate-700">
                <div className="w-16 h-16 bg-brand-500 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-900">
                  <Lock size={32} />
                </div>
                <h3 className="text-xl font-bold mb-2">상세 분석 리포트 잠금</h3>
                <p className="text-slate-400 text-sm mb-6">
                  회원가입하고 상세 리포트와<br />
                  <span className="text-brand-400 font-bold">10,000원 쿠폰</span>을 받아보세요.
                </p>
                <button onClick={onLogin} className="w-full bg-white text-slate-900 font-bold py-4 rounded-xl hover:bg-brand-50">
                  리포트 & 쿠폰 받기
                </button>
              </div>
            </div>
          </div>
        )}

        {!isGuest && (
          <div className="animate-slide-up space-y-4">
            {!isFocusTrainingMode && (
              <>
            {showCouponEffect && !isPaidUser && (
              <div className="bg-gradient-to-br from-brand-50 to-white border-2 border-brand-200 rounded-2xl p-6 text-left relative overflow-hidden">
                <div className="absolute top-0 right-0 p-4 opacity-10">
                  <Ticket size={120} className="text-brand-500" />
                </div>
                <div className="relative z-10 flex items-center gap-4">
                  <div className="w-12 h-12 bg-brand-500 rounded-full flex items-center justify-center text-white shrink-0">
                    <Ticket size={24} />
                  </div>
                  <div>
                    <div className="text-brand-600 font-black text-xs uppercase mb-1">Coupon Issued</div>
                    <h3 className="text-lg font-bold text-slate-900">첫 수강 응원 10,000원 쿠폰 지급 완료!</h3>
                    <p className="text-slate-500 text-sm">지금 바로 사용하여 최저가로 합격하세요.</p>
                  </div>
                </div>
              </div>
            )}

            {/* 등급별 CTA: 매우안정=쿠폰만 결제로, 그 외 무료회원=계속해서 학습하기(모의고사 목록) */}
            {showCouponCta && gradeBand === 'very_stable' && (
              <button
                onClick={onGoToCheckout}
                className="w-full bg-slate-900 text-white font-bold py-4 rounded-2xl hover:bg-slate-800 flex items-center justify-center gap-2"
              >
                <CheckCircle size={20} /> {gradeCfg.ctaLabel}
              </button>
            )}
            {showCouponCta && gradeBand !== 'very_stable' && (
              <button
                onClick={onContinueLearning ?? onHome}
                className="w-full bg-slate-900 text-white font-bold py-4 rounded-2xl hover:bg-slate-800 flex items-center justify-center gap-2"
              >
                <ArrowRight size={20} /> 계속해서 학습하기
              </button>
            )}
            {isPaidUser && !showCouponCta && (
              <button
                onClick={onNextRoundAuto ?? onHome}
                className="w-full bg-slate-900 text-white font-bold py-4 rounded-2xl hover:bg-slate-800 flex items-center justify-center gap-2"
              >
                <ArrowRight size={20} /> 다음 회차
              </button>
            )}
              </>
            )}

            {/* 회차 메모: 풀이 중 찍어둔 메모 (오답 화면에서 다시 보기) */}
            {roundMemo && (roundMemo.freeText.trim() || roundMemo.pins.length > 0) && (
              <div className="bg-white p-6 rounded-2xl border border-[#0034d3]/30 text-left mb-6">
                <h3 className="font-bold text-slate-900 mb-4 flex items-center gap-2">
                  <StickyNote size={18} className="text-[#0034d3]" /> 회차 메모
                </h3>
                {roundMemo.freeText.trim() && (
                  <p className="text-sm text-slate-700 whitespace-pre-wrap mb-4">{roundMemo.freeText.trim()}</p>
                )}
                {roundMemo.pins.length > 0 && (
                  <div className="space-y-2">
                    {roundMemo.pins.map((p, i) => (
                      <div key={i} className="text-sm text-slate-700 pl-2 border-l-2 border-[#0034d3]/30">
                        <span className="font-bold text-slate-900">Q. {p.qNumber}</span> {p.text}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 오답 문제: 상위 2개는 설명+오답이유, 나머지 dim */}
            {canShowFullReview && wrongAnswerItems.length > 0 && (
              <div className="bg-white p-6 rounded-2xl border border-slate-200 text-left">
                <h3 className="font-bold text-slate-900 mb-4 flex items-center gap-2">
                  <FileText size={18} className="text-red-500" /> 오답 문제 ({wrongAnswerItems.length}개)
                </h3>
                <div className="space-y-4">
                  {wrongAnswerItems.map(({ q, idx, rec }, listIdx) => {
                    const optLen = q.options?.length ?? 0;
                    const selectedNum = Math.min(Math.max(rec.selected, 1), optLen || 4);
                    const answerNum = to1BasedAnswer(q.answer, optLen);
                    const selectedText = (q.options && selectedNum >= 1 && q.options[selectedNum - 1]) ? q.options[selectedNum - 1] : '-';
                    const correctText = (answerNum >= 1 && q.options?.[answerNum - 1]) ? q.options[answerNum - 1] : (q.explanation ? '(해설 참고)' : '—');
                    const wrongReason = q.wrongFeedback && (q.wrongFeedback[String(selectedNum)] ?? q.wrongFeedback[String(rec.selected)]);
                    const showWrongReason = isPaidUser || listIdx < 2;
                    return (
                      <div
                        key={q.id}
                        className="p-4 rounded-xl border border-red-200 bg-red-50 text-left"
                      >
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          <span className="text-xs font-bold px-2 py-0.5 rounded bg-red-200 text-red-800">오답</span>
                          <span className="text-slate-500 text-sm">문제 {idx + 1}</span>
                          {rec?.isConfused && (
                            <span className="text-xs font-bold text-[#0034d3] bg-[#99ccff] px-2 py-0.5 rounded">*헷갈린 문제*</span>
                          )}
                        </div>
                        <p className="text-sm font-medium text-slate-900 leading-relaxed"><RichText content={q.content} as="span" /></p>
                        {Array.isArray(q.options) && q.options.length > 0 && (
                          <div className="mt-2 text-xs text-slate-600 space-y-1">
                            <span className="font-semibold text-slate-500">보기</span>
                            {q.options.map((opt, i) => (
                              <div key={i} className="pl-1">
                                {['①', '②', '③', '④', '⑤', '⑥'][i] ?? `${i + 1}.`} <RichText content={opt} as="span" />
                              </div>
                            ))}
                          </div>
                        )}
                        {/* 보기 ~ 정답 구분선 */}
                        <div className="mt-3 pt-3 border-t border-red-100" />
                        {/* 정답 (형광펜) */}
                        <p className="text-xs mt-2">
                          <span className="bg-black text-white font-bold px-1.5 py-0.5 rounded">정답</span>
                          <span className="text-green-600 ml-1.5">{answerNum >= 1 && answerNum <= 6 ? ['①','②','③','④','⑤','⑥'][answerNum - 1] + ' ' : ''}<RichText content={correctText} as="span" /></span>
                        </p>
                        {/* 정답 해설: 말머리 + 해설 */}
                        {q.explanation && (
                          <p className="text-xs text-slate-600 mt-2">
                            <span className="font-semibold text-slate-700">정답 해설: </span>
                            <RichText content={q.explanation} as="span" />
                          </p>
                        )}
                        {/* 구분선 */}
                        <div className="mt-3 pt-3 border-t border-red-100" />
                        {/* 내 선택 (형광펜) */}
                        <p className="text-xs text-slate-600 mt-2">
                          <span className="bg-black text-white font-bold px-1.5 py-0.5 rounded">내 선택</span>
                          <span className="ml-1.5 text-red-600 font-medium">{selectedNum >= 1 && selectedNum <= 6 ? ['①','②','③','④','⑤','⑥'][selectedNum - 1] + ' ' : ''}<RichText content={selectedText} as="span" /></span>
                        </p>
                        {/* 오답이유 (정답 해설처럼 볼드, 형광펜 없음) 또는 무료/게스트 CTA */}
                        {showWrongReason && wrongReason && (
                          <p className="text-xs text-slate-600 mt-2">
                            <span className="font-semibold text-slate-700">오답이유: </span>
                            <RichText content={wrongReason} as="span" />
                          </p>
                        )}
                        {!showWrongReason && (
                          <p className="text-xs mt-2">
                            <span className="font-semibold text-slate-700">오답이유: </span>
                            <span className="italic text-[#0034d3]/90">
                              <button type="button" onClick={onGoToCheckout} className="text-left hover:underline">
                                열공모드에 가입하고 내가 왜 틀렸는지 알아보세요
                              </button>
                            </span>
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="mt-4 pt-4 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                    className="w-full py-3 rounded-xl border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 flex items-center justify-center gap-2"
                  >
                    <ChevronUp size={18} /> 최상단으로 이동
                  </button>
                </div>
              </div>
            )}

            {/* 문제 전체 보기 */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 text-left">
              <button
                type="button"
                onClick={() => setShowFullReview((v) => !v)}
                className="w-full flex items-center justify-between font-bold text-slate-900 mb-2"
              >
                <span className="flex items-center gap-2">
                  <FileText size={18} className="text-brand-500" /> 문제 전체 보기
                </span>
                {showFullReview ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
              </button>
              {showFullReview && (
                <div className="mt-4 space-y-4 border-t border-slate-100 pt-4">
                  {questions!.map((q, idx) => {
                    const rec = sessionHistory![idx];
                    const isCorrect = rec?.isCorrect ?? false;
                    const optLen = q.options?.length ?? 0;
                    const selectedNum = (rec && (optLen ? Math.min(Math.max(rec.selected, 1), optLen) : rec.selected)) ?? 0;
                    const answerNum = to1BasedAnswer(q.answer, optLen);
                    const selectedText = (q.options && selectedNum >= 1 && q.options[selectedNum - 1]) ? q.options[selectedNum - 1] : '-';
                    const correctText = (answerNum >= 1 && q.options?.[answerNum - 1]) ? q.options[answerNum - 1] : (q.explanation ? '(해설 참고)' : '—');
                    return (
                      <div
                        key={q.id}
                        className={`p-4 rounded-xl border text-left ${isCorrect ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}
                      >
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          <span className={`text-xs font-bold px-2 py-0.5 rounded ${isCorrect ? 'bg-green-200 text-green-800' : 'bg-red-200 text-red-800'}`}>
                            {isCorrect ? '정답' : '오답'}
                          </span>
                          <span className="text-slate-500 text-sm">문제 {idx + 1}</span>
                          {rec?.isConfused && (
                            <span className="text-xs font-bold text-[#0034d3] bg-[#99ccff] px-2 py-0.5 rounded">*헷갈린 문제*</span>
                          )}
                        </div>
                        <p className="text-sm font-medium text-slate-900 leading-relaxed"><RichText content={q.content} as="span" /></p>
                        {Array.isArray(q.options) && q.options.length > 0 && (
                          <div className="mt-2 text-xs text-slate-600 space-y-1">
                            <span className="font-semibold text-slate-500">보기</span>
                            {q.options.map((opt, i) => (
                              <div key={i} className="pl-1">
                                {['①', '②', '③', '④', '⑤', '⑥'][i] ?? `${i + 1}.`} <RichText content={opt} as="span" />
                              </div>
                            ))}
                          </div>
                        )}
                        {rec != null && (
                          <div className="text-xs text-slate-500 mt-3 space-y-1">
                            <p>내 선택: <span className={isCorrect ? 'text-slate-700' : 'text-red-600 font-medium'}>{selectedNum >= 1 && selectedNum <= 6 ? ['①','②','③','④','⑤','⑥'][selectedNum - 1] + ' ' : ''}<RichText content={selectedText} as="span" /></span></p>
                            {!isCorrect && <p className="text-green-600">정답: {answerNum >= 1 && answerNum <= 6 ? ['①','②','③','④','⑤','⑥'][answerNum - 1] + ' ' : ''}<RichText content={correctText} as="span" /></p>}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
