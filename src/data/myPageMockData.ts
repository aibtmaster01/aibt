/**
 * 마이페이지 목업 데이터
 * - 데이터가 없을 때 카드 영역에 동일한 레이아웃으로 표시하고, 흰색 딤 + 안내 문구를 올려서 사용
 */

import type {
  FetchUserTrendDataResult,
  FetchDashboardStatsResult,
  TrendDataItem,
  RadarDataItem,
  SubjectScore,
  WeaknessItem,
} from "../services/statsService";

/** 예측 합격률 + 학습 기록용 목업 (trendData, recentPassRate) */
export const mockTrendData: FetchUserTrendDataResult = {
  recentPassRate: 62,
  trendData: [
    { name: "1회", score: 55, date: "01.15", isPass: false, examId: "mock-1", roundId: "r1", totalQuestions: 20, correctCount: 11 },
    { name: "2회", score: 58, date: "01.18", isPass: false, examId: "mock-2", roundId: "r2", totalQuestions: 20, correctCount: 12 },
    { name: "3회", score: 65, date: "01.22", isPass: true, examId: "mock-3", roundId: "r3", totalQuestions: 20, correctCount: 13 },
  ] as TrendDataItem[],
};

/** 집중 공략 + 예측 합격률 과목별용 목업 (radarData, subjectScores, weaknessTop3) */
export const mockDashboardStats: FetchDashboardStatsResult = {
  /** 무료 회원용: 5각형 들쭉날쭉 (5축 모두 유형명 표시) */
  radarData: [
    { subject: "계산풀이형", A: 88, fullMark: 100 },
    { subject: "결과독해형", A: 42, fullMark: 100 },
    { subject: "단순암기형", A: 65, fullMark: 100 },
    { subject: "개념이해형", A: 35, fullMark: 100 },
    { subject: "실무적용형", A: 72, fullMark: 100 },
  ] as RadarDataItem[],
  /** 무료 회원용: 1과목 70%, 2과목 40%, 3과목 38%, 4과목 60% (과목별 합격률 막대용) */
  subjectScores: [
    { subject: "1과목", subjectNumber: 1, score: 70, totalProblems: 20 },
    { subject: "2과목", subjectNumber: 2, score: 40, totalProblems: 20 },
    { subject: "3과목", subjectNumber: 3, score: 38, totalProblems: 20 },
    { subject: "4과목", subjectNumber: 4, score: 60, totalProblems: 20 },
  ] as SubjectScore[],
  /** 무료 회원용: 취약 개념 표시용 (3개) */
  weaknessTop3: [
    { name: "빅데이터 모델링", accuracy: 38, count: 12 },
    { name: "빅데이터 결과 해석", accuracy: 40, count: 11 },
    { name: "데이터 수집", accuracy: 42, count: 10 },
  ] as WeaknessItem[],
};

/** 데이터 없음 시 카드별 안내 문구 (흰색 딤 위에 표시) */
export const MY_PAGE_EMPTY_MESSAGES = {
  passRate: "데이터가 없습니다\n모의고사를 풀고 예측 합격률을 확인해보세요!",
  weakness: "데이터가 없습니다\n모의고사를 풀고 나의 취약점을 확인해보세요!",
  learningRecord: "데이터가 없습니다\n모의고사를 풀고 나의 학습기록을 관리하세요!",
} as const;
