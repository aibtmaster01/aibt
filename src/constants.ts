import { Certification, ExamRound } from './types';

export const CERTIFICATIONS: Certification[] = [
  { id: 'c1', name: '빅데이터분석기사', code: 'BIGDATA', description: '데이터 이해, 처리, 분석 및 시각화 능력 검증', dDay: '2024-11-20' },
  { id: 'c2', name: 'SQLD', code: 'SQLD', description: '데이터베이스 모델링 및 SQL 활용 능력 검증', dDay: '2024-12-15' },
  { id: 'c3', name: 'ADsP', code: 'ADSP', description: '데이터분석 준전문가', dDay: '2024-10-28' },
];

/** Firebase에 문제 데이터가 있는 자격증 ID (빅데이터분석기사, SQLD) */
export const CERT_IDS_WITH_QUESTIONS: string[] = ['c1', 'c2'];

/** 선택 불가(비활성) 자격증 ID - 목록에는 표시되나 회색 처리, 선택 불가 */
export const DISABLED_CERT_IDS: string[] = ['c2', 'c3']; // SQLD, ADsP

/** 문제풀이 화면 테마: 학습 모드 = 주황, 실전 모드 = 파란 서브메인 */
export const QUIZ_THEME = {
  study: { bg: 'bg-[#0034d3]', bgLight: 'bg-[#99ccff]', text: 'text-[#0034d3]', tag: 'bg-[#99ccff] text-[#0034d3]' },
  exam: { bg: 'bg-blue-600', bgLight: 'bg-blue-50', text: 'text-blue-600', tag: 'bg-blue-50 text-blue-600' },
} as const;

/** 자격증별 과목명 (1과목, 2과목, ...) - 네비게이션/바디 표시용 */
export const SUBJECT_NAMES_BY_CERT: Record<string, string[]> = {
  BIGDATA: ['빅데이터 분석 기획', '빅데이터 탐색', '빅데이터 모델링', '빅데이터 시각화'],
  SQLD: ['데이터 모델링', 'SQL 기본', 'SQL 활용'],
  ADSP: ['데이터 이해', '데이터 분석', '데이터 활용'],
};

/** 유형별 분석(레이더)용 문제 유형 5개 라벨 - stats.problem_type_stats 키와 동일 순서 권장 */
export const PROBLEM_TYPE_LABELS: string[] = [
  '단순암기형',
  '개념이해형',
  '계산풀이형',
  '결과독해형',
  '실무적용형',
];

export const EXAM_SCHEDULES: Record<string, { id: string, label: string, dDay: string }[]> = {
  'BIGDATA': [
    { id: 'bd1', label: '2026년 1회 (4월 8일)', dDay: 'D-35' },
    { id: 'bd2', label: '2026년 2회 (8월 10일)', dDay: 'D-158' },
    { id: 'bd3', label: '2026년 3회 (12월 15일)', dDay: 'D-305' },
  ],
  'SQLD': [
    { id: 'sq1', label: '2026년 1회 (3월 15일)', dDay: 'D-12' },
    { id: 'sq2', label: '2026년 2회 (6월 20일)', dDay: 'D-102' },
  ],
  'ADSP': [
    { id: 'ad1', label: '2026년 1회 (2월 24일)', dDay: 'D-5' },
    { id: 'ad2', label: '2026년 2회 (5월 20일)', dDay: 'D-85' },
  ]
};

/** schedule id → YYYY-MM-DD (generateAdaptiveExamPlan용) */
export const EXAM_SCHEDULE_DATES: Record<string, string> = {
  bd1: '2026-04-08', bd2: '2026-08-10', bd3: '2026-12-15',
  sq1: '2026-03-15', sq2: '2026-06-20',
  ad1: '2026-02-24', ad2: '2026-05-20',
};

/** 자격증 공통 모의고사 명칭: 기초(1~3 고정) → 약점 공략(AI) → 실전 언락(4,5 고정) → 고난도 맞춤(AI) */
export const EXAM_ROUNDS: ExamRound[] = [
  { id: 'r1', certId: 'c1', round: 1, title: '연습 모의고사', description: '기초 실력 점검 및 취약점 파악', isPremium: false, questionCount: 80, type: 'diagnostic' },
  { id: 'r2', certId: 'c1', round: 2, title: '응용 모의고사', description: '실제 시험 난이도에 가까운 고정 문제', isPremium: false, questionCount: 80, type: 'practice' },
  { id: 'r3', certId: 'c1', round: 3, title: '실전 모의고사', description: '실전 형식의 고정 문제로 최종 점검', isPremium: true, questionCount: 80, type: 'practice' },
  { id: 'r4', certId: 'c1', round: 4, title: '고난도 모의고사 1회', description: '시험 직전 최종 모의고사 (D-Day 3일 이내·예상 합격률 70% 이상 시 언락)', isPremium: true, questionCount: 20, type: 'practice' },
  { id: 'r5', certId: 'c1', round: 5, title: '고난도 모의고사 2회', description: '시험 직전 최종 모의고사', isPremium: true, questionCount: 80, type: 'ai-generated' },
  { id: 'r6c1', certId: 'c1', round: 6, title: '약점 공략 모의고사', description: 'AI 맞춤형 약점 훈련', isPremium: true, questionCount: 80, type: 'practice' },
  { id: 'r7c1', certId: 'c1', round: 7, title: '약점 공략 모의고사', description: 'AI 맞춤형 약점 훈련', isPremium: true, questionCount: 80, type: 'practice' },
  { id: 'r8c1', certId: 'c1', round: 8, title: '약점 공략 모의고사', description: 'AI 맞춤형 약점 훈련', isPremium: true, questionCount: 80, type: 'practice' },
  { id: 'r9c1', certId: 'c1', round: 9, title: '약점 공략 모의고사', description: '고난이도 위주 AI 맞춤형', isPremium: true, questionCount: 80, type: 'practice' },
  { id: 'r10c1', certId: 'c1', round: 10, title: '약점 공략 모의고사', description: '고난이도 위주 AI 맞춤형', isPremium: true, questionCount: 80, type: 'practice' },
  { id: 'r6', certId: 'c2', round: 1, title: '연습 모의고사', description: 'SQLD 합격 가능성 진단', isPremium: false, questionCount: 5, type: 'diagnostic' },
  { id: 'r2c2', certId: 'c2', round: 2, title: '응용 모의고사', description: '실제 시험 난이도에 가까운 구성', isPremium: false, questionCount: 20, type: 'practice' },
  { id: 'r3c2', certId: 'c2', round: 3, title: '실전 모의고사', description: '실전 대비 고정 문제', isPremium: true, questionCount: 20, type: 'practice' },
  { id: 'r4c2', certId: 'c2', round: 4, title: '고난도 모의고사 1회', description: '시험 직전 최종 모의고사', isPremium: true, questionCount: 20, type: 'practice' },
  { id: 'r7', certId: 'c3', round: 1, title: '연습 모의고사', description: 'ADsP 기초 실력 점검', isPremium: false, questionCount: 5, type: 'diagnostic' },
];
