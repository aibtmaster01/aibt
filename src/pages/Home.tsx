import React, { useRef, useState } from 'react';
import { CERT_IDS_WITH_QUESTIONS, EXAM_ROUNDS } from '../constants';
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
};
