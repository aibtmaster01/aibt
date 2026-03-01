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

import { doc, getDoc, setDoc, updateDoc, Timestamp, increment } from 'firebase/firestore';
import { db } from '../firebase';
import { Question } from '../types';
import type { Certification, CertificationInfo, ExamResultSubjectScores } from '../types';
import { CERTIFICATIONS } from '../constants';

/** 자격증 표시 이름: certification_info.exam_name 우선, 없으면 constants cert.name */
export function getCertDisplayName(cert: Certification | null | undefined, certInfo: CertificationInfo | null | undefined): string {
  if (!cert) return '';
  return (certInfo?.exam_name ?? cert.name) || '';
}

const K_FACTOR = 32;
const DEFAULT_ELO = 1200;
/** Elo 기반 proficiency 계산 시 문제 난이도 (고정) */
const PROBLEM_DIFFICULTY_ELO = 1200;
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

/** Expected score: 1 / (1 + 10^((problemElo - userProficiency) / 400)) */
function expectedScore(userProficiency: number, problemElo: number = PROBLEM_DIFFICULTY_ELO): number {
  return 1 / (1 + Math.pow(10, (problemElo - userProficiency) / 400));
}

/**
 * Elo 스타일 proficiency 갱신: New = Old + K * (Outcome - Expected), Outcome 0 or 1
 * Lucky-Guess 보정: 맞춤(outcome=1)이면서 헷갈림(isConfused=true) 체크 시 "운으로 맞춘 것"으로 간주,
 * Elo 상승 폭에 0.2(20%)만 반영
 */
