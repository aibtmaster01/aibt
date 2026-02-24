import React, { useRef, useState } from 'react';
import { ArrowRight, Brain, Target, Database, Code, FileText, PlayCircle, Quote, Plus, Minus, User as UserIcon, Heart } from 'lucide-react';
import { CERTIFICATIONS, CERT_IDS_WITH_QUESTIONS, EXAM_ROUNDS } from '../constants';
import { getCertDisplayName } from '../services/gradingService';
import { useAllCertificationInfos } from '../hooks/useCertificationInfo';
import { User } from '../types';
import { getNearestExamDate } from '../utils/dateUtils';

interface HomeProps {
  user: User | null;
  onNavigateToLogin: () => void;
  onNavigateToDashboard: () => void;
  onStartDiagnostic: (certId: string, dateId: string) => void;
}

const TESTIMONIALS = Array.from({ length: 15 }).map((_, i) => ({
  id: i,
  name: `김*${String.fromCharCode(65 + i)}`,
  exam: i % 3 === 0 ? '빅데이터분석기사' : i % 3 === 1 ? 'SQLD' : 'ADsP',
  text: i % 2 === 0
    ? '비전공자라 용어부터 막막했는데, AI가 제 수준에 딱 맞는 문제부터 추천해줘서 2주 만에 합격했습니다! 오답 노트가 진짜 신의 한 수였어요.'
    : '기출문제만 무작정 돌리다가 2번이나 떨어졌어요. AIbT에서 취약 유형 분석받고 그 부분만 집중 공략하니 점수가 20점이나 올랐습니다.',
  rating: 5,
}));

const FAQS = [
  { q: '비전공자도 이용할 수 있나요?', a: '네, 물론입니다. AIbT는 초기 진단 평가를 통해 사용자 개인별 수준을 정밀하게 분석합니다. 기초가 부족한 비전공자에게는 핵심 개념 위주의 커리큘럼을, 실전 감각이 필요한 전공자에게는 고난도 킬러 문항을 추천하여 단계적으로 합격선에 도달하도록 돕습니다.' },
  { q: 'AI 모의고사는 어떤 원리인가요?', a: 'AIbT의 알고리즘은 사용자의 문제 풀이 패턴, 소요 시간, 오답 원인 등을 실시간으로 학습합니다. 이를 바탕으로 출제 가능성이 높은 문제와 사용자가 가장 취약한 유형을 조합하여 매번 새로운 \'나만의 시험지\'를 생성합니다.' },
  { q: '결제 후 환불 규정은 어떻게 되나요?', a: '결제일로부터 7일 이내에 콘텐츠를 전혀 이용하지 않은 경우 전액 환불이 가능합니다. 단, 모의고사를 1회 이상 응시하거나 오답노트 등의 유료 콘텐츠를 열람한 경우에는 이용 분량을 제외하고 부분 환불됩니다.' },
  { q: '모바일에서도 문제 풀이가 가능한가요?', a: '네, PC, 태블릿, 모바일 등 모든 기기에서 최적화된 학습 환경을 제공합니다. 출퇴근길 지하철이나 버스에서도 간편하게 퀴즈를 풀고, 자기 전 침대에서 오답 노트를 복습하세요.' },
];

