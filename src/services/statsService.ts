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
  weaknessTop3: WeaknessItem[];
  /** 최근 3회 가중 이동 평균 합격률 (최신 0.5·직전 0.3·2회전 0.2) */
  weightedPassRate: number | null;
}

const FULL_MARK = 100 as const;
const PASS_LINE = 40; // 과락 기준점

/**
 * 최근 N회 exam_results에서 과목별 점수 추이 계산 → 트렌드 방향(up/down/stable) 반환
 */
function calcSubjectTrend(scores: number[]): 'up' | 'down' | 'stable' {
  if (scores.length < 2) return 'stable';
  // 선형 회귀 기울기 (최소제곱법)
  const n = scores.length;
  const xMean = (n - 1) / 2;
  const yMean = scores.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (scores[i] - yMean);
    den += (i - xMean) ** 2;
  }
  const slope = den > 0 ? num / den : 0;
  if (slope >= 2) return 'up';
  if (slope <= -2) return 'down';
  return 'stable';
}

/**
 * users/{uid}/stats/{certCode} + 최근 3회 exam_results 조회
 * → 레이더 / 과목 게이지(트렌드 방향·안전 마진 포함) / 약점 Top3 / 가중 합격률
 */
export async function fetchDashboardStats(
  uid: string,
  certCode: string
): Promise<FetchDashboardStatsResult> {
  const empty: FetchDashboardStatsResult = {
    radarData: [],
    subjectScores: [],
    weaknessTop3: [],
    weightedPassRate: null,
  };

  const statsRef = doc(db, 'users', uid, 'stats', certCode);
  let snap;
  try {
    snap = await getDoc(statsRef);
  } catch {
    return empty;
  }

  if (!snap.exists()) return empty;

  const data = snap.data() ?? {};
  const conceptStats = (data.core_concept_stats ?? (data as { hierarchy_stats?: Record<string, StatEntry> }).hierarchy_stats ?? {}) as Record<string, StatEntry>;
  const subCoreIdStats = (data.sub_core_id_stats ?? {}) as Record<string, StatEntry>;
  const problemTypeStats = (data.problem_type_stats ?? {}) as Record<string, StatEntry>;
  const subjectStats = (data.subject_stats ?? {}) as Record<string, StatEntry>;

  // ─── 최근 3회 exam_results 조회 (과목별 트렌드·가중 합격률용) ───
  let recentExamDocs: ExamResultDoc[] = [];
  try {
    const examRef = collection(db, 'users', uid, 'exam_results');
    const q = query(examRef, orderBy('submittedAt', 'desc'), limit(5));
    const qSnap = await getDocs(q);
    recentExamDocs = qSnap.docs
      .map((d) => d.data() as ExamResultDoc)
      .filter((d) => d.certCode === certCode && d.roundId !== 'weakness_retry')
      .slice(0, 3)
      .reverse(); // 오래된 것 → 최신 순 정렬
  } catch {
    // exam_results 조회 실패 시 트렌드 없이 진행
  }

  // ─── 과목별 최근 3회 점수 수집 ───
  const subjectRecentScores: Record<string, number[]> = {};
  for (const examDoc of recentExamDocs) {
    const scores = examDoc.subject_scores ?? {};
    for (const [k, v] of Object.entries(scores)) {
      if (!subjectRecentScores[k]) subjectRecentScores[k] = [];
      subjectRecentScores[k].push(v as number);
    }
  }

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

  // 세부 개념(sub_core_id) → 대분류(Core) 합산
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

  // 1) Radar (problem_type_stats)
  const radarData: RadarDataItem[] = Object.entries(problemTypeStats).map(
    ([subject, ent]) => ({ subject, A: understandingFromStat(ent), fullMark: FULL_MARK })
  );

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

  // 3) Weakness Top 3
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
      .filter(([, ent]) => (ent?.total ?? 0) >= 3 && (ent?.correct ?? 0) >= 1)
      .map(([name, ent]) => ({ name, accuracy: understandingFromStat(ent), count: ent?.total ?? 0 }))
      .sort((a, b) => a.accuracy - b.accuracy);
  }

  return {
    radarData,
    subjectScores,
    weaknessTop3: weaknessCandidates.slice(0, 3),
    weightedPassRate,
  };
}
