/**
 * statsService.ts
 * users/{uid}/stats/{certCode} 및 exam_results 조회 → 대시보드 UI용 포맷 변환
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  orderBy,
  limit,
  Timestamp,
} from 'firebase/firestore';
import { db } from '../firebase';

// ========== v0 UI 호환 인터페이스 ==========

export interface TrendDataItem {
  name: string;
  score: number;
  date: string;
  isPass: boolean;
  /** 해당 응시 문서 ID (재응시/오답 시 사용) */
  examId?: string;
  /** 모의고사 회차 ID (EXAM_ROUNDS와 매칭해 회차명 표시) */
  roundId?: string | null;
  totalQuestions?: number;
  correctCount?: number;
}

export interface RadarDataItem {
  subject: string;
  A: number;
  fullMark: 100;
}

export interface SubjectScore {
  subject: string;
  subjectNumber: number;
  score: number;
  totalProblems: number;
}

export interface WeaknessItem {
  name: string;
  accuracy: number;
  count: number;
}

// ========== Firestore 문서 타입 ==========

interface StatEntry {
  correct?: number;
  total?: number;
  /** Elo 스타일 이해도 (최신 회차 가중, 1200 기준) */
  proficiency?: number;
}

interface ExamResultDoc {
  certCode?: string;
  roundId?: string | null;
  subject_scores?: Record<string, number>;
  is_passed?: boolean;
  predicted_pass_rate?: number;
  totalQuestions?: number;
  correctCount?: number;
  submittedAt?: Timestamp | { toDate: () => Date };
}

// ========== 유틸 ==========

function toDate(d: Timestamp | { toDate: () => Date } | undefined): Date | null {
  if (!d) return null;
  if (typeof (d as Timestamp).toDate === 'function') return (d as Timestamp).toDate();
  return null;
}

function formatTrendName(index: number, date: Date): string {
  return `${index + 1}회`;
}

function formatDateShort(date: Date): string {
  const m = date.getMonth() + 1;
  const d = date.getDate();
  return `${m.toString().padStart(2, '0')}.${d.toString().padStart(2, '0')}`;
}

function safeAccuracy(correct: number, total: number): number {
  if (total <= 0) return 0;
  const v = Math.round((correct / total) * 100);
  return Math.min(100, Math.max(0, v));
}

/** Elo proficiency → 0~100% (문제 난이도 1200 기준, gradingService와 동일) */
function eloToPercent(proficiency: number): number {
  const p = Math.max(100, Math.min(2500, proficiency));
  const expected = 1 / (1 + Math.pow(10, (1200 - p) / 400));
  return Math.max(0, Math.min(100, Math.round(expected * 100)));
}

/** StatEntry에서 이해도 값 반환: proficiency 우선(Elo%), 없으면 correct/total 누적% */
function understandingFromStat(ent: StatEntry): number {
  const prof = ent?.proficiency;
  if (prof != null && Number.isFinite(prof)) return eloToPercent(prof);
  const total = ent?.total ?? 0;
  const correct = ent?.correct ?? 0;
  return safeAccuracy(correct, total);
}

/**
 * 해당 유저가 모의고사 1회 이상 응시한 적이 있는지 여부
 * (마이페이지 진입: 응시/결제 없으면 자격증 선택 화면으로 보내기 위함)
 */
export async function fetchHasAnyExamRecord(uid: string): Promise<boolean> {
  const examRef = collection(db, 'users', uid, 'exam_results');
  try {
    const q = query(examRef, limit(1));
    const snapshot = await getDocs(q);
    return snapshot.size > 0;
  } catch {
    return false;
  }
}

// ========== A. fetchUserTrendData ==========

export interface FetchUserTrendDataResult {
  trendData: TrendDataItem[];
  recentPassRate: number;
}

/**
 * exam_results 조회 → 성적 추이 + 최근 예측 합격률
 */
export async function fetchUserTrendData(
  uid: string,
  certCode: string
): Promise<FetchUserTrendDataResult> {
  const examRef = collection(db, 'users', uid, 'exam_results');
  const q = query(
    examRef,
    orderBy('submittedAt', 'asc'),
    limit(30)
  );

  let snapshot;
  try {
    snapshot = await getDocs(q);
  } catch {
    return { trendData: [], recentPassRate: 0 };
  }

  const items: TrendDataItem[] = [];
  let recentPassRate = 0;
  const certDocs = snapshot.docs.filter((d) => {
    const data = d.data() as ExamResultDoc;
    if (data.certCode !== certCode) return false;
    if (data.roundId === 'weakness_retry') return false;
    return true;
  });
  const docsToUse = certDocs.slice(0, 30);

  docsToUse.forEach((docSnap, index) => {
    const data = docSnap.data() as ExamResultDoc;
    const submittedAt = data.submittedAt;
    const dateObj = toDate(submittedAt);
    const dateStr = dateObj ? formatDateShort(dateObj) : '';
    const scores = data.subject_scores ?? {};
    const scoreValues = Object.values(scores);
    const avgScore =
      scoreValues.length > 0
        ? Math.round(
            scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length
          )
        : (data.predicted_pass_rate ?? 0);
    const score = Number.isNaN(avgScore) ? 0 : Math.min(100, Math.max(0, avgScore));
    const isPass = Boolean(data.is_passed);
    const totalQuestions = data.totalQuestions ?? 0;
    const correctCount = data.correctCount ?? 0;

    items.push({
      name: dateObj ? formatTrendName(index, dateObj) : `${index + 1}회`,
      score,
      date: dateStr,
      isPass,
      examId: docSnap.id,
      roundId: data.roundId ?? null,
      totalQuestions,
      correctCount,
    });

    if (index === docsToUse.length - 1 && data.predicted_pass_rate != null) {
      recentPassRate = Math.min(100, Math.max(0, Number(data.predicted_pass_rate)));
    }
  });

  return {
    trendData: items,
    recentPassRate,
  };
}

// ========== B. fetchDashboardStats ==========

export interface FetchDashboardStatsResult {
  radarData: RadarDataItem[];
  subjectScores: SubjectScore[];
  weaknessTop2: WeaknessItem[];
}

const FULL_MARK = 100 as const;

/**
 * users/{uid}/stats/{certCode} 1개 문서 조회 → 레이더 / 과목 게이지 / 약점 Top2
 */
export async function fetchDashboardStats(
  uid: string,
  certCode: string
): Promise<FetchDashboardStatsResult> {
  const statsRef = doc(db, 'users', uid, 'stats', certCode);
  let snap;
  try {
    snap = await getDoc(statsRef);
  } catch {
    return {
      radarData: [],
      subjectScores: [],
      weaknessTop2: [],
    };
  }

  if (!snap.exists()) {
    return {
      radarData: [],
      subjectScores: [],
      weaknessTop2: [],
    };
  }

  const data = snap.data() ?? {};
  const hierarchyStats = (data.hierarchy_stats ?? {}) as Record<string, StatEntry>;
  const problemTypeStats = (data.problem_type_stats ?? {}) as Record<string, StatEntry>;
  const subjectStats = (data.subject_stats ?? {}) as Record<string, StatEntry>;

  // 1) Radar (problem_type_stats) — 이해도 = proficiency(Elo) 우선
  const radarData: RadarDataItem[] = Object.entries(problemTypeStats).map(
    ([subject, ent]) => {
      const A = understandingFromStat(ent);
      return {
        subject,
        A,
        fullMark: FULL_MARK,
      };
    }
  );

  // 2) Subject Gauge (subject_stats) — 이해도 = proficiency(Elo) 우선
  const subjectScores: SubjectScore[] = Object.entries(subjectStats).map(
    ([key, ent]) => {
      const total = ent?.total ?? 0;
      const score = understandingFromStat(ent);
      const subjectNumber = parseInt(key, 10) || 1;
      return {
        subject: `${key}과목`,
        subjectNumber,
        score,
        totalProblems: total,
      };
    }
  );

  // 3) Weakness Top 2: 푼 문제 유형(hierarchy) 중에서만, 이해도(Elo 기준) 낮은 순 상위 2
  // - total >= 3: 최소 3문제 이상 푼 개념만 (통계 의미 있음)
  // - correct >= 1: 최소 1개라도 맞춘 개념만 (0% = 아직 학습 안 한 개념 제외)
  const weaknessCandidates: WeaknessItem[] = Object.entries(hierarchyStats)
    .filter(([, ent]) => {
      const total = ent?.total ?? 0;
      const correct = ent?.correct ?? 0;
      return total >= 3 && correct >= 1;
    })
    .map(([name, ent]) => {
      const total = ent?.total ?? 0;
      const accuracy = understandingFromStat(ent);
      return { name, accuracy, count: total };
    })
    .sort((a, b) => a.accuracy - b.accuracy);

  const weaknessTop2 = weaknessCandidates.slice(0, 2);

  return {
    radarData,
    subjectScores,
    weaknessTop2,
  };
}
