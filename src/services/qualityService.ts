/**
 * qualityService.ts
 * 문항별 학습 행동 지표 분석 및 품질 등급
 * - problem_attempt_stats 문서 기반 dontKnowRate, confusedRate, luckedRate 계산
 * - 최소 시도 수 미만이면 null 반환
 * - 품질 등급 A/B/C/D 및 이슈 목록 반환
 */

import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { CERTIFICATIONS } from '../constants';

/** 최소 시도 수: 이 수 미만이면 품질 분석 생략 */
const MIN_ATTEMPTS = 30;

export type ProblemQualityGrade = 'A' | 'B' | 'C' | 'D';

export interface ProblemBehaviorAnalysis {
  /** 문항 ID */
  problemId: string;
  /** 자격증 코드 */
  certCode: string;
  /** 총 시도 수 */
  totalAttempts: number;
  /** 모르겠어요 비율 (0~1) */
  dontKnowRate: number;
  /** 헷갈림 비율 (0~1) */
  confusedRate: number;
  /** 찍기 비율 (0~1) */
  luckedRate: number;
  /** 품질 등급 */
  grade: ProblemQualityGrade;
  /** 이슈 코드 목록 (예: 'high_dont_know', 'high_lucked') */
  issues: string[];
}

interface ProblemAttemptStatsDoc {
  totalAttempts?: number;
  dontKnowCount?: number;
  confusedCount?: number;
  luckedCount?: number;
}

/** 등급/이슈 판정 기준 */
const THRESHOLDS = {
  dontKnowRateD: 0.4,
  dontKnowRateC: 0.25,
  luckedRateC: 0.3,
  confusedRateB: 0.5,
} as const;

/**
 * 단일 문항의 행동 지표 분석 및 품질 등급 반환
 * @param certCode 자격증 코드
 * @param problemId 문항 ID (qid)
 * @returns 분석 결과 또는 최소 시도 수 미만 시 null
 */
export async function analyzeProblemBehavior(
  certCode: string,
  problemId: string
): Promise<ProblemBehaviorAnalysis | null> {
  const docId = `${certCode}_${problemId}`;
  const ref = doc(db, 'problem_attempt_stats', docId);
  const snap = await getDoc(ref);
  const data = snap.data() as ProblemAttemptStatsDoc | undefined;
  if (!data) return null;

  const totalAttempts = Number(data.totalAttempts ?? 0);
  if (totalAttempts < MIN_ATTEMPTS) return null;

  const dontKnowCount = Number(data.dontKnowCount ?? 0);
  const confusedCount = Number(data.confusedCount ?? 0);
  const luckedCount = Number(data.luckedCount ?? 0);

  const dontKnowRate = totalAttempts > 0 ? dontKnowCount / totalAttempts : 0;
  const confusedRate = totalAttempts > 0 ? confusedCount / totalAttempts : 0;
  const luckedRate = totalAttempts > 0 ? luckedCount / totalAttempts : 0;

  const issues: string[] = [];
  if (dontKnowRate >= THRESHOLDS.dontKnowRateD) issues.push('high_dont_know');
  else if (dontKnowRate >= THRESHOLDS.dontKnowRateC) issues.push('elevated_dont_know');
  if (luckedRate >= THRESHOLDS.luckedRateC) issues.push('high_lucked');
  if (confusedRate >= THRESHOLDS.confusedRateB) issues.push('high_confused');

  let grade: ProblemQualityGrade = 'A';
  if (dontKnowRate >= THRESHOLDS.dontKnowRateD || (issues.includes('high_lucked') && dontKnowRate >= THRESHOLDS.dontKnowRateC)) {
    grade = 'D';
  } else if (dontKnowRate >= THRESHOLDS.dontKnowRateC || issues.includes('high_lucked')) {
    grade = 'C';
  } else if (confusedRate >= THRESHOLDS.confusedRateB) {
    grade = 'B';
  }

  return {
    problemId,
    certCode,
    totalAttempts,
    dontKnowRate,
    confusedRate,
    luckedRate,
    grade,
    issues,
  };
}

const CERT_CODES = new Set(CERTIFICATIONS.map((c) => c.code));

function parseDocId(docId: string): { certCode: string; problemId: string } | null {
  const idx = docId.indexOf('_');
  if (idx <= 0) return null;
  const certCode = docId.slice(0, idx);
  if (!CERT_CODES.has(certCode)) return null;
  return { certCode, problemId: docId.slice(idx + 1) };
}