export const Home: React.FC<HomeProps> = ({
  user,
  onNavigateToLogin,
  onNavigateToDashboard,
  onStartDiagnostic,
}) => {
  const certificationsSectionRef = useRef<HTMLDivElement>(null);
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(null);
  const { certInfos } = useAllCertificationInfos();

  const scrollToCertifications = () => {
    certificationsSectionRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const toggleFaq = (index: number) => {
    setOpenFaqIndex(openFaqIndex === index ? null : index);
  };

  const hasHistory = !!user && (
    (user.subscriptions?.length ?? 0) > 0 ||
    (user.paidCertIds?.length ?? 0) > 0 ||
    (user.targetExamDateByCert && Object.keys(user.targetExamDateByCert).length > 0) ||
    (user.weaknessTrialUsedByCert && Object.keys(user.weaknessTrialUsedByCert).length > 0)
  );

  const handleStartDiagnosticForCert = (certId: string) => {
    if (!CERT_IDS_WITH_QUESTIONS.includes(certId)) {
      alert('해당 자격증의 AI 진단고사는 현재 업데이트 준비 중입니다.');
      return;
    }
    const diagnosticRound = EXAM_ROUNDS.find((r) => r.certId === certId && r.type === 'diagnostic') || EXAM_ROUNDS.find((r) => r.certId === certId);
    if (!diagnosticRound) {
      alert('해당 자격증의 AI 진단고사는 현재 업데이트 준비 중입니다.');
      return;
    }
    const result = getNearestExamDate(certId);
    if (result) {
      onStartDiagnostic(certId, result.dateId);
    }
  };

  // 리디자인 예정. App.tsx에서 '/' 경로는 로그인 시 마이페이지, 비로그인 시 자격증 목록(EmptyState)으로 렌더링됩니다.
  return null;
  // ---- 아래 기존 랜딩 UI (리디자인 시 참고용으로 유지) ----
  return (
    <div className="flex flex-col">
      {/* 1. HeroSection */}
      <section className="bg-brand-50 pt-20 pb-32 px-5 relative overflow-hidden">
        <div className="max-w-6xl mx-auto relative z-10">
          <div className="flex flex-col md:flex-row items-center gap-16">
            <div className="flex-1 text-left">
              <div className="inline-block py-1 px-3 rounded border border-brand-200 bg-white/50 backdrop-blur-sm text-brand-700 text-[10px] font-black uppercase tracking-widest mb-8">
                AI 초단기 합격 패스
              </div>
              <h1 className="text-5xl md:text-7xl font-black text-slate-900 mb-8 leading-[1.15] tracking-tight">
                단기 합격의 지름길,<br />
                <span className="text-brand-500">AI 초단기 합격 패스</span>
              </h1>
              <p className="text-slate-600 text-lg md:text-xl mb-12 max-w-2xl leading-relaxed break-keep font-medium">
                기출문제 무한 반복은 이제 그만.<br className="hidden md:block" />
                3인의 AI가 설계한 초정밀 알고리즘으로 가장 빠르게 합격선에 진입하세요.
              </p>
              <button
                onClick={hasHistory ? onNavigateToDashboard : scrollToCertifications}
                className="bg-slate-900 text-white font-bold py-4 px-8 rounded-xl hover:bg-slate-800 transition-all shadow-lg hover:shadow-xl hover:-translate-y-1 flex items-center justify-center gap-2 w-fit"
              >
                {hasHistory ? '나의 학습 대시보드 입장하기' : '무료로 내 실력 진단받기'} <ArrowRight size={18} />
              </button>
            </div>
            <div className="w-full md:w-96 bg-white rounded-[2rem] shadow-2xl p-8 border border-slate-200 relative animate-slide-up">
              <div className="absolute -top-4 -right-4 bg-slate-900 text-white px-4 py-1 rounded-full text-xs font-bold transform rotate-6 shadow-lg">
                ⚡ 3초 만에 시작
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-6 flex items-center gap-2">
                <Target className="text-brand-500" />
                {user ? '학습 이어가기' : '로그인하고 학습 이어가기'}
              </h3>
              <button
                onClick={user ? onNavigateToDashboard : onNavigateToLogin}
                className="w-full bg-slate-900 text-white font-bold py-4 rounded-xl hover:bg-slate-800 transition-all shadow-lg hover:shadow-xl hover:-translate-y-1 flex items-center justify-center gap-2"
              >
                {user ? '마이페이지 가기' : '로그인'} <ArrowRight size={18} />
              </button>
              {!hasHistory && (
                <p className="text-center text-xs text-slate-400 mt-4">
                  아래에서 자격증을 선택하면 로그인 없이 무료 진단평가를 받을 수 있어요.
                </p>
              )}
            </div>
          </div>
        </div>
        <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-brand-200/40 rounded-full blur-[100px] -translate-y-1/4 translate-x-1/3 z-0" />
        <div className="absolute bottom-0 left-0 w-80 h-80 bg-brand-300/30 rounded-full blur-[80px] translate-y-1/3 -translate-x-1/4 z-0" />
      </section>

      {/* 2. FeaturesSection */}
      <section className="py-24 px-5 bg-white relative z-10">
        <div className="max-w-6xl mx-auto grid md:grid-cols-2 gap-16 items-center">
          <div className="order-2 md:order-1 relative">
            <div className="aspect-square bg-slate-50 rounded-3xl border border-slate-100 shadow-inner flex items-center justify-center relative overflow-hidden group">
              <div className="absolute inset-0 bg-grid-slate-100 [mask-image:linear-gradient(0deg,white,rgba(255,255,255,0.6))]" />
              <Brain size={160} className="text-brand-400 relative z-10 transition-transform group-hover:scale-110 duration-500" strokeWidth={1.5} />
            </div>
          </div>
          <div className="order-1 md:order-2">
            <span className="text-brand-600 font-black text-xs uppercase tracking-widest mb-3 block">Core Point 01</span>
            <h2 className="text-4xl font-black text-slate-900 mb-6 leading-tight">
              초개인화 (Hyper-Personalization)<br />
              <span className="text-brand-500">오직 당신만을 위한 '커스텀 시험지'</span>
            </h2>
            <p className="text-slate-600 text-lg leading-loose break-keep">
              <strong className="text-slate-900">정형화된 시험지는 끝났습니다.</strong><br />
              단순한 랜덤 추출이 아닙니다. 당신의 풀이 스타일, 취약 개념, 그리고 최신 시험 트렌드까지.
              AI가 실시간으로 분석하여 오늘 당신이 꼭 풀어야 할 '진짜 문제'만 골라 시험지를 조립합니다.
            </p>
          </div>
        </div>
      </section>

      <section className="py-24 px-5 bg-slate-50">
        <div className="max-w-6xl mx-auto grid md:grid-cols-2 gap-16 items-center">
          <div>
            <span className="text-brand-600 font-black text-xs uppercase tracking-widest mb-3 block">Core Point 02</span>
            <h2 className="text-4xl font-black text-slate-900 mb-6 leading-tight">
              열공모드 문제 (AI Multi-Persona)<br />
              <span className="text-brand-500">3인의 AI가 검증한 무결점 퀄리티</span>
            </h2>
            <p className="text-slate-600 text-lg leading-loose break-keep">
              교수·출제자·수험생, 3인의 AI 페르소나가 멀티 에이전트 베리피케이션(MAV)으로 문제의 격을 높였습니다.
              개념의 정확성부터 매력적인 오답의 함정, 수험생 눈높이의 가독성까지 꼼꼼하게.
              <br /><br />
              정답은 물론, <span className="bg-brand-200 px-1 font-bold text-slate-900">'오답인 이유'</span>까지 집요하게 설명해주는 AI 튜터를 경험하세요.
            </p>
          </div>
          <div className="relative">
            <div className="aspect-square bg-white rounded-3xl border border-slate-200 shadow-xl flex items-center justify-center relative overflow-hidden group">
              <div className="absolute inset-0 opacity-10 bg-[radial-gradient(#0034d3_1px,transparent_1px)] [background-size:16px_16px]" />
              <Target size={160} className="text-slate-800 relative z-10 transition-transform group-hover:scale-110 duration-500" strokeWidth={1.5} />
            </div>
          </div>
        </div>
      </section>

      <section className="py-24 px-5 bg-white border-b border-slate-200">
        <div className="max-w-6xl mx-auto grid md:grid-cols-2 gap-16 items-center">
          <div className="order-2 md:order-1 relative">
            <div className="aspect-square bg-slate-900 rounded-3xl border border-slate-800 shadow-2xl flex items-center justify-center relative overflow-hidden group">
              <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-20" />
              <Heart size={160} className="text-brand-500 relative z-10 animate-pulse" fill="currentColor" />
              <div className="absolute bottom-8 left-8 right-8 bg-white/10 backdrop-blur-md p-4 rounded-xl border border-white/20">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-3 h-3 rounded-full bg-red-500" />
                  <span className="text-white text-xs font-bold uppercase">Secret Report</span>
                </div>
                <div className="h-2 bg-white/20 rounded-full w-3/4 mb-2" />
                <div className="h-2 bg-white/20 rounded-full w-1/2" />
              </div>
            </div>
          </div>
          <div className="order-1 md:order-2">
            <span className="text-brand-600 font-black text-xs uppercase tracking-widest mb-3 block">Core Point 03</span>
            <h2 className="text-4xl font-black text-slate-900 mb-6 leading-tight">
              자격지심 (The Secret Note)<br />
              <span className="text-brand-500">시험 직전 10분, 당신의 합격을 결정지을 '지식의 심장'</span>
            </h2>
            <p className="text-slate-600 text-lg leading-loose break-keep">
              남들은 자격지심에 빠질 때, 당신은 <strong className="text-slate-900">[자격지심]</strong>으로 합격합니다.<br />
              내가 풀었던 데이터 속에 숨겨진 약점만 골라 담은 나만의 시크릿 요약 리포트. 합격을 위한 지식의 심장부만 공략하세요.
            </p>
          </div>
        </div>
      </section>

      {/* 3. CertificationsSection - !hasHistory 일 때만 렌더링 */}
      {!hasHistory && (
      <section ref={certificationsSectionRef} className="py-24 px-5 bg-white relative overflow-hidden">
          <div className="max-w-6xl mx-auto relative z-10">
            <div className="text-center mb-16">
              <h2 className="text-4xl md:text-5xl font-black mb-4 tracking-tight text-slate-900">전체 과목 보기</h2>
              <p className="text-slate-500 text-lg opacity-90">자격증을 선택하여 무료 실력 진단을 시작하세요.</p>
            </div>
            <div className="grid md:grid-cols-3 gap-6">
              {CERTIFICATIONS.map((cert) => (
                <button
                  key={cert.id}
                  onClick={() => handleStartDiagnosticForCert(cert.id)}
                  className="group bg-slate-50 text-slate-900 rounded-3xl p-8 border border-slate-200 hover:border-slate-900 hover:-translate-y-2 transition-all duration-300 text-left flex flex-col h-full shadow-lg relative overflow-hidden"
                >
                  <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                    {cert.code === 'BIGDATA' ? <Database size={100} /> : cert.code === 'SQLD' ? <Code size={100} /> : <FileText size={100} />}
                  </div>
                  <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center text-slate-900 mb-8 group-hover:bg-brand-500 group-hover:text-white transition-colors shadow-sm relative z-10">
                    {cert.code === 'BIGDATA' ? <Database size={28} /> : cert.code === 'SQLD' ? <Code size={28} /> : <FileText size={28} />}
                  </div>
                  <div className="relative z-10 flex-1">
                    <h3 className="text-2xl font-black mb-3">{getCertDisplayName(cert, certInfos[cert.code] ?? null)}</h3>
                    <p className="text-sm text-slate-500 leading-relaxed font-medium">{cert.description}</p>
                  </div>
                  <div className="relative z-10 mt-8 pt-6 border-t border-slate-200 flex items-center justify-between group-hover:border-slate-300 transition-colors">
                    <span className="font-bold text-sm text-slate-400 group-hover:text-brand-600 transition-colors">
                      무료 실력 진단받기
                    </span>
                    <div className="w-8 h-8 rounded-full flex items-center justify-center transition-all bg-slate-200 text-slate-400 group-hover:bg-brand-500 group-hover:text-white">
                      <PlayCircle size={18} />
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* 4. TestimonialsSection */}
      <section className="py-24 px-5 bg-slate-900 text-white overflow-hidden">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-12">
            <span className="text-brand-400 font-black text-xs uppercase tracking-widest mb-2 block">Real Reviews</span>
            <h2 className="text-3xl md:text-4xl font-black text-white">
              이미 많은 분들이 <span className="text-brand-500">합격</span>을 증명했습니다
            </h2>
          </div>
          <div className="relative">
            <div className="absolute left-0 top-0 bottom-0 w-20 bg-gradient-to-r from-slate-900 to-transparent z-10 pointer-events-none md:block hidden" />
            <div className="absolute right-0 top-0 bottom-0 w-20 bg-gradient-to-l from-slate-900 to-transparent z-10 pointer-events-none md:block hidden" />
            <div className="flex overflow-x-auto gap-5 pb-8 snap-x snap-mandatory no-scrollbar px-4 md:px-0">
              {TESTIMONIALS.map((review) => (
                <div key={review.id} className="flex-shrink-0 w-[320px] snap-center bg-slate-800/50 rounded-2xl p-6 border border-slate-700">
                  <div className="flex gap-1 mb-3">
                    {Array.from({ length: review.rating }).map((_, i) => (
                      <span key={i} className="text-brand-400">★</span>
                    ))}
                  </div>
                  <p className="text-slate-300 text-sm leading-relaxed mb-4">{review.text}</p>
                  <div className="text-xs text-slate-500">
                    <span className="font-bold text-white">{review.name}</span> · {review.exam}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* 5. FAQSection */}
      <section className="py-24 px-5 bg-white">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-12">
            <span className="text-brand-600 font-black text-xs uppercase tracking-widest mb-2 block">FAQ</span>
            <h2 className="text-3xl font-black text-slate-900">자주 묻는 질문</h2>
          </div>
          <div className="space-y-4">
            {FAQS.map((faq, index) => (
              <div
                key={index}
                className="border border-slate-200 rounded-2xl overflow-hidden"
              >
                <button
                  onClick={() => toggleFaq(index)}
                  className="w-full flex items-center justify-between p-6 text-left font-bold text-slate-900 hover:bg-slate-50 transition-colors"
                >
                  {faq.q}
                  <span className="text-slate-400">{openFaqIndex === index ? <Minus size={20} /> : <Plus size={20} />}</span>
                </button>
                {openFaqIndex === index && (
                  <div className="px-6 pb-6 text-slate-600 text-sm leading-relaxed border-t border-slate-100 pt-4">
                    {faq.a}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
  */
};
