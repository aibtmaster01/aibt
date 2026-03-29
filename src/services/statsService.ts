/**
 * statsService.ts
 * users/{uid}/stats/{certCode} 및 exam_results 조회 → 대시보드 UI용 포맷 변환
 */

import {
  collection,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  query,
  orderBy,
  limit,
  Timestamp,
} from 'firebase/firestore';
import {
  eloToPercent,
  getEncouragementMessageForPassRate,
  PASS_RATE_MIN,
  classifyExamPassRateContext,
  isDiagnosticRound,
  type PassRateKind,
} from './gradingService';
import { db } from '../firebase';
import { CERTIFICATIONS, PROBLEM_TYPE_LABELS } from '../constants';

/** 개발 모드에서만 orderBy 실패 시 fallback 사용 */
const IS_DEV = import.meta.env.DEV;

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
  /** 회차 성격 (진단 vs 맞춤형·집중학습 UI 구분) */
  attemptKind?: PassRateKind;
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

/** 과목별 안전도 구간 (빅분기 과락 40점 기준). UI 게이지·텍스트 라벨용 */
export type SubjectSafetyZone = '안정권' | '보완 필요' | '집중 필요';

/** 60 이상 안정권, 45~60 보완 필요, 44 이하 집중 필요 */
export function getSubjectSafetyZone(score: number): SubjectSafetyZone {
  const s = Number(score);
  if (!Number.isFinite(s)) return '집중 필요';
  if (s >= 60) return '안정권';
  if (s >= 45) return '보완 필요';
  return '집중 필요';
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
  certId?: string;
  roundId?: string | null;
  roundLabel?: string | null;
  subject_scores?: Record<string, number>;
  is_passed?: boolean;
  predicted_pass_rate?: number;
  predicted_pass_rate_display?: number;
  predicted_pass_rate_raw?: number;
  totalQuestions?: number;
  correctCount?: number;
  submittedAt?: Timestamp | { toDate: () => Date };
}

function displayPassRateFromExam(data: ExamResultDoc): number | null {
  const v =
    data.predicted_pass_rate_display ??
    data.predicted_pass_rate ??
    data.predicted_pass_rate_raw;
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return Math.min(99, Math.max(0, Math.round(v)));
}

