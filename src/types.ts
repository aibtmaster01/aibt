export interface User {
  id: string;
  email: string;
  /** 성 (예: 김) - 필수 */
  familyName: string;
  /** 이름 (예: 철수) - 필수 */
  givenName: string;
  /** 표시용 풀네임 (familyName + givenName) - 기존 호환 */
  name: string;
  isAdmin: boolean;
  isPremium: boolean;
  subscriptions: Certification[];
  paidCertIds?: string[]; // IDs of certifications the user has paid for
  expiredCertIds?: string[]; // IDs of certifications that have expired
  /** 약점 공략(round 5) 1회 체험 사용 여부 - certId별 */
  weaknessTrialUsedByCert?: Record<string, boolean>;
  /** 목표 시험일 (certId → YYYY-MM-DD) - D-Day 모드용 */
  targetExamDateByCert?: Record<string, string>;
  /** 가입일 (ISO string) - 24시간 이내 판별용 */
  createdAt?: string;
  /** D+1 설문에서 '아쉬워요' 선택 시 true - 다음 회차 50% 할인 모달 노출용 */
  hasFailedPreviousExam?: boolean;
  /** D+1 설문 완료 여부 - daysLeft < 0 시 합격/불합격 중 택하여 응답한 경우 true */
  hasAnsweredPostSurvey?: boolean;
  /** 이용권 (certId → PassInfo) - 자격증당 1개 */
  passesByCert?: Record<string, PassInfo>;
  /** 구매한 회차 (재수강) - certId → [dateId1, dateId2, ...], 구매한 시험 일정 ID 목록 */
  purchasedScheduleIdsByCert?: Record<string, string[]>;
  /** 이메일 인증 완료 여부 — 미인증 시 앱 내 안내·재발송 배너 노출 */
  is_verified?: boolean;
}

/** 이용권 정보 (시험당일 12:00 KST 활성화) */
export interface PassInfo {
  round: number;
  examDate: string; // YYYY-MM-DD
  status: 'pending' | 'active' | 'cancelled';
  boughtAt?: string; // ISO
  roundChangeUsed?: boolean;
}

/** Firestore /users/{uid} document structure */
export interface FirestoreUserDoc {
  email: string;
  /** 레거시: 풀네임. 신규: familyName + givenName 우선 */
  name?: string;
  familyName?: string;
  givenName?: string;
  isAdmin: boolean;
  isPremium: boolean;
  subscriptionIds?: string[]; // cert IDs
  paidCertIds?: string[];
  expiredCertIds?: string[];
  is_verified: boolean;
  registered_devices?: string[];
  max_devices?: number; // default 3
  /** Firestore: certCode → PassInfo */
  passes?: Record<string, Omit<PassInfo, 'boughtAt'> & { boughtAt?: string }>;
}

export interface Certification {
  id: string;
  name: string;
  code: string;
  description: string;
  dDay?: string; // YYYY-MM-DD
}

export interface ExamRound {
  id: string;
  certId: string;
  round: number; // 1~4: static, 5: AI mock
  title: string;
  description: string;
  isPremium: boolean;
  questionCount: number;
  type: 'diagnostic' | 'practice' | 'ai-generated';
}

export interface Question {
  id: string;
  content: string;
  options: string[];
  answer: number; // 1-based index
  explanation: string;
  /** AI 심층 해설 (프리미엄: ai_explanation 우선 노출) */
  aiExplanation?: string;
  wrongFeedback?: Record<string, string>; // Key: option index, Value: reason
  imageUrl?: string;
  /** 통계·큐레이션용 1단계 분류: 핵심 개념 이름 (core_concept, 예: "데이터 수집") */
  core_concept?: string;
  /** 전체 경로 3단계 (예: "BIGDATA > 데이터 수집 > 계산 풀이형") - 표시/하위 호환용 */
  topic?: string;
  /** 문제별 핵심 키워드 (태그별 통계·태그 기반 큐레이션용) */
  tags: string[];
  /** 최신 경향 식별자 (trend 필드 존재 문제 우선 큐레이션용) */
  trend: string | null;
  /** 권장 풀이 시간(초) */
  estimated_time_sec: number;
  /** 함정/난이도 점수 (트랩 강도) */
  trap_score: number;
  /** 문제 유형 배열 (Firestore problem_types 필드, 예: ["단순 암기형", "계산 풀이형"]) */
  problem_types?: string[];
  /** 과목 번호 (1, 2, 3, 4…) - 채점·큐레이션 과목별 배분용 */
  subject_number?: number;
  /** 난이도 1~5 (실전 대비형 큐레이션용) */
  difficulty_level?: number;
  /** Core_ID (예: C05_3) - Dynamic Weakness Attack 큐레이션용 */
  core_id?: string;
  /** 세부 개념 ID (예: "22-2") - proficiency·대시보드 집계용 */
  sub_core_id?: string;
  /** round 1~5: 정규, 99: 약점 공략 풀 */
  round?: number;
  /** 문제 본문 내 표: HTML 문자열 또는 { headers, rows } (문제 화면에서 렌더) */
  tableData?: string | { headers: string[]; rows: string[][] } | null;
}

