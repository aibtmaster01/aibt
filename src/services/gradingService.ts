/**
 * gradingService.ts
 * 채점 및 결과 저장
 * - certification_info 기반 과목별 점수·합격 판정·exam_results 저장
 * - users/{uid}/stats/{certCode} 하위 core_concept_stats, problem_type_stats, subject_stats 3차원 통계
 *   - correct/total/misconception_count: increment(전체 역사 누적)
 *   - proficiency: Elo 스타일 실시간 갱신(최신 회차 가중 반영, 1200 기준 K=32)
 * - exam_results에 predicted_pass_rate 저장
 * - Elo 유지
 */

import { collection, doc, getDoc, getDocFromServer, getDocs, setDoc, updateDoc, Timestamp, increment, query, where, limit } from 'firebase/firestore';
import { db } from '../firebase';
import { Question } from '../types';
import type { Certification, CertificationInfo, ExamResultSubjectScores, SubjectConfig } from '../types';
import { CERTIFICATIONS } from '../constants';
import { useBetaCertifications } from '../config/brand';

/** 자격증 표시 이름: certification_info.exam_name 우선, 없으면 constants cert.name */
export function getCertDisplayName(cert: Certification | null | undefined, certInfo: CertificationInfo | null | undefined): string {
  if (!cert) return '';
  return (certInfo?.exam_name ?? cert.name) || '';
}

const K_FACTOR = 32;
const DEFAULT_ELO = 1200;
/** Elo 기반 proficiency 계산 시 문제 난이도 (고정) */
const PROBLEM_DIFFICULTY_ELO = 1200;

/** 실제 시험 출제 난이도 기준 (0~1). 이 수준이면 보정 없음 */
const REFERENCE_DIFFICULTY = 0.6;
/** 난이도 가중치: w_i = 1 + BETA * (d_i - REF). 0.6 근처 문항이 합격률에 직결 */
const DIFFICULTY_WEIGHT_BETA = 0.5;
/** proficiency 갱신 민감도 (최신 결과 반영) */
const PROFICIENCY_K_FACTOR = 32;

/**
 * 약점 우선순위 공식 (examService.calculatePriority 등에서 참조):
 * Priority = (100 - Proficiency) × 0.5 + DaysSince × 0.3 + MisconceptionCount × 5 × 0.2
 */
const DEFAULT_SCORE_PER_QUESTION = 5;
const MIN_SUBJECT_SCORE_FOR_STABILITY = 40;
const STABILITY_FACTOR_WITH_FAIL = 0.8;
const STABILITY_FACTOR_NO_FAIL = 1.0;

/** difficulty_level 1~5 → 0~1 (실제 시험 ≈ 0.6). 없으면 0.6 */
function getDifficulty01(q: Question | undefined): number {
  const level = q?.difficulty_level;
  if (level != null && level >= 1 && level <= 5) return 0.2 * level;
  return REFERENCE_DIFFICULTY;
}

/** Expected (맞출 확률): 1 / (1 + 10^((problemElo - userProficiency) / 400)) */
function expectedScore(userProficiency: number, problemElo: number = PROBLEM_DIFFICULTY_ELO): number {
  return 1 / (1 + Math.pow(10, (problemElo - userProficiency) / 400));
}

/** 3차원 플래그 기반 가중치 (베타 보수적). Δ_final = Δ_base × WeightMultiplier */
function getWeightMultiplier(
  outcome: number,
  isDontKnow: boolean,
  isLucked: boolean,
  isConfused: boolean
): number {
  if (outcome === 0) {
    if (isDontKnow) return 1.3;
    if (isConfused) return 1.1;
    return 1.0;
  }
  if (isLucked) return 0.2;
  if (isConfused) return 0.4;
  return 1.0;
}

/**
 * Elo 스타일 proficiency 갱신: Δ_base = K×(Outcome−Expected), Δ_final = Δ_base × WeightMultiplier
 * 3차원 플래그: isDontKnow(모르겠어요), isConfused(풀이시간≥예상×2.5), isLucked(찍기)
 */
function nextProficiencyWithWeight(
  oldProficiency: number,
  outcome: number,
  weightMultiplier: number
): number {
  const expected = expectedScore(oldProficiency);
  const deltaBase = outcome - expected;
  const deltaFinal = deltaBase * weightMultiplier;
  const newP = oldProficiency + PROFICIENCY_K_FACTOR * deltaFinal;
  return Math.max(100, Math.min(2500, Math.round(newP)));
}

/** Elo proficiency → 0~100% (표시용, 문제 난이도 1200 기준) */
export function eloToPercent(proficiency: number): number {
  const p = Math.max(100, Math.min(2500, proficiency));
  const expected = expectedScore(p);
  return Math.max(0, Math.min(100, Math.round(expected * 100)));
}

/**
 * Firestore 필드(Key)에 사용 불가인 특수문자를 언더바로 치환.
 * . / [ ] * ~ 등은 문서 경로에서 사용할 수 없음.
 */