/** certCode 또는 certId로 해당 자격증 시험인지 판별 (학습 정보가 certId만 있는 구 데이터 호환) */
function isExamForCert(data: ExamResultDoc, certCode: string): boolean {
  if (data.certCode === certCode) return true;
  const certId = CERTIFICATIONS.find((c) => c.code === certCode)?.id;
  return Boolean(certId && data.certId === certId);
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

/** 최근 과목별 점수 배열(최신 순)으로 트렌드 방향 반환 */
function calcSubjectTrend(recentScores: number[]): 'up' | 'down' | 'stable' | null {
  if (!Array.isArray(recentScores) || recentScores.length < 2) return null;
  const latest = recentScores[0];
  const prev = recentScores[1];
  if (typeof latest !== 'number' || typeof prev !== 'number' || !Number.isFinite(latest) || !Number.isFinite(prev)) return null;
  const diff = latest - prev;
  const threshold = 3;
  if (diff > threshold) return 'up';
  if (diff < -threshold) return 'down';
  return 'stable';
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

export interface DiagnosticProgress {
  completed: number;
  total: 3;
  status: 'in_progress' | 'completed';
}

export interface FetchUserTrendDataResult {
  trendData: TrendDataItem[];
  /** 3회 미만이면 null, 3회 이상이면 기존 로직의 예측 합격률 */
  recentPassRate: number | null;
  diagnosticProgress: DiagnosticProgress;
  encouragementMessage: string;
}

function buildEncouragementMessage(_completed: number, _lastScore: number): string {
  return '예측 합격률 진단을 위해 모의고사를 계속 풀어주세요.';
}

/**
 * exam_results 조회 → 성적 추이 + 최근 예측 합격률 (실력진단 3회 이상일 때만)
 */
const EMPTY_TREND_RESULT: FetchUserTrendDataResult = {
  trendData: [],
  recentPassRate: null,
  diagnosticProgress: { completed: 0, total: 3, status: 'in_progress' },
  encouragementMessage: buildEncouragementMessage(0, 0),
};

export async function fetchUserTrendData(
  uid: string,
  certCode: string
): Promise<FetchUserTrendDataResult> {
  try {
  const examRef = collection(db, 'users', uid, 'exam_results');
  // orderBy('submittedAt') 사용 — submittedAt 없는 문서는 쿼리 결과에서 제외됨
  const q = query(
    examRef,
    orderBy('submittedAt', 'desc'),
    limit(150)
  );

  let snapshot;
  try {
    snapshot = await getDocs(q);
  } catch (err) {
    if (IS_DEV) {
      try {
        const fallbackQ = query(examRef, limit(200));
        snapshot = await getDocs(fallbackQ);
        const withDate = snapshot.docs
          .map((d) => ({ doc: d, data: d.data() as ExamResultDoc, t: toDate((d.data() as ExamResultDoc).submittedAt)?.getTime() ?? 0 }))
          .filter((x) => isExamForCert(x.data, certCode) && x.data.roundId !== 'weakness_retry');
        withDate.sort((a, b) => b.t - a.t);
        snapshot = { docs: withDate.slice(0, 150).map((x) => x.doc) } as typeof snapshot;
      } catch {
        return EMPTY_TREND_RESULT;
      }
    } else {
      return EMPTY_TREND_RESULT;
    }
  }

  if (IS_DEV && snapshot.docs.length === 0) {
    try {
      const fallbackQ = query(examRef, limit(200));
      const fallbackSnap = await getDocs(fallbackQ);
      const withDate = fallbackSnap.docs
        .map((d) => ({ doc: d, data: d.data() as ExamResultDoc, t: toDate((d.data() as ExamResultDoc).submittedAt)?.getTime() ?? 0 }))
        .filter((x) => isExamForCert(x.data, certCode) && x.data.roundId !== 'weakness_retry');
      withDate.sort((a, b) => b.t - a.t);
      snapshot = { docs: withDate.slice(0, 150).map((x) => x.doc) } as typeof snapshot;
    } catch {
      // ignore
    }
  }

  const items: TrendDataItem[] = [];
  let recentPassRate: number | null = null;
  const certDocs = snapshot.docs.filter((d) => {
    const data = d.data() as ExamResultDoc;
    if (!isExamForCert(data, certCode)) return false;
    if (data.roundId === 'weakness_retry') return false;
    return true;
  });

  const completedDiagnostics = certDocs.filter((d) => {
    const rid = (d.data() as ExamResultDoc).roundId;
    return isDiagnosticRound(typeof rid === 'string' ? rid : null);
  }).length;

  const docsToUse = certDocs.slice(0, 30); // 해당 자격증 기준 최근 30건 (이미 desc 정렬됨)
  let latestScore = 0;
  const diagnosticPassRates: number[] = []; // 최근 회차 순 predicted_pass_rate (가중 평균용)

  docsToUse.forEach((docSnap, index) => {
    try {
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
          : (displayPassRateFromExam(data) ?? 0);
      const score = Number.isNaN(avgScore) ? 0 : Math.min(99, Math.max(0, avgScore));
      const isPass = Boolean(data.is_passed);
      const totalQuestions = data.totalQuestions ?? 0;
      const correctCount = data.correctCount ?? 0;

      if (index === 0) {
        latestScore = score;
        if (score <= 0 && (data.totalQuestions ?? 0) > 0) {
          const total = Number(data.totalQuestions ?? 0);
          const correct = Number(data.correctCount ?? 0);
          latestScore = total > 0 ? Math.min(100, Math.max(0, Math.round((correct / total) * 100))) : 0;
        }
      }

      const rid = data.roundId;
      if (isDiagnosticRound(typeof rid === 'string' ? rid : null)) {
        const pr = displayPassRateFromExam(data);
        if (pr != null) {
          diagnosticPassRates.push(Math.min(99, Math.max(0, pr)));
        } else if (score > 0) {
          diagnosticPassRates.push(score);
        } else {
          const total = Number(data.totalQuestions ?? 0);
          const correct = Number(data.correctCount ?? 0);
          diagnosticPassRates.push(total > 0 ? Math.min(99, Math.max(0, Math.round((correct / total) * 100))) : 0);
        }
      }

      items.push({
        name: dateObj ? formatTrendName(index, dateObj) : `${index + 1}회`,
        score,
        date: dateStr,
        isPass,
        examId: docSnap.id,
        roundId: data.roundId ?? null,
        roundLabel: data.roundLabel ?? null,
        attemptKind: classifyExamPassRateContext(data.roundId ?? null),
        totalQuestions,
        correctCount,
      });
    } catch {
      // 한 건이라도 파싱 실패 시 해당 doc만 스킵 (2회차 등 추가 후 전체 빈 화면 방지)
    }
  });

  if (completedDiagnostics >= 3 && diagnosticPassRates.length >= 1) {
    const weights = [0.2, 0.3, 0.5]; // 오래된 → 최신 순
    const recentRates = diagnosticPassRates.slice(0, 3);
    const oldestFirst = [...recentRates].reverse();
    const w = weights.slice(weights.length - oldestFirst.length);
    const wSum = w.reduce((a, b) => a + b, 0);
    recentPassRate = Math.round(
      oldestFirst.reduce((acc, val, i) => acc + val * w[i], 0) / wSum
    );
    recentPassRate = Math.min(99, Math.max(0, recentPassRate));
  }

  items.reverse(); // UI는 오래된 순(시간순)으로 표시

  const diagnosticProgress: DiagnosticProgress =
    completedDiagnostics >= 3
      ? { completed: 3, total: 3, status: 'completed' }
      : { completed: completedDiagnostics, total: 3, status: 'in_progress' };

  const encouragementMessage =
    diagnosticProgress.status === 'in_progress'
      ? buildEncouragementMessage(diagnosticProgress.completed, latestScore)
      : (recentPassRate != null && Number.isFinite(recentPassRate)
          ? getEncouragementMessageForPassRate(recentPassRate)
          : '');

  return {
    trendData: items,
    recentPassRate,
    diagnosticProgress,
    encouragementMessage,
  };
  } catch {
    return EMPTY_TREND_RESULT;
  }
}

// ========== B. fetchDashboardStats ==========

export interface FetchDashboardStatsResult {
  radarData: RadarDataItem[];
  subjectScores: SubjectScore[];
  weaknessTop3: WeaknessItem[];
}

const FULL_MARK = 100 as const;
/** 과목별 안전도용 과락 기준점(대시보드 표시). 합격 판정은 자격증별 min_subject_score 사용. 상세: docs/PASS_RATE_AND_SAFETY.md */
const PASS_LINE = 40;
/** 과목별 안전도 하한(%). 한 번 0점이 나와도 절망적인 0% 대신 희망 유지 (예측 합격률과 동일) */
const SUBJECT_SCORE_MIN = PASS_RATE_MIN;

/**
 * 대시보드 통계: 레이더(유형별) / 과목 게이지(안전도) / 취약 개념 Top3
 * 과목별 안전도 = 최근 1회 시험 subject_scores 우선(0~99, 예측합격률과 동일 스케일) → 없으면 subject_stats Elo%
 * 안전 마진 = 과목점수 − PASS_LINE (양수: 과락 위험 없음)
 */
const EMPTY_DASHBOARD_RESULT: FetchDashboardStatsResult = {
  radarData: [],
  subjectScores: [],
  weaknessTop3: [],
};

export async function fetchDashboardStats(
  uid: string,
  certCode: string
): Promise<FetchDashboardStatsResult> {
  try {
  const statsRef = doc(db, 'users', uid, 'stats', certCode);
  const examRef = collection(db, 'users', uid, 'exam_results');

  /** exam_results는 stats 유무와 관계없이 조회 (stats 없어도 과목별 점수만이라도 표시) */
  let recentExamDocs: ExamResultDoc[] = [];
  try {
    const q = query(examRef, orderBy('submittedAt', 'desc'), limit(50));
    const examSnap = await getDocs(q);
    recentExamDocs = examSnap.docs
      .map((d) => d.data() as ExamResultDoc)
      .filter((doc) => isExamForCert(doc, certCode) && doc.roundId !== 'weakness_retry')
      .slice(0, 5);
  } catch {
    if (IS_DEV) {
      try {
        const fallbackQ = query(examRef, limit(100));
        const fallbackSnap = await getDocs(fallbackQ);
        const filtered = fallbackSnap.docs
          .map((d) => d.data() as ExamResultDoc)
          .filter((doc) => isExamForCert(doc, certCode) && doc.roundId !== 'weakness_retry');
        const withT = filtered
          .map((doc) => ({ doc, t: toDate(doc.submittedAt)?.getTime() ?? 0 }))
          .sort((a, b) => b.t - a.t);
        recentExamDocs = withT.slice(0, 5).map((x) => x.doc);
      } catch {
        // ignore
      }
    }
  }

  let snap;
  let statsFromServer = false;
  try {
    snap = await getDocFromServer(statsRef);
    statsFromServer = true;
  } catch {
    try {
      snap = await getDoc(statsRef);
    } catch {
      return EMPTY_DASHBOARD_RESULT;
    }
  }

  const data = snap.exists() ? (snap.data() ?? {}) : {};
  const conceptStats = (data.core_concept_stats ?? (data as { hierarchy_stats?: Record<string, StatEntry> }).hierarchy_stats ?? {}) as Record<string, StatEntry>;
  const subCoreIdStats = (data.sub_core_id_stats ?? {}) as Record<string, StatEntry>;
  const problemTypeStats = (data.problem_type_stats ?? {}) as Record<string, StatEntry>;
  const subjectStats = (data.subject_stats ?? {}) as Record<string, StatEntry>;

  /** 과목별 최근 점수(트렌드·안전도용). 최근 시험 순으로 채움 */
  const subjectRecentScores: Record<string, number[]> = {};
  for (const exam of recentExamDocs) {
    const scores = exam.subject_scores ?? {};
    for (const [key, val] of Object.entries(scores)) {
      if (typeof val === 'number' && Number.isFinite(val)) {
        if (!subjectRecentScores[key]) subjectRecentScores[key] = [];
        subjectRecentScores[key].push(val);
      }
    }
  }
  /** 최근 1회 시험의 과목별 점수 (과목별 안전도 = 예측합격률과 스케일 통일). 첫 문서에 없으면 최근 시험 중 있는 것 사용 */
  let latestSubjectScores: Record<string, number> = {};
  let latestExamForSubjects: ExamResultDoc | null = null;
  for (const exam of recentExamDocs) {
    const s = exam.subject_scores ?? {};
    if (Object.keys(s).length > 0) {
      latestSubjectScores = s;
      latestExamForSubjects = exam;
      break;
    }
  }
  const latestPassRateKind = latestExamForSubjects
    ? classifyExamPassRateContext(latestExamForSubjects.roundId ?? null)
    : 'diagnostic';
  /** 맞춤형·집중학습 직후: 누적 subject_stats 안정도와 혼합해 대시보드 급락 체감 완화 */
  const useDashboardStabilityBlend =
    latestPassRateKind === 'adaptive' || latestPassRateKind === 'focus_training';

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

  // 1) Radar (problem_type_stats) — 풀어본 유형만 표시 (미풀 유형 제외 → 3~5각형)
  const typeToA = new Map<string, number>();
  for (const [k, ent] of Object.entries(problemTypeStats)) {
    const total = ent?.total ?? 0;
    if (total > 0) typeToA.set(k, understandingFromStat(ent));
  }
  const radarData: RadarDataItem[] = PROBLEM_TYPE_LABELS.filter((label) => typeToA.has(label)).map((label) => ({
    subject: label,
    A: typeToA.get(label) ?? 0,
    fullMark: FULL_MARK,
  }));

  // ─── (참고) 진단 회차만 가중 평균 — 메인 예측 합격률은 fetchUserTrendData.recentPassRate 사용 ───
  let weightedPassRate: number | null = null;
  const passRates = recentExamDocs
    .filter((d) => isDiagnosticRound(d.roundId ?? null))
    .map((d) => displayPassRateFromExam(d))
    .filter((v): v is number => v != null);
  if (passRates.length >= 1) {
    const weights = [0.2, 0.3, 0.5]; // 오래된→최신 순
    const w = weights.slice(weights.length - passRates.length);
    const wSum = w.reduce((a, b) => a + b, 0);
    weightedPassRate = Math.round(
      passRates.reduce((acc, val, i) => acc + val * w[i], 0) / wSum
    );
  }

  // 2) 과목별 안전도: 최근 시험 + 최근 회차 평균 반영, 하한 15% (한 번 0점이어도 희망 유지)
  let subjectKeys = new Set([...Object.keys(subjectStats), ...Object.keys(latestSubjectScores)]);
  if (subjectKeys.size === 0 && recentExamDocs.length > 0) {
    for (const exam of recentExamDocs) {
      Object.keys(exam.subject_scores ?? {}).forEach((key) => subjectKeys.add(key));
    }
  }
  const subjectScores: SubjectScore[] = Array.from(subjectKeys)
    .filter((k) => k !== '0' || subjectKeys.size === 1)
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
    .map((key) => {
      const ent = subjectStats[key];
      const total = ent?.total ?? 0;
      const recentScores = subjectRecentScores[key] ?? [];
      const latestFromExam = latestSubjectScores[key];
      const avgRecent =
        recentScores.length > 0
          ? Math.round(
              recentScores.reduce((a, b) => a + b, 0) / recentScores.length
            )
          : null;
      const fromStats = ent ? understandingFromStat(ent) : null;
      // 한 회차 0점만으로 과목이 0%로 보이지 않게: 최근 2회 이상이면 (최신, 최근평균) 중 큰 값 사용 후 하한 적용
      let rawScore: number;
      if (useDashboardStabilityBlend) {
        const latest = latestFromExam ?? avgRecent ?? fromStats ?? 0;
        rawScore =
          fromStats != null
            ? Math.round(0.7 * fromStats + 0.3 * latest)
            : latest;
      } else if (recentScores.length >= 2 && (latestFromExam != null || avgRecent != null)) {
        const latest = latestFromExam ?? avgRecent ?? 0;
        const avg = avgRecent ?? latest;
        rawScore = Math.max(latest, avg);
      } else {
        rawScore =
          latestFromExam ??
          (avgRecent ?? (fromStats ?? 0));
      }
      const score = Math.max(
        SUBJECT_SCORE_MIN,
        Math.min(99, Math.round(Number(rawScore)))
      );
      const subjectNumber = parseInt(key, 10) || 1;
      const trend = recentScores.length >= 2 ? calcSubjectTrend(recentScores) : null;
      const safetyMargin = score - PASS_LINE; // 양수: 과락선 위, 음수: 과락 위험
      return {
        subject: `${key}과목`,
        subjectNumber,
        score,
        totalProblems: total,
        trend,
        safetyMargin,
      };
    });

  // 3) Weakness Top 3: 풀어본 개념만 (total > 0). sub_core_id → Core 합산 후 이해도 낮은 순 상위 3
  const MIN_TOTAL_FOR_WEAKNESS = 3;
  const MIN_TOTAL_FOR_WEAKNESS_RELAXED = 1;
  let weaknessCandidates: WeaknessItem[] = [];
  if (Object.keys(coreAggFromSubCore).length > 0) {
    const attemptedCores = Object.entries(coreAggFromSubCore).filter(([, agg]) => agg.total > 0);
    weaknessCandidates = attemptedCores
      .filter(([, agg]) => agg.total >= MIN_TOTAL_FOR_WEAKNESS)
      .map(([coreId, agg]) => {
        const avgProficiency = agg.total > 0 ? agg.sumProficiency / agg.total : 1200;
        const accuracy = understandingFromStat({ proficiency: avgProficiency, total: agg.total });
        return { name: `개념 ${coreId}`, id: coreId, accuracy, count: agg.total };
      })
      .sort((a, b) => a.accuracy - b.accuracy);
    if (weaknessCandidates.length === 0) {
      weaknessCandidates = attemptedCores
        .filter(([, agg]) => agg.total >= MIN_TOTAL_FOR_WEAKNESS_RELAXED)
        .map(([coreId, agg]) => {
          const avgProficiency = agg.total > 0 ? agg.sumProficiency / agg.total : 1200;
          const accuracy = understandingFromStat({ proficiency: avgProficiency, total: agg.total });
          return { name: `개념 ${coreId}`, id: coreId, accuracy, count: agg.total };
        })
        .sort((a, b) => a.accuracy - b.accuracy);
    }
  }
  if (weaknessCandidates.length === 0) {
    const toWeaknessItem = ([name, ent]: [string, StatEntry]): WeaknessItem => {
      const total = ent?.total ?? 0;
      const accuracy = understandingFromStat(ent);
      const id = /^\d+$/.test(name) ? name : undefined;
      return { name: id ? `개념 ${id}` : name, id, accuracy, count: total };
    };
    weaknessCandidates = Object.entries(conceptStats)
      .filter(([, ent]) => {
        const total = ent?.total ?? 0;
        return total > 0 && total >= MIN_TOTAL_FOR_WEAKNESS && (ent?.correct ?? 0) >= 1;
      })
      .map(toWeaknessItem)
      .sort((a, b) => a.accuracy - b.accuracy);
    if (weaknessCandidates.length === 0) {
      weaknessCandidates = Object.entries(conceptStats)
        .filter(([, ent]) => {
          const total = ent?.total ?? 0;
          return total > 0 && total >= MIN_TOTAL_FOR_WEAKNESS_RELAXED;
        })
        .map(toWeaknessItem)
        .sort((a, b) => a.accuracy - b.accuracy);
    }
  }

  const weaknessTop3 = weaknessCandidates.slice(0, 3);

  return {
    radarData,
    subjectScores,
    weaknessTop3,
  };
  } catch (err) {
    if (process.env.NODE_ENV === 'development') {
      console.error('[Stats] fetchDashboardStats 오류 (대시보드 0 원인 추적용):', err);
    }
    return EMPTY_DASHBOARD_RESULT;
  }
}