function computeGradeFromRates(dontKnowRate: number, confusedRate: number, luckedRate: number): ProblemQualityGrade {
  const issues: string[] = [];
  if (dontKnowRate >= THRESHOLDS.dontKnowRateD) issues.push('high_dont_know');
  else if (dontKnowRate >= THRESHOLDS.dontKnowRateC) issues.push('elevated_dont_know');
  if (luckedRate >= THRESHOLDS.luckedRateC) issues.push('high_lucked');
  if (confusedRate >= THRESHOLDS.confusedRateB) issues.push('high_confused');
  if (dontKnowRate >= THRESHOLDS.dontKnowRateD || (issues.includes('high_lucked') && dontKnowRate >= THRESHOLDS.dontKnowRateC)) return 'D';
  if (dontKnowRate >= THRESHOLDS.dontKnowRateC || issues.includes('high_lucked')) return 'C';
  if (confusedRate >= THRESHOLDS.confusedRateB) return 'B';
  return 'A';
}

/** 전역 플래그 분포 (problem_attempt_stats 전체 집계) */
export interface FlagDistribution {
  totalAttempts: number;
  dontKnowCount: number;
  confusedCount: number;
  luckedCount: number;
  dontKnowRate: number;
  confusedRate: number;
  luckedRate: number;
}

export async function getFlagDistribution(): Promise<FlagDistribution> {
  const snap = await getDocs(collection(db, 'problem_attempt_stats'));
  let totalAttempts = 0;
  let dontKnowCount = 0;
  let confusedCount = 0;
  let luckedCount = 0;
  snap.docs.forEach((d) => {
    const data = d.data() as ProblemAttemptStatsDoc;
    const t = Number(data.totalAttempts ?? 0);
    totalAttempts += t;
    dontKnowCount += Number(data.dontKnowCount ?? 0);
    confusedCount += Number(data.confusedCount ?? 0);
    luckedCount += Number(data.luckedCount ?? 0);
  });
  return {
    totalAttempts,
    dontKnowCount,
    confusedCount,
    luckedCount,
    dontKnowRate: totalAttempts > 0 ? dontKnowCount / totalAttempts : 0,
    confusedRate: totalAttempts > 0 ? confusedCount / totalAttempts : 0,
    luckedRate: totalAttempts > 0 ? luckedCount / totalAttempts : 0,
  };
}

/** 문제 품질 요약 (등급별 개수, 자격증별) */
export interface ProblemQualitySummary {
  totalAnalyzed: number;
  gradeA: number;
  gradeB: number;
  gradeC: number;
  gradeD: number;
  quarantined: number;
  byCert: Record<string, { totalAnalyzed: number; gradeA: number; gradeB: number; gradeC: number; gradeD: number; quarantined: number }>;
}

export async function getProblemQualitySummary(): Promise<ProblemQualitySummary> {
  const snap = await getDocs(collection(db, 'problem_attempt_stats'));
  const byCert: Record<string, { totalAnalyzed: number; gradeA: number; gradeB: number; gradeC: number; gradeD: number; quarantined: number }> = {};
  let totalAnalyzed = 0;
  let gradeA = 0;
  let gradeB = 0;
  let gradeC = 0;
  let gradeD = 0;
  let quarantined = 0;

  snap.docs.forEach((d) => {
    const data = d.data() as ProblemAttemptStatsDoc;
    const totalAttempts = Number(data.totalAttempts ?? 0);
    if (totalAttempts < MIN_ATTEMPTS) return;
    const parsed = parseDocId(d.id);
    if (!parsed) return;
    const dontKnowCount = Number(data.dontKnowCount ?? 0);
    const confusedCount = Number(data.confusedCount ?? 0);
    const luckedCount = Number(data.luckedCount ?? 0);
    const dontKnowRate = dontKnowCount / totalAttempts;
    const confusedRate = confusedCount / totalAttempts;
    const luckedRate = luckedCount / totalAttempts;
    const grade = computeGradeFromRates(dontKnowRate, confusedRate, luckedRate);
    totalAnalyzed += 1;
    if (grade === 'A') gradeA += 1;
    else if (grade === 'B') gradeB += 1;
    else if (grade === 'C') gradeC += 1;
    else gradeD += 1;
    if (grade === 'D') quarantined += 1;
    const cert = parsed.certCode;
    if (!byCert[cert]) {
      byCert[cert] = { totalAnalyzed: 0, gradeA: 0, gradeB: 0, gradeC: 0, gradeD: 0, quarantined: 0 };
    }
    byCert[cert].totalAnalyzed += 1;
    if (grade === 'A') byCert[cert].gradeA += 1;
    else if (grade === 'B') byCert[cert].gradeB += 1;
    else if (grade === 'C') byCert[cert].gradeC += 1;
    else {
      byCert[cert].gradeD += 1;
      byCert[cert].quarantined += 1;
    }
  });

  return {
    totalAnalyzed,
    gradeA,
    gradeB,
    gradeC,
    gradeD,
    quarantined,
    byCert,
  };
}