function sanitizeKey(key: string): string {
  return key.replace(/[./\[\]*~]/g, '_');
}

/** 퀴즈 답안 기록 (Result/Quiz 호출부와 호환). 3차원 플래그는 gradingService에서 판정 */
export interface QuizAnswerRecord {
  qid: string;
  selected: number;
  isCorrect: boolean;
  /** 모르겠어요 선택(selected===0) 시 true. Quiz에서 설정, gradingService에서도 재계산 가능 */
  isDontKnow?: boolean;
  /** (레거시) Quiz에서 넘기지 않음. isConfused/isLucked는 gradingService에서 시간·Expected로 판정 */
  isConfused?: boolean;
  /** 문항 풀이 소요 시간(초). 플래그 판정: isConfused(≥예상×2.5), isLucked(<예상×0.5) */
  elapsedSec?: number;
}

/** exam_results 문서에 저장할 옵션 */
export interface SubmitQuizResultOptions {
  examId?: string;
  roundId?: string;
  /** 집중학습(과목/유형/개념) 완료 시 나의 학습 기록 표시용 라벨 (예: "과목 강화 학습 - 3과목 강화") */
  roundLabel?: string;
  /** (베타 로컬) 진단 Elo 재조정 시 사용 — 가입 시 선택한 난이도 */
  prepLevel?: 'beginner' | 'intermediate' | 'advanced';
}

/** stats 하위 문서 내 키별 값: { correct, total, confused, proficiency? } */
export interface StatEntry {
  correct: number;
  total: number;
  confused: number;
  /** Elo 스타일 이해도 (최신 실력 반영, 1200 기준) */
  proficiency?: number;
}

/** users/{uid}/stats/{certCode} 문서 구조 (3차원 통계 + 태그/헷갈림 + 세부개념) */
export interface UserStatsDoc {
  core_concept_stats?: Record<string, StatEntry>;
  problem_type_stats?: Record<string, StatEntry>;
  subject_stats?: Record<string, StatEntry>;
  /** 세부 개념(sub_core_id) 단위 proficiency·correct·total (예: "22-2") */
  sub_core_id_stats?: Record<string, StatEntry>;
  /** 태그별 correct, total, misconception_count (필드 키는 sanitizeKey 적용) */
  tag_stats?: Record<string, StatEntry>;
  /** 풀이시간 ≥ 예상×2.5 인 문제 ID (헷갈림) */
  confused_qids?: string[];
  /** 모르겠어요 선택한 문제 ID */
  dontknow_qids?: string[];
}

function certIdToCode(certId: string): string | null {
  const cert = CERTIFICATIONS.find((c) => c.id === certId);
  return cert?.code ?? null;
}

/**
 * Firestore certification_info 조회
 * 경로: certifications/{certCode}/certification_info/config
 */
export async function getCertificationInfo(certCode: string): Promise<CertificationInfo | null> {
  const ref = doc(db, 'certifications', certCode, 'certification_info', 'config');
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  const data = snap.data();
  if (!data?.exam_config?.pass_criteria || !Array.isArray(data?.subjects)) return null;
  return data as unknown as CertificationInfo;
}

// ---------- 예측 합격률 (시그모이드) ----------
// 상세 공식·규칙: docs/PASS_RATE_AND_SAFETY.md

const SIGMOID_CENTER = 60; // 합격선(변곡점)
const SIGMOID_STEEPNESS = 0.08; // S자 곡선 기울기
const PASS_RATE_PENALTY_MAX = 20; // 과락 시 최대 감점
/** 예측 합격률 하한: 처음 망쳐도 절망적인 수치 방지, 희망 유지 */
export const PASS_RATE_MIN = 15;
/** 예측 합격률 상한(%) */
export const PASS_RATE_MAX = 96;

/** 시그모이드: 합격선 60점 근처에서 점수 차이가 %에 민감하게 반영되도록 S자 변환 */
function applySigmoidTransform(score: number): number {
  const sigmoid = 1 / (1 + Math.exp(-SIGMOID_STEEPNESS * (score - SIGMOID_CENTER)));
  return Math.round(sigmoid * 100);
}

/**
 * 예측 합격률 (PASS_RATE_MIN~PASS_RATE_MAX)
 * 1) 과목별 점수 평균 − 과락 패널티 → 원점수(0~100)
 * 2) 시그모이드 변환 → 합격선 근처 민감도 확대
 * 3) 최소 15% 보장(희망 유지), 최대 96%
 * 4) 난이도 보정(α)은 호출부에서 적용 후 저장
 */