/** certification_info (Firestore: certifications/{certId}/certification_info/config) */
export interface PassCriteria {
  average_score: number;   // 전 과목 평균 최소 (예: 60)
  min_subject_score: number; // 과목별 과락선 (예: 40)
}

export interface ExamConfig {
  total_questions: number;
  time_limit_min: number;
  pass_criteria: PassCriteria;
}

export interface SubjectConfig {
  subject_number: number;
  name: string;
  question_count: number;
  score_per_question?: number; // 기본 5점
}

/** certification_info.exam_schedules 항목 */
export interface ExamScheduleItem {
  year: number;
  round: number;
  type?: string;
  examDate: string;
  resultAnnouncementDate: string;
}

export interface CertificationInfo {
  exam_config: ExamConfig;
  subjects: SubjectConfig[];
  /** 유형명 → 설명 (마이페이지 유형별 밸런스 툴팁용) */
  problem_type_descriptions?: Record<string, string>;
  /** 해당 과목의 전체 개념 목록 (결과 화면 등에서 고정 순서로 노출, Firestore certification_info에 설정) */
  core_concept_order?: string[];
  /** 개념명 → 키워드(태그) 배열 (마이페이지 취약 개념 분석 아래 개념별 태그 표시용) */
  core_concept_keywords?: Record<string, string[]>;
  /** 개념 id "1"~"80" → { concept, keywords } (취약 개념 "개념79" 표시 시 개념명·키워드 조회용) */
  core_concepts_by_id?: Record<string, { concept: string; keywords: string[] }>;
  /** 자격증 시험 표시 이름 (예: "빅데이터분석기사 필기") - UI 통일용 */
  exam_name?: string;
  /** 시험 회차별 시험일·결과발표일 */
  exam_schedules?: ExamScheduleItem[];
}

/** users/{uid}/exam_results/{examId} 문서 확장 필드 */
export interface ExamResultSubjectScores {
  [subjectKey: string]: number; // "1" ~ "4" 등 과목별 점수 (0~100)
}

/** 예측 합격률 (기본 점수 * 안정성 계수, 0~100) */
export type PredictedPassRate = number;

/** 시험/퀴즈 답안 한 건 (exam_results.answers 요소). 저장 시 isConfused 항상 포함, 구 데이터는 undefined 가능 */
export interface ExamAnswerEntry {
  questionId?: string;
  qid?: string;
  selected?: number;
  isCorrect: boolean;
  /** 유저가 '헷갈려요'를 체크했는지 (저장 시 항상 포함) */
  isConfused?: boolean;
  /** 문항 풀이 소요 시간(초). 스탯 보정용 */
  elapsedSec?: number;
}

export interface ExamSession {
  id: string;
  roundId: string;
  score: number;
  totalQuestions: number;
  correctCount: number;
  date: string;
  answers: ExamAnswerEntry[];
}

export interface StatData {
  subject: string;
  score: number;
  fullMark: number;
}

/**
 * users/{uid}/user_rounds/{roundNum} — 유저별 고정(박제)된 모의고사
 * 한 번 생성된 모의고사는 유저별로 고정되어 재응시 시 동일 문제 제공
 */
export interface UserRound {
  /** 유저 기준 회차 번호 (1, 2, 3, 4, 5, …) */
  roundNum: number;
  /** 출처 회차 배열 (예: [1], [4], [99], [4, 99]) */
  sourceRounds: number[];
  /** 생성/고정된 문제 ID 배열 */
  questionIds: string[];
  /** 생성일 (ISO string) */
  createdAt: string;
}