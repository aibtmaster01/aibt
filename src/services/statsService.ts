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
import { eloToPercent } from './gradingService';
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
  /** 집중학습 완료 시 저장된 표시 라벨 (예: "과목 강화 학습 - 3과목 강화") */
  roundLabel?: string | null;
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
  /** 최근 3회 exam_results 기반 트렌드 방향: 'up' | 'down' | 'stable' | null */
  trend?: 'up' | 'down' | 'stable' | null;
  /** 합격선(40점) 대비 안전 마진 */
  safetyMargin?: number;
}

export interface WeaknessItem {
  name: string;
  accuracy: number;
  count: number;
  /** sub_core_id 기반일 때 개념 id (예: "79") — UI에서 core_concepts_by_id로 개념명·키워드 표시용 */
  id?: string;
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
  roundLabel?: string | null;
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

/** 응시일+시각 표시용 (예: 2.27 21:08) */
function formatDateShortWithTime(date: Date): string {
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const hh = date.getHours();
  const mm = date.getMinutes();
  return `${m}.${d.toString().padStart(2, '0')} ${hh.toString().padStart(2, '0')}:${mm.toString().padStart(2, '0')}`;
}

function safeAccuracy(correct: number, total: number): number {
  if (total <= 0) return 0;
  const v = Math.round((correct / total) * 100);
  return Math.min(100, Math.max(0, v));
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
  // 복합 인덱스 없이 동작: orderBy만 사용 후 메모리에서 certCode 필터 (인덱스 오류 시 빈 화면 방지)
  const q = query(
    examRef,
    orderBy('submittedAt', 'desc'),
    limit(150)
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
  const docsToUse = certDocs.slice(0, 30); // 해당 자격증 기준 최근 30건 (이미 desc 정렬됨)

  docsToUse.forEach((docSnap, index) => {
    const data = docSnap.data() as ExamResultDoc;
    const submittedAt = data.submittedAt;
    const dateObj = toDate(submittedAt);
    const dateStr = dateObj ? formatDateShortWithTime(dateObj) : '';
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
      roundLabel: data.roundLabel ?? null,
      totalQuestions,
      correctCount,
    });

    if (index === 0) {
      if (data.predicted_pass_rate != null && Number.isFinite(Number(data.predicted_pass_rate))) {
        recentPassRate = Math.min(100, Math.max(0, Number(data.predicted_pass_rate)));
      } else {
        recentPassRate = score;
      }
    }
  });

  items.reverse(); // UI는 오래된 순(시간순)으로 표시
  return {
    trendData: items,
    recentPassRate,
  };
}

// ========== B. fetchDashboardStats ==========

export interface FetchDashboardStatsResult {
  radarData: RadarDataItem[];
  subjectScores: SubjectScore[];
  weaknessTop3: WeaknessItem[];
}

const FULL_MARK = 100 as const;
const PASS_LINE = 40; // 과락 기준점

/**
 * users/{uid}/stats/{certCode} 1개 문서 조회 → 레이더 / 과목 게이지 / 약점 Top3
 */
export async function fetchDashboardStats(
  uid: string,
  certCode: string
): Promise<FetchDashboardStatsResult> {
  const empty: FetchDashboardStatsResult = {
    radarData: [],
    subjectScores: [],
    weaknessTop3: [],
  };

  const statsRef = doc(db, 'users', uid, 'stats', certCode);
  let snap;
  try {
    snap = await getDoc(statsRef);
  } catch {
    return {
      radarData: [],
      subjectScores: [],
      weaknessTop3: [],
    };
  }

  if (!snap.exists()) {
    return {
      radarData: [],
      subjectScores: [],
      weaknessTop3: [],
    };
  }

  const data = snap.data() ?? {};
  const conceptStats = (data.core_concept_stats ?? (data as { hierarchy_stats?: Record<string, StatEntry> }).hierarchy_stats ?? {}) as Record<string, StatEntry>;
  const subCoreIdStats = (data.sub_core_id_stats ?? {}) as Record<string, StatEntry>;
  const problemTypeStats = (data.problem_type_stats ?? {}) as Record<string, StatEntry>;
  const subjectStats = (data.subject_stats ?? {}) as Record<string, StatEntry>;

  /** 최근 시험 문서(가중 합격률용). 미구현 시 빈 배열로 두어 오류 방지 */
  const recentExamDocs: { predicted_pass_rate?: number }[] = [];
  /** 과목별 최근 점수(트렌드용). 미구현 시 빈 객체로 두어 오류 방지 */
  const subjectRecentScores: Record<string, number[]> = {};

  // 세부 개념(sub_core_id) → 대분류(Core) 합산: core_id별 평균 proficiency·총 문제 수
  const coreAggFromSubCore: Record<string, { sumProficiency: number; total: number; count: number }> = {};
  for (const [subCoreId, ent] of Object.entries(subCoreIdStats)) {
    const coreId = subCoreId.includes('-') ? subCoreId.split('-')[0] : subCoreId;
    if (!coreAggFromSubCore[coreId]) coreAggFromSubCore[coreId] = { sumProficiency: 0, total: 0, count: 0 };
    const prof = ent?.proficiency ?? 1200;
    const total = ent?.total ?? 0;
    coreAggFromSubCore[coreId].sumProficiency += prof * total;
    coreAggFromSubCore[coreId].total += total;
    coreAggFromSubCore[coreId].count += 1;
  }

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

  // ─── 최근 3회 가중 이동 평균 합격률 ───
  let weightedPassRate: number | null = null;
  const passRates = recentExamDocs
    .map((d) => d.predicted_pass_rate)
    .filter((v): v is number => typeof v === 'number');
  if (passRates.length >= 1) {
    const weights = [0.2, 0.3, 0.5]; // 오래된→최신 순
    const w = weights.slice(weights.length - passRates.length);
    const wSum = w.reduce((a, b) => a + b, 0);
    weightedPassRate = Math.round(
      passRates.reduce((acc, val, i) => acc + val * w[i], 0) / wSum
    );
  }

  // 2) Subject Gauge — 이해도 + 트렌드 방향 + 안전 마진
  const subjectScores: SubjectScore[] = Object.entries(subjectStats).map(
    ([key, ent]) => {
      const total = ent?.total ?? 0;
      const score = understandingFromStat(ent);
      const subjectNumber = parseInt(key, 10) || 1;
      const recentScores = subjectRecentScores[key] ?? [];
      const trend = recentScores.length >= 2 ? calcSubjectTrend(recentScores) : null;
      const safetyMargin = score - PASS_LINE;
      return {
        subject: `${key}과목`,
        subjectNumber,
        score,
        totalProblems: total,
        trend,
        safetyMargin,
      };
    }
  );

  // 3) Weakness Top 3: sub_core_id_stats → Core 합산 후 이해도 낮은 순 상위 3 (있으면 우선), 없으면 core_concept_stats
  let weaknessCandidates: WeaknessItem[] = [];
  if (Object.keys(coreAggFromSubCore).length > 0) {
    weaknessCandidates = Object.entries(coreAggFromSubCore)
      .filter(([, agg]) => agg.total >= 3)
      .map(([coreId, agg]) => {
        const avgProficiency = agg.total > 0 ? agg.sumProficiency / agg.total : 1200;
        const accuracy = understandingFromStat({ proficiency: avgProficiency, total: agg.total });
        return { name: `개념 ${coreId}`, id: coreId, accuracy, count: agg.total };
      })
      .sort((a, b) => a.accuracy - b.accuracy);
  }
  if (weaknessCandidates.length === 0) {
    weaknessCandidates = Object.entries(conceptStats)
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
  }

  const weaknessTop3 = weaknessCandidates.slice(0, 3);

  return {
    radarData,
    subjectScores,
    weaknessTop3,
  };
}