function computePredictedPassRate(
  subject_scores: ExamResultSubjectScores,
  minSubjectScore: number = MIN_SUBJECT_SCORE_FOR_STABILITY
): number {
  const scores = Object.values(subject_scores);
  if (scores.length === 0) return PASS_RATE_MIN;
  const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
  const minScore = Math.min(...scores);
  let penalty = 0;
  if (minScore < minSubjectScore) {
    penalty = ((minSubjectScore - minScore) / minSubjectScore) * PASS_RATE_PENALTY_MAX;
  }
  let rawPassRate = Math.max(0, Math.min(100, avgScore - penalty));
  const sigmoidPassRate = applySigmoidTransform(rawPassRate);
  const finalPassRate = Math.max(PASS_RATE_MIN, Math.min(PASS_RATE_MAX, sigmoidPassRate));
  if (import.meta.env.DEV) {
    console.log(`[computePredictedPassRate] 원점수 ${Math.round(rawPassRate)} → 시그모이드 ${sigmoidPassRate}% → 최종 ${finalPassRate}%`);
  }
  return finalPassRate;
}

/**
 * 예측 합격률 구간별 격려 메시지 (낮은 합격률에도 희망·동기 부여)
 */
export function getEncouragementMessageForPassRate(passRate: number): string {
  const p = Number(passRate);
  if (!Number.isFinite(p)) return '꾸준히 연습하면 합격에 한 걸음 더 가까워져요.';
  if (p < 30) return '기초부터 차근차근, 조금씩만 올려도 합격에 가까워져요.';
  if (p < 50) return '약점 보완에 집중하면 합격 가능성이 확 올라갑니다.';
  if (p < 70) return '꾸준히 복습하면 곧 합격선을 넘을 수 있어요.';
  return '잘하고 있어요. 마지막까지 꾸준히만 하면 됩니다.';
}

/**
 * 시험 문항이 과목 순(1과목→2과목→…)으로 정렬되어 있을 때, 인덱스별 과목 번호 배열 생성.
 * 문제에 subject_number가 없는 경우(예: round2 풀) 채점 시 과목 추정 폴백으로 사용.
 */
export function buildIndexToSubject(
  questions: Question[],
  subjects: SubjectConfig[] | undefined
): number[] | null {
  if (!subjects?.length || questions.length === 0) return null;
  const counts = subjects.map((s) => s.question_count ?? 0).filter((c) => c > 0);
  if (counts.length === 0) return null;
  const total = counts.reduce((a, b) => a + b, 0);
  if (total < 1) return null;
  const result: number[] = [];
  let cum = 0;
  let subjIndex = 0;
  for (let i = 0; i < questions.length; i++) {
    while (subjIndex < subjects.length && i >= cum + (counts[subjIndex] ?? 0)) {
      cum += counts[subjIndex] ?? 0;
      subjIndex++;
    }
    const subj = subjects[subjIndex];
    result.push(subj ? subj.subject_number : 1);
  }
  return result;
}

/**
 * 퀴즈 결과 제출
 * - certification_info 기반 과목별 점수·합격 판정·exam_results 저장 (predicted_pass_rate 포함)
 * - users/{uid}/stats/{certCode} 에 core_concept_stats, problem_type_stats, subject_stats 업데이트 (increment)
 * - Elo 유지
 */