function nextProficiency(oldProficiency: number, outcome: number, isConfused?: boolean): number {
  const expected = expectedScore(oldProficiency);
  let delta = outcome - expected;
  if (outcome === 1 && isConfused === true) {
    delta *= 0.2;
  }
  const newP = oldProficiency + PROFICIENCY_K_FACTOR * delta;
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

/** 퀴즈 답안 기록 (Result/Quiz 호출부와 호환: isConfused 선택) */
export interface QuizAnswerRecord {
  qid: string;
  selected: number;
  isCorrect: boolean;
  isConfused?: boolean;
  /** 문항 풀이 소요 시간(초). estimated_time_sec의 절반 미만이면 찍은 것으로 간주해 proficiency 보정 */
  elapsedSec?: number;
}

/** exam_results 문서에 저장할 옵션 */
export interface SubmitQuizResultOptions {
  examId?: string;
  roundId?: string;
  /** 집중학습(과목/유형/개념) 완료 시 나의 학습 기록 표시용 라벨 (예: "과목 강화 학습 - 3과목 강화") */
  roundLabel?: string;
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
  /** '헷갈려요' 체크한 문제 ID 배열 */
  confused_qids?: string[];
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

/**
 * 예측 합격률 계산 (자격증 공통)
 * - 기본 점수: 과목별 점수의 평균 (0~100)
 * - 안정성 계수: 어떤 과목이라도 과락(minSubjectScore 미만, 기본 40점)이 있으면 0.8, 없으면 1.0
 * - 최종: Math.round(기본 점수 * 안정성 계수), 0~100 클램프
 * - 마이페이지/목록에 보이는 값: exam_results 중 해당 자격증 최신 시험의 predicted_pass_rate (statsService.fetchUserTrendData)
 * - 큐레이션 모의고사(6회+) 언락 조건: D-Day 3일 이내 AND 예측 합격률 70% 이상
 */
function computePredictedPassRate(
  subject_scores: ExamResultSubjectScores,
  minSubjectScore: number = MIN_SUBJECT_SCORE_FOR_STABILITY
): number {
  const scores = Object.values(subject_scores);
  if (scores.length === 0) return 0;
  const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
  // 과락 마진 패널티: 과락선 미만 과목이 있으면 (minScore - 과목점수) / minScore × 20점 감점
  const minScore = Math.min(...scores);
  let penalty = 0;
  if (minScore < minSubjectScore) {
    penalty = ((minSubjectScore - minScore) / minSubjectScore) * 20;
  }
  return Math.max(0, Math.min(100, Math.round(avgScore - penalty)));
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

  // ---- 과목별 점수 계산 (subject_number 기준) ----
  const subjectCorrectTotal: Record<string, { correct: number; total: number }> = {};
  for (const rec of sessionHistory) {
    const q = qMap.get(rec.qid);
    const subjKey = q?.subject_number != null ? String(q.subject_number) : '0';
    if (!subjectCorrectTotal[subjKey]) subjectCorrectTotal[subjKey] = { correct: 0, total: 0 };
    subjectCorrectTotal[subjKey].total += 1;
    if (rec.isCorrect) subjectCorrectTotal[subjKey].correct += 1;
  }

  const subject_scores: ExamResultSubjectScores = {};
  let hasSubjectScoring = false;
  if (certInfo?.subjects?.length) {
    const scorePerQ =
      certInfo.subjects[0]?.score_per_question ?? DEFAULT_SCORE_PER_QUESTION;
    for (const subj of certInfo.subjects) {
      const key = String(subj.subject_number);
      const ct = subjectCorrectTotal[key] ?? { correct: 0, total: 0 };
      const totalPossible = (ct.total || 0) * scorePerQ;
      const score = totalPossible > 0
        ? Math.round((ct.correct * scorePerQ / totalPossible) * 100)
        : 0;
      subject_scores[key] = Math.min(100, Math.max(0, score));
      if (ct.total > 0) hasSubjectScoring = true;
    }
  } else {
    const total = sessionHistory.length;
    const correct = sessionHistory.filter((r) => r.isCorrect).length;
    if (total > 0) {
      subject_scores['0'] = Math.round((correct / total) * 100);
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

  // ---- 예측 합격률 ----
  const predicted_pass_rate = computePredictedPassRate(subject_scores, minSubjectScore);

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
    answers: sessionHistory.map((r) => ({
      qid: r.qid,
      isCorrect: r.isCorrect,
      isConfused: r.isConfused === true,
      ...(r.elapsedSec != null && { elapsedSec: r.elapsedSec }),
    })),
    submittedAt: Timestamp.now(),
  };
  try {
    await setDoc(examRef, examData, { merge: true });
    // 저장 검증: totalQuestions 필드가 제대로 저장되었는지 확인
    const verifySnap = await getDoc(examRef);
    if (!verifySnap.exists()) {
      throw new Error(`exam_results 문서 저장 실패: ${examId}`);
    }
    const savedData = verifySnap.data();
  } catch (err) {
    console.error('[gradingService] exam_results 저장 실패:', {
      examId,
      uid,
      certId,
      questionCount: sessionHistory.length,
      error: err,
    });
    throw err; // 상위로 에러 전파하여 App.tsx에서 catch 가능하도록
  }

  // ---- 3차원 통계 + 태그 + 세부개념(sub_core_id) 집계 ----
  const conceptAgg: Record<string, { correct: number; total: number; confused: number }> = {};
  const problemTypeAgg: Record<string, { correct: number; total: number; confused: number }> = {};
  const subjectAgg: Record<string, { correct: number; total: number; confused: number }> = {};
  const subCoreIdAgg: Record<string, { correct: number; total: number; confused: number }> = {};
  const tagAgg: Record<string, { correct: number; total: number; confused: number }> = {};
  const confusedQids: string[] = [];

  for (const rec of sessionHistory) {
    const q = qMap.get(rec.qid);
    if (!q) continue;

    const correct = rec.isCorrect ? 1 : 0;
    const total = 1;
    const confused = rec.isConfused === true ? 1 : 0;
    if (rec.isConfused === true && rec.qid) confusedQids.push(rec.qid);

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

  const statsRef = doc(db, 'users', uid, 'stats', certCode);
  const statsSnap = await getDoc(statsRef);
  const statsData = statsSnap.exists() ? (statsSnap.data() ?? {}) : {};

  const conceptStats = (statsData.core_concept_stats ?? (statsData as { hierarchy_stats?: Record<string, StatEntry> }).hierarchy_stats ?? {}) as Record<string, StatEntry & { misconception_count?: number }>;
  const problemTypeStats = (statsData.problem_type_stats ?? {}) as Record<string, StatEntry & { misconception_count?: number }>;
  const subjectStats = (statsData.subject_stats ?? {}) as Record<string, StatEntry & { misconception_count?: number }>;
  const subCoreIdStats = (statsData.sub_core_id_stats ?? {}) as Record<string, StatEntry & { misconception_count?: number }>;

  const getProficiency = (entry: unknown): number => {
    const e = entry as { proficiency?: number } | undefined;
    return e?.proficiency != null && Number.isFinite(e.proficiency) ? e.proficiency : DEFAULT_ELO;
  };

  const conceptProficiency: Record<string, number> = {};
  const problemTypeProficiency: Record<string, number> = {};
  const subjectProficiency: Record<string, number> = {};
  const subCoreIdProficiency: Record<string, number> = {};
  for (const [pathKey, entry] of Object.entries(conceptStats)) {
    conceptProficiency[pathKey] = getProficiency(entry);
  }
  for (const [pathKey, entry] of Object.entries(problemTypeStats)) {
    problemTypeProficiency[pathKey] = getProficiency(entry);
  }
  for (const [pathKey, entry] of Object.entries(subjectStats)) {
    subjectProficiency[pathKey] = getProficiency(entry);
  }
  for (const [pathKey, entry] of Object.entries(subCoreIdStats)) {
    subCoreIdProficiency[pathKey] = getProficiency(entry);
  }

  for (const rec of sessionHistory) {
    const q = qMap.get(rec.qid);
    if (!q) continue;
    const outcome = rec.isCorrect ? 1 : 0;
    const estimatedSec = (q as { estimated_time_sec?: number }).estimated_time_sec;
    const tooFast =
      rec.elapsedSec != null &&
      estimatedSec != null &&
      Number.isFinite(estimatedSec) &&
      rec.elapsedSec < estimatedSec / 2;
    const isConfused = rec.isConfused === true || tooFast;

    const subCoreKey = (q.sub_core_id ?? '').trim();
    if (subCoreKey) {
      const pathKey = sanitizeKey(subCoreKey);
      subCoreIdProficiency[pathKey] = nextProficiency(subCoreIdProficiency[pathKey] ?? DEFAULT_ELO, outcome, isConfused);
    }

    const cKey = sanitizeKey((q.core_concept ?? '').trim() || '기타');
    conceptProficiency[cKey] = nextProficiency(conceptProficiency[cKey] ?? DEFAULT_ELO, outcome, isConfused);

    for (const pt of Array.isArray(q.problem_types) ? q.problem_types : []) {
      if (!pt || typeof pt !== 'string') continue;
      const ptKey = sanitizeKey(String(pt).trim());
      if (!ptKey) continue;
      problemTypeProficiency[ptKey] = nextProficiency(problemTypeProficiency[ptKey] ?? DEFAULT_ELO, outcome, isConfused);
    }

    const subjKey = q.subject_number != null ? String(q.subject_number) : '0';
    const subjPathKey = sanitizeKey(subjKey);
    subjectProficiency[subjPathKey] = nextProficiency(subjectProficiency[subjPathKey] ?? DEFAULT_ELO, outcome, isConfused);
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
  /** 헷갈림 리스트: 기존 배열에 이번 세션 ID 추가 후 최근 100개만 유지 */
  const CONFUSED_QIDS_MAX = 100;
  const existingConfused = (statsData.confused_qids as string[] | undefined) ?? [];
  const mergedConfused = [...existingConfused, ...confusedQids].slice(-CONFUSED_QIDS_MAX);
  updates.confused_qids = mergedConfused;

  if (Object.keys(updates).length > 0) {
    if (!statsSnap.exists()) {
      await setDoc(statsRef, {});
    }
    const MAX_UPDATES_PER_WRITE = 500;
    const entries = Object.entries(updates);
    for (let i = 0; i < entries.length; i += MAX_UPDATES_PER_WRITE) {
      const chunk = Object.fromEntries(entries.slice(i, i + MAX_UPDATES_PER_WRITE));
      await updateDoc(statsRef, chunk);
    }
  }

  // ---- Elo ----
  await updateEloRating(uid, certId, sessionHistory);

  return { examId, subject_scores, is_passed };
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