export async function submitQuizResult(
  uid: string,
  certId: string,
  sessionHistory: QuizAnswerRecord[],
  questions: Question[],
  options?: SubmitQuizResultOptions
): Promise<{ examId: string; subject_scores: ExamResultSubjectScores; is_passed: boolean } | null> {
  const certCode = certIdToCode(certId);
  if (!certCode) return null;

  const certInfo = await getCertificationInfo(certCode);
  const qMap = new Map(questions.map((q) => [q.id, q]));
  /** 문제 순서(인덱스) → 과목 번호. subject_number가 없는 문제(예: round2 풀)에 대한 폴백용 */
  const indexToSubject = buildIndexToSubject(questions, certInfo?.subjects);

  // ---- 과목별 점수 계산: 난이도 가중 (기준 0.6, w_i = 1 + β*(d_i - 0.6)) ----
  const subjectWeightedCorrect: Record<string, number> = {};
  const subjectWeightedTotal: Record<string, number> = {};
  let sumDifficulty = 0;
  for (let i = 0; i < sessionHistory.length; i++) {
    const rec = sessionHistory[i];
    const q = qMap.get(rec.qid);
    let subjKey: string;
    if (q?.subject_number != null) {
      subjKey = String(q.subject_number);
    } else if (indexToSubject && i < indexToSubject.length) {
      subjKey = String(indexToSubject[i]);
    } else {
      subjKey = '0';
    }
    const d = getDifficulty01(q);
    const w = 1 + DIFFICULTY_WEIGHT_BETA * (d - REFERENCE_DIFFICULTY);
    if (!subjectWeightedTotal[subjKey]) {
      subjectWeightedCorrect[subjKey] = 0;
      subjectWeightedTotal[subjKey] = 0;
    }
    subjectWeightedTotal[subjKey] += w;
    if (rec.isCorrect) subjectWeightedCorrect[subjKey] += w;
    sumDifficulty += d;
  }

  const subject_scores: ExamResultSubjectScores = {};
  let hasSubjectScoring = false;
  if (certInfo?.subjects?.length) {
    for (const subj of certInfo.subjects) {
      const key = String(subj.subject_number);
      const W = subjectWeightedTotal[key] ?? 0;
      const C = subjectWeightedCorrect[key] ?? 0;
      const score = W > 0 ? Math.round((C / W) * 100) : 0;
      subject_scores[key] = Math.min(99, Math.max(0, score));
      if (W > 0) hasSubjectScoring = true;
    }
  } else {
    const W = Object.values(subjectWeightedTotal).reduce((a, b) => a + b, 0);
    const C = Object.values(subjectWeightedCorrect).reduce((a, b) => a + b, 0);
    if (W > 0) {
      subject_scores['0'] = Math.min(99, Math.max(0, Math.round((C / W) * 100)));
      hasSubjectScoring = true;
    }
  }

  // ---- 합격 여부 ----
  let is_passed = false;
  const minSubjectScore = certInfo?.exam_config?.pass_criteria?.min_subject_score ?? MIN_SUBJECT_SCORE_FOR_STABILITY;
  if (certInfo?.exam_config?.pass_criteria && hasSubjectScoring) {
    const { average_score } = certInfo.exam_config.pass_criteria;
    const scores = Object.values(subject_scores);
    const noFail = scores.every((s) => s >= minSubjectScore);
    const avg = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    is_passed = noFail && avg >= average_score;
  }

  // ---- 예측 합격률: 시그모이드 합격률 × 난이도 보정(α) ----
  const P_raw = computePredictedPassRate(subject_scores, minSubjectScore);
  const avgDifficulty =
    sessionHistory.length > 0 ? sumDifficulty / sessionHistory.length : REFERENCE_DIFFICULTY;
  const alpha =
    avgDifficulty <= REFERENCE_DIFFICULTY
      ? 0.5 + 0.5 * (avgDifficulty / REFERENCE_DIFFICULTY)
      : Math.min(1.2, 0.7 + 0.5 * (avgDifficulty / REFERENCE_DIFFICULTY));
  const predicted_pass_rate = Math.max(PASS_RATE_MIN, Math.min(99, Math.round(alpha * P_raw)));

  // ---- stats 선로드 (플래그·가중치 계산에 초기 proficiency 필요) ----
  // 서버에서 읽어 2회차 제출 시 캐시된 빈 스냅으로 기존 스탯이 덮어씌워지는 것 방지
  const statsRef = doc(db, 'users', uid, 'stats', certCode);
  let statsSnap;
  try {
    statsSnap = await getDocFromServer(statsRef);
  } catch {
    statsSnap = await getDoc(statsRef);
  }
  const statsData = statsSnap.exists() ? (statsSnap.data() ?? {}) : {};
  const conceptStats = (statsData.core_concept_stats ?? (statsData as { hierarchy_stats?: Record<string, StatEntry> }).hierarchy_stats ?? {}) as Record<string, StatEntry & { misconception_count?: number }>;
  const problemTypeStats = (statsData.problem_type_stats ?? {}) as Record<string, StatEntry & { misconception_count?: number }>;
  const subjectStats = (statsData.subject_stats ?? {}) as Record<string, StatEntry & { misconception_count?: number }>;
  const subCoreIdStats = (statsData.sub_core_id_stats ?? {}) as Record<string, StatEntry & { misconception_count?: number }>;
  const getProficiency = (entry: unknown): number => {
    const e = entry as { proficiency?: number } | undefined;
    return e?.proficiency != null && Number.isFinite(e.proficiency) ? e.proficiency : DEFAULT_ELO;
  };
  const conceptProficiencyInit: Record<string, number> = {};
  const problemTypeProficiencyInit: Record<string, number> = {};
  const subjectProficiencyInit: Record<string, number> = {};
  const subCoreIdProficiencyInit: Record<string, number> = {};
  for (const [pathKey, entry] of Object.entries(conceptStats)) {
    conceptProficiencyInit[sanitizeKey(pathKey)] = getProficiency(entry);
  }
  for (const [pathKey, entry] of Object.entries(problemTypeStats)) {
    problemTypeProficiencyInit[sanitizeKey(pathKey)] = getProficiency(entry);
  }
  for (const [pathKey, entry] of Object.entries(subjectStats)) {
    subjectProficiencyInit[sanitizeKey(pathKey)] = getProficiency(entry);
  }
  for (const [pathKey, entry] of Object.entries(subCoreIdStats)) {
    subCoreIdProficiencyInit[sanitizeKey(pathKey)] = getProficiency(entry);
  }

  const CONFUSED_TIME_MULT = 2.5;
  const LUCKED_TIME_MULT = 0.5;
  const LUCKED_EXPECTED_THRESHOLD = 0.5;
  const answersWithFlags = sessionHistory.map((r) => {
    const q = qMap.get(r.qid);
    const isDontKnow = r.selected === 0;
    const estimatedSec = (q as { estimated_time_sec?: number })?.estimated_time_sec;
    const elapsedSec = r.elapsedSec ?? 0;
    const isConfused =
      estimatedSec != null &&
      Number.isFinite(estimatedSec) &&
      elapsedSec >= estimatedSec * CONFUSED_TIME_MULT;
    const cKey = q ? sanitizeKey((q.core_concept ?? '').trim() || '기타') : '';
    const expected = cKey ? expectedScore(conceptProficiencyInit[cKey] ?? DEFAULT_ELO) : 0.5;
    const isLucked =
      r.isCorrect === true &&
      expected < LUCKED_EXPECTED_THRESHOLD &&
      estimatedSec != null &&
      Number.isFinite(estimatedSec) &&
      elapsedSec < estimatedSec * LUCKED_TIME_MULT;
    return {
      qid: r.qid,
      isCorrect: r.isCorrect,
      ...(r.elapsedSec != null && { elapsedSec: r.elapsedSec }),
      isDontKnow,
      isConfused,
      isLucked,
    };
  });

  // ---- (진단 Elo) 재응시 여부: 저장 전에 같은 roundId 제출 이력 확인 ----
  const roundIdForElo = options?.roundId ?? null;
  const prepLevel = options?.prepLevel;
  const isDiagnosticRoundId = typeof roundIdForElo === 'string' && /^(l|m|h)_[123]$/.test(roundIdForElo);
  let hasPrevDiagnosticSubmission = false;
  if (useBetaCertifications && isDiagnosticRoundId) {
    const examColRef = collection(db, 'users', uid, 'exam_results');
    const prevQ = query(examColRef, where('roundId', '==', roundIdForElo), limit(1));
    const prevSnap = await getDocs(prevQ);
    hasPrevDiagnosticSubmission = !prevSnap.empty;
  }

  // ---- exam_results 저장 ----
  const examId = options?.examId ?? `exam_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const examRef = doc(db, 'users', uid, 'exam_results', examId);
  const examData = {
    certId,
    certCode,
    roundId: options?.roundId ?? null,
    ...(options?.roundLabel != null && options.roundLabel !== '' ? { roundLabel: options.roundLabel } : {}),
    subject_scores,
    is_passed,
    predicted_pass_rate,
    totalQuestions: sessionHistory.length,
    correctCount: sessionHistory.filter((r) => r.isCorrect).length,
    answers: answersWithFlags,
    submittedAt: Timestamp.now(),
  };
  try {
    await setDoc(examRef, examData, { merge: true });
    const verifySnap = await getDoc(examRef);
    if (!verifySnap.exists()) {
      throw new Error(`exam_results 문서 저장 실패: ${examId}`);
    }
  } catch (err) {
    console.error('[gradingService] exam_results 저장 실패:', {
      examId,
      uid,
      certId,
      questionCount: sessionHistory.length,
      error: err,
    });
    throw err;
  }

  // ---- 3차원 통계 + 태그 + 세부개념(sub_core_id) 집계 (시간기준 confused, dontknow) ----
  const conceptAgg: Record<string, { correct: number; total: number; confused: number }> = {};
  const problemTypeAgg: Record<string, { correct: number; total: number; confused: number }> = {};
  const subjectAgg: Record<string, { correct: number; total: number; confused: number }> = {};
  const subCoreIdAgg: Record<string, { correct: number; total: number; confused: number }> = {};
  const tagAgg: Record<string, { correct: number; total: number; confused: number }> = {};
  const confusedQids: string[] = [];
  const dontknowQids: string[] = [];

  for (let i = 0; i < sessionHistory.length; i++) {
    const rec = sessionHistory[i];
    const ans = answersWithFlags[i];
    const q = qMap.get(rec.qid);
    if (!q || !ans) continue;

    const correct = rec.isCorrect ? 1 : 0;
    const total = 1;
    const confused = ans.isConfused ? 1 : 0;
    if (ans.isConfused && rec.qid) confusedQids.push(rec.qid);
    if (ans.isDontKnow && rec.qid) dontknowQids.push(rec.qid);

    // 0) sub_core_id_stats: 세부 개념 단위 (proficiency 저장용)
    const subCoreKey = (q.sub_core_id ?? '').trim();
    if (subCoreKey) {
      if (!subCoreIdAgg[subCoreKey]) subCoreIdAgg[subCoreKey] = { correct: 0, total: 0, confused: 0 };
      subCoreIdAgg[subCoreKey].correct += correct;
      subCoreIdAgg[subCoreKey].total += total;
      subCoreIdAgg[subCoreKey].confused += confused;
    }

    // 1) core_concept_stats: 문제의 core_concept 필드 (표준 분류 체계)
    const conceptKey = (q.core_concept ?? '').trim() || '기타';
    if (!conceptAgg[conceptKey]) conceptAgg[conceptKey] = { correct: 0, total: 0, confused: 0 };
    conceptAgg[conceptKey].correct += correct;
    conceptAgg[conceptKey].total += total;
    conceptAgg[conceptKey].confused += confused;

    // 2) problem_type_stats: problem_types 배열 순회 (1문제가 여러 유형일 수 있음)
    const types = Array.isArray(q.problem_types) ? q.problem_types : [];
    for (const pt of types) {
      if (!pt || typeof pt !== 'string') continue;
      const ptKey = String(pt).trim();
      if (!ptKey) continue;
      if (!problemTypeAgg[ptKey]) problemTypeAgg[ptKey] = { correct: 0, total: 0, confused: 0 };
      problemTypeAgg[ptKey].correct += correct;
      problemTypeAgg[ptKey].total += total;
      problemTypeAgg[ptKey].confused += confused;
    }

    // 3) subject_stats: subject_number
    const subjKey = q.subject_number != null ? String(q.subject_number) : '0';
    if (!subjectAgg[subjKey]) subjectAgg[subjKey] = { correct: 0, total: 0, confused: 0 };
    subjectAgg[subjKey].correct += correct;
    subjectAgg[subjKey].total += total;
    subjectAgg[subjKey].confused += confused;

    // 4) tag_stats: 각 문제의 tags 배열별 correct, total, misconception_count (필드 키는 sanitizeKey 적용)
    const tags = Array.isArray(q.tags) ? q.tags : [];
    for (const tag of tags) {
      if (!tag || typeof tag !== 'string') continue;
      const tagKey = sanitizeKey(String(tag).trim());
      if (!tagKey) continue;
      if (!tagAgg[tagKey]) tagAgg[tagKey] = { correct: 0, total: 0, confused: 0 };
      tagAgg[tagKey].correct += correct;
      tagAgg[tagKey].total += total;
      tagAgg[tagKey].confused += confused;
    }
  }

  const conceptProficiency: Record<string, number> = { ...conceptProficiencyInit };
  const problemTypeProficiency: Record<string, number> = { ...problemTypeProficiencyInit };
  const subjectProficiency: Record<string, number> = { ...subjectProficiencyInit };
  const subCoreIdProficiency: Record<string, number> = { ...subCoreIdProficiencyInit };

  for (let i = 0; i < sessionHistory.length; i++) {
    const rec = sessionHistory[i];
    const ans = answersWithFlags[i];
    const q = qMap.get(rec.qid);
    if (!q || !ans) continue;

    const outcome = rec.isCorrect ? 1 : 0;
    const weight = getWeightMultiplier(outcome, ans.isDontKnow, ans.isLucked, ans.isConfused);

    const subCoreKey = (q.sub_core_id ?? '').trim();
    if (subCoreKey) {
      const pathKey = sanitizeKey(subCoreKey);
      subCoreIdProficiency[pathKey] = nextProficiencyWithWeight(
        subCoreIdProficiency[pathKey] ?? DEFAULT_ELO,
        outcome,
        weight
      );
    }

    const cKey = sanitizeKey((q.core_concept ?? '').trim() || '기타');
    conceptProficiency[cKey] = nextProficiencyWithWeight(conceptProficiency[cKey] ?? DEFAULT_ELO, outcome, weight);

    for (const pt of Array.isArray(q.problem_types) ? q.problem_types : []) {
      if (!pt || typeof pt !== 'string') continue;
      const ptKey = sanitizeKey(String(pt).trim());
      if (!ptKey) continue;
      problemTypeProficiency[ptKey] = nextProficiencyWithWeight(
        problemTypeProficiency[ptKey] ?? DEFAULT_ELO,
        outcome,
        weight
      );
    }

    const subjKey = q.subject_number != null ? String(q.subject_number) : '0';
    const subjPathKey = sanitizeKey(subjKey);
    subjectProficiency[subjPathKey] = nextProficiencyWithWeight(
      subjectProficiency[subjPathKey] ?? DEFAULT_ELO,
      outcome,
      weight
    );
  }

  const updates: Record<string, ReturnType<typeof increment> | number | string[]> = {};

  for (const [key, agg] of Object.entries(conceptAgg)) {
    const pathKey = sanitizeKey(key);
    updates[`core_concept_stats.${pathKey}.correct`] = increment(agg.correct);
    updates[`core_concept_stats.${pathKey}.total`] = increment(agg.total);
    updates[`core_concept_stats.${pathKey}.misconception_count`] = increment(agg.confused);
    updates[`core_concept_stats.${pathKey}.proficiency`] = conceptProficiency[pathKey] ?? DEFAULT_ELO;
  }
  for (const [key, agg] of Object.entries(problemTypeAgg)) {
    const pathKey = sanitizeKey(key);
    updates[`problem_type_stats.${pathKey}.correct`] = increment(agg.correct);
    updates[`problem_type_stats.${pathKey}.total`] = increment(agg.total);
    updates[`problem_type_stats.${pathKey}.misconception_count`] = increment(agg.confused);
    updates[`problem_type_stats.${pathKey}.proficiency`] = problemTypeProficiency[pathKey] ?? DEFAULT_ELO;
  }
  for (const [key, agg] of Object.entries(subjectAgg)) {
    const pathKey = sanitizeKey(key);
    updates[`subject_stats.${pathKey}.correct`] = increment(agg.correct);
    updates[`subject_stats.${pathKey}.total`] = increment(agg.total);
    updates[`subject_stats.${pathKey}.misconception_count`] = increment(agg.confused);
    updates[`subject_stats.${pathKey}.proficiency`] = subjectProficiency[pathKey] ?? DEFAULT_ELO;
  }
  for (const [key, agg] of Object.entries(subCoreIdAgg)) {
    const pathKey = sanitizeKey(key);
    updates[`sub_core_id_stats.${pathKey}.correct`] = increment(agg.correct);
    updates[`sub_core_id_stats.${pathKey}.total`] = increment(agg.total);
    updates[`sub_core_id_stats.${pathKey}.misconception_count`] = increment(agg.confused);
    updates[`sub_core_id_stats.${pathKey}.proficiency`] = subCoreIdProficiency[pathKey] ?? DEFAULT_ELO;
  }
  for (const [tagKey, agg] of Object.entries(tagAgg)) {
    updates[`tag_stats.${tagKey}.correct`] = increment(agg.correct);
    updates[`tag_stats.${tagKey}.total`] = increment(agg.total);
    updates[`tag_stats.${tagKey}.misconception_count`] = increment(agg.confused);
  }
  const QIDS_LIST_MAX = 100;
  const existingConfused = (statsData.confused_qids as string[] | undefined) ?? [];
  updates.confused_qids = [...existingConfused, ...confusedQids].slice(-QIDS_LIST_MAX);
  const existingDontknow = (statsData.dontknow_qids as string[] | undefined) ?? [];
  updates.dontknow_qids = [...existingDontknow, ...dontknowQids].slice(-QIDS_LIST_MAX);

  if (Object.keys(updates).length > 0) {
    const MAX_UPDATES_PER_WRITE = 500;
    const entries = Object.entries(updates);
    let statsDocCreated = statsSnap.exists();
    for (let i = 0; i < entries.length; i += MAX_UPDATES_PER_WRITE) {
      const chunk = Object.fromEntries(entries.slice(i, i + MAX_UPDATES_PER_WRITE));
      try {
        await updateDoc(statsRef, chunk);
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code;
        const isNotFound = code === 'not-found' || code === 'firestore/not-found';
        if (isNotFound && !statsDocCreated) {
          await setDoc(statsRef, {});
          statsDocCreated = true;
          await updateDoc(statsRef, chunk);
        } else {
          throw err;
        }
      }
    }
  }

  // ---- 문제 품질 집계 (qualityService 분석용) ----
  for (const a of answersWithFlags) {
    const ref = doc(db, 'problem_attempt_stats', `${certCode}_${a.qid}`);
    await setDoc(
      ref,
      {
        totalAttempts: increment(1),
        dontKnowCount: increment(a.isDontKnow ? 1 : 0),
        confusedCount: increment(a.isConfused ? 1 : 0),
        luckedCount: increment(a.isLucked ? 1 : 0),
      },
      { merge: true }
    );
  }

  // ---- Elo (베타: 진단 round 시 prepLevel 기반 재조정, 최초 1회만) ----
  if (useBetaCertifications && isDiagnosticRoundId && prepLevel) {
    if (hasPrevDiagnosticSubmission) {
      await updateEloRating(uid, certId, sessionHistory);
    } else {
      await updateEloAfterDiagnostic(uid, certId, sessionHistory, prepLevel);
    }
  } else {
    await updateEloRating(uid, certId, sessionHistory);
  }

  return { examId, subject_scores, is_passed };
}

/** (베타 로컬) 진단 회차 최초 제출 시에만 Elo 보정. 보정폭 ±300 제한 */
const EXPECTED_SCORE_PERCENT: Record<'beginner' | 'intermediate' | 'advanced', number> = {
  beginner: 40,
  intermediate: 60,
  advanced: 75,
};
const INITIAL_ELO_BY_PREP: Record<'beginner' | 'intermediate' | 'advanced', number> = {
  beginner: 1000,
  intermediate: 1300,
  advanced: 1600,
};
const DIAGNOSTIC_ELO_DELTA_CAP = 300;

async function updateEloAfterDiagnostic(
  uid: string,
  certId: string,
  sessionHistory: QuizAnswerRecord[],
  prepLevel: 'beginner' | 'intermediate' | 'advanced'
): Promise<void> {
  const total = sessionHistory.length;
  if (total === 0) return;
  const correctCount = sessionHistory.filter((r) => r.isCorrect).length;
  const scorePercent = (correctCount / total) * 100;
  const expected = EXPECTED_SCORE_PERCENT[prepLevel];
  const initialElo = INITIAL_ELO_BY_PREP[prepLevel];
  const rawDelta = (scorePercent - expected) * 10;
  const cappedDelta = Math.max(-DIAGNOSTIC_ELO_DELTA_CAP, Math.min(DIAGNOSTIC_ELO_DELTA_CAP, rawDelta));
  const newElo = Math.round(initialElo + cappedDelta);
  const clampedElo = Math.max(100, Math.min(2500, newElo));
  const userRef = doc(db, 'users', uid);
  const userSnap = await getDoc(userRef);
  const eloByCert = (userSnap.data()?.elo_rating_by_cert as Record<string, number>) ?? {};
  await setDoc(
    userRef,
    { elo_rating_by_cert: { ...eloByCert, [certId]: clampedElo } },
    { merge: true }
  );
}

/**
 * Elo 레이팅 업데이트
 */
async function updateEloRating(
  uid: string,
  certId: string,
  sessionHistory: QuizAnswerRecord[]
): Promise<void> {
  const userRef = doc(db, 'users', uid);
  const userSnap = await getDoc(userRef);
  const userData = userSnap.data() ?? {};
  const eloByCert = (userData.elo_rating_by_cert as Record<string, number>) ?? {};
  const oldElo = eloByCert[certId] ?? DEFAULT_ELO;

  const correctCount = sessionHistory.filter((r) => r.isCorrect).length;
  const total = sessionHistory.length;
  if (total === 0) return;

  const actual = correctCount / total;
  const expected = 0.5;
  const newElo = Math.round(oldElo + K_FACTOR * (actual - expected));
  const clampedElo = Math.max(100, Math.min(2500, newElo));

  await setDoc(
    userRef,
    { elo_rating_by_cert: { ...eloByCert, [certId]: clampedElo } },
    { merge: true }
  );
}

/** Recharts 레이더용 */
export interface RadarDataItem {
  subject: string;
  A: number;
  fullMark: number;
}

/**
 * users/{uid}/stats/{certCode} 의 problem_type_stats에서 유형별 정답률을 레이더 차트용으로 반환.
 */
export async function fetchRadarData(
  uid: string,
  certId: string
): Promise<RadarDataItem[]> {
  const certCode = certIdToCode(certId);
  if (!certCode) return [];

  const statsRef = doc(db, 'users', uid, 'stats', certCode);
  const snap = await getDoc(statsRef);
  if (!snap.exists()) return [];

  const data = snap.data();
  const problemTypeStats = (data?.problem_type_stats ?? {}) as Record<string, StatEntry>;
  if (typeof problemTypeStats !== 'object') return [];

  return Object.entries(problemTypeStats).map(([subject, stat]) => {
    const prof = stat?.proficiency;
    const A =
      prof != null && Number.isFinite(prof)
        ? eloToPercent(prof)
        : (() => {
            const total = stat?.total ?? 0;
            const correct = stat?.correct ?? 0;
            return total > 0 ? Math.round((correct / total) * 100) : 0;
          })();
    return {
      subject,
      A: Math.min(100, Math.max(0, A)),
      fullMark: 100,
    };
  });
}

/**
 * users/{uid}/stats/{certCode} 의 subject_stats에서 과목별 정답률을 레이더/과목 통계용으로 반환.
 * certification_info.subjects 로 과목 번호 → 이름 매핑.
 */
export async function fetchSubjectStatsRadar(
  uid: string,
  certId: string,
  certInfo: CertificationInfo | null
): Promise<RadarDataItem[]> {
  const certCode = certIdToCode(certId);
  if (!certCode) return [];

  const statsRef = doc(db, 'users', uid, 'stats', certCode);
  const snap = await getDoc(statsRef);
  if (!snap.exists()) return [];

  const data = snap.data();
  const subjectStats = (data?.subject_stats ?? {}) as Record<string, StatEntry>;
  if (typeof subjectStats !== 'object') return [];

  const statToA = (ent: StatEntry | undefined): number => {
    if (!ent) return 0;
    const prof = ent.proficiency;
    if (prof != null && Number.isFinite(prof)) return eloToPercent(prof);
    const total = ent?.total ?? 0;
    const correct = ent?.correct ?? 0;
    return total > 0 ? Math.round((correct / total) * 100) : 0;
  };

  if (!certInfo?.subjects?.length) {
    return Object.entries(subjectStats).map(([key, ent]) => ({
      subject: `과목 ${key}`,
      A: Math.min(100, Math.max(0, statToA(ent))),
      fullMark: 100,
    }));
  }

  return certInfo.subjects.map((subj) => {
    const key = String(subj.subject_number);
    const ent = subjectStats[key];
    return {
      subject: subj.name,
      A: Math.min(100, Math.max(0, statToA(ent))),
      fullMark: 100,
    };
  });
}
