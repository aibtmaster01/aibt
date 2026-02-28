/**
 * aiRoundCurationService.ts
 * Round 4+ 맞춤형 큐레이션 엔진 (Diverse Adaptive 방식)
 *
 * 핵심 정책:
 * - 1~3회차: 고정 문제
 * - 4회차~: 시험일 무관, 모두 맞춤형 80문항 (과목1→2→3→4, 각 20문항)
 * - 슬라이딩 윈도우 제외: 현재 회차 기준 직전 3 맞춤형 회차 q_id 제외
 * - 맞춤형 4번째(round 7)부터 1~3회차 문항 재사용 허용
 * - 커버리지: 과목당 최대한 다양한 core_id 커버 (목표 17+/과목)
 * - sub_core_id 중복 절대 금지 (같은 회차 내)
 * - Score 우선순위: 약점(40%) + 트렌드(35%) + 난이도 적합(15%) + 취약 유형(10%)
 */

import { doc, getDoc, collection, query, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { Question, User } from '../types';
import { CERTIFICATIONS } from '../constants';
import { to1BasedAnswer, wrongFeedbackTo1Based } from '../utils/questionUtils';
import { getCertificationInfo } from './gradingService';
import { extractTopicUnit, type AiMockExamMode } from './examService';
import {
  getQuestionIndexFromCache,
  syncQuestionIndex,
  type QuestionIndexItem,
} from './db/localCacheDB';

/** 자격증별 question_pools 하위 풀 ID */
const QUESTION_POOL_ID_BY_CERT: Record<string, string> = {
  BIGDATA: 'contents_1681',
};

/** 맞춤형 과목당 문항 수 */
const QUESTIONS_PER_SUBJECT = 20;
/** 맞춤형 총 문항 수 */
const ADAPTIVE_TOTAL = 80;
/** 슬라이딩 윈도우: 직전 N 맞춤형 회차 q_id 제외 */
const EXCLUSION_WINDOW = 3;
/** 맞춤형 N번째부터 1~3회차 문항 재사용 허용 (맞춤형 4번째 = round 7) */
const REUSE_FIXED_FROM_ADAPTIVE_N = 4;

/** Score 가중치 */
const W_WEAKNESS = 0.40;
const W_TREND    = 0.35;
const W_DIFF     = 0.15;
const W_WEAKTYPE = 0.10;

/** 희소 sub_core_id(문항 수 N개 이하) 페널티 배수 */
const SCARCE_THRESHOLD = 3;
const SCARCE_PENALTY = 0.5;

/** stats.core_concept_stats / sub_core_id_stats 항목 */
interface StatEntryLike {
  proficiency?: number;
  correct?: number;
  total?: number;
  misconception_count?: number;
}

/** Firestore 문제 문서 규격 */
interface FirestoreQuestionDoc {
  q_id?: string;
  question_text?: string;
  options?: string[];
  answer?: number;
  answer_idx?: number;
  explanation?: string;
  ai_explanation?: string;
  wrong_feedback?: Record<string, string> | string[];
  image?: string;
  difficulty_level?: number;
  core_concept?: string;
  topic?: string;
  random_id?: number;
  tags?: string[];
  trend?: string | number | null;
  estimated_time_sec?: number;
  trap_score?: number;
  problem_types?: string[];
  subject_number?: number;
  round?: number;
  core_id?: string;
  sub_core_id?: string;
  table_data?: string | { headers: string[]; rows: string[][] } | null;
}

export type AiExamMode = 'REAL_EXAM_BALANCE' | 'WEAKNESS_ATTACK';

/** 오버레이 메시지용 분석 컨텍스트 */
export interface AiAnalysisContext {
  mode: AiExamMode;
  top1Unit: string | null;
  top1Proficiency?: number;
  top1Misconception?: number;
  avgProficiency: number;
  hasData: boolean;
  isDataScanty: boolean;
  isNewUser: boolean;
  daysLeft: number | null;
}

function certIdToCode(certId: string): string | null {
  return CERTIFICATIONS.find((c) => c.id === certId)?.code ?? null;
}

function isNewUser(user: User | null): boolean {
  if (!user?.createdAt) return false;
  return (Date.now() - new Date(user.createdAt).getTime()) / (1000 * 60 * 60) < 24;
}

function mapPoolDocToQuestion(docId: string, data: FirestoreQuestionDoc): Question {
  const baseExplanation = data.explanation ?? '';
  const aiExplanation = data.ai_explanation ?? '';
  const options = Array.isArray(data.options) ? data.options : [];
  // Firestore는 0-based 저장 → 1-based 변환
  const raw0Based = typeof data.answer_idx === 'number'
    ? data.answer_idx
    : typeof data.answer === 'number' ? data.answer : 0;
  const answer1Based = options.length > 0 && raw0Based >= 0 && raw0Based < options.length
    ? raw0Based + 1
    : 1;
  const coreConcept =
    (typeof data.core_concept === 'string' && data.core_concept.trim()) ||
    extractTopicUnit(data.topic) ||
    undefined;
  return {
    id: data.q_id ?? docId,
    content: data.question_text ?? '',
    options,
    answer: answer1Based,
    explanation: aiExplanation || baseExplanation,
    aiExplanation: data.ai_explanation,
    wrongFeedback: wrongFeedbackTo1Based(data.wrong_feedback),
    imageUrl: data.image,
    topic: data.topic,
    core_concept: coreConcept ?? undefined,
    tags: Array.isArray(data.tags) ? data.tags : [],
    trend: data.trend != null ? String(data.trend) : null,
    estimated_time_sec: typeof data.estimated_time_sec === 'number' ? data.estimated_time_sec : 0,
    trap_score: typeof data.trap_score === 'number' ? data.trap_score : 0,
    problem_types: data.problem_types,
    subject_number: typeof data.subject_number === 'number' ? data.subject_number : undefined,
    difficulty_level: typeof data.difficulty_level === 'number' ? data.difficulty_level : undefined,
    core_id: data.core_id,
    sub_core_id: typeof data.sub_core_id === 'string' ? data.sub_core_id : undefined,
    round: typeof data.round === 'number' ? data.round : undefined,
    tableData: data.table_data ?? undefined,
  };
}

function shuffleArray<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ─────────────────────────────────────────────
// Stats 조회
// ─────────────────────────────────────────────

async function fetchStatsForCert(uid: string, certCode: string): Promise<{
  core_concept_stats?: Record<string, StatEntryLike>;
  sub_core_id_stats?: Record<string, StatEntryLike>;
  tag_stats?: Record<string, StatEntryLike>;
  problem_type_stats?: Record<string, StatEntryLike>;
  subject_stats?: Record<string, StatEntryLike>;
  confused_qids?: string[];
}> {
  const ref = doc(db, 'users', uid, 'stats', certCode);
  const snap = await getDoc(ref);
  return snap.exists() ? (snap.data() as Record<string, unknown>) : {};
}

/** Elo proficiency → 0~100% (gradingService.eloToPercent와 동일 공식) */
function eloToPercent(proficiency: number): number {
  const p = Math.max(100, Math.min(2500, proficiency));
  const expected = 1 / (1 + Math.pow(10, (1200 - p) / 400));
  return Math.max(0, Math.min(100, Math.round(expected * 100)));
}

// ─────────────────────────────────────────────
// 이전 맞춤형 회차 q_id 수집 (슬라이딩 윈도우)
// ─────────────────────────────────────────────

/**
 * users/{uid}/user_rounds/{roundNum} 에서 이전 맞춤형 회차들의 q_id를 수집.
 * - 직전 EXCLUSION_WINDOW 맞춤형 회차 q_id 제외 (재사용 금지)
 * - 맞춤형 1~3번(round 4,5,6)은 1~3회차 문항을 포함하지 않으므로 1~3회차는 별도 처리
 */
async function collectExcludedQIds(
  uid: string,
  currentRound: number,
): Promise<{ excludedAdaptive: Set<string>; usedFixed123: Set<string> }> {
  // 맞춤형 회차 번호들: round 4 이상
  const adaptiveRounds: number[] = [];
  for (let r = 4; r < currentRound; r++) {
    adaptiveRounds.push(r);
  }
  if (adaptiveRounds.length === 0) {
    return { excludedAdaptive: new Set(), usedFixed123: new Set() };
  }

  // 슬라이딩 윈도우: 직전 EXCLUSION_WINDOW개만 제외
  const windowRounds = adaptiveRounds.slice(-EXCLUSION_WINDOW);

  const promises = windowRounds.map((r) =>
    getDoc(doc(db, 'users', uid, 'user_rounds', String(r)))
  );
  const snaps = await Promise.all(promises);

  const excludedAdaptive = new Set<string>();
  for (const snap of snaps) {
    if (!snap.exists()) continue;
    const data = snap.data() as { questionIds?: string[] };
    (data.questionIds ?? []).forEach((id) => excludedAdaptive.add(id));
  }

  // 1~3회차 문항: 맞춤형 4번째(round 7)부터 재사용 허용
  // → 현재 회차가 맞춤형 N번째인지 계산 (round 4 = 맞춤형 1번)
  const adaptiveN = currentRound - 3; // round 4→1, round 5→2, ...
  let usedFixed123 = new Set<string>();
  if (adaptiveN < REUSE_FIXED_FROM_ADAPTIVE_N) {
    // 아직 재사용 불가: 1~3회차 q_id 모두 수집해서 제외
    const fixedPromises = [1, 2, 3].map((r) =>
      getDoc(doc(db, 'users', uid, 'user_rounds', String(r)))
    );
    const fixedSnaps = await Promise.all(fixedPromises);
    for (const snap of fixedSnaps) {
      if (!snap.exists()) continue;
      const data = snap.data() as { questionIds?: string[] };
      (data.questionIds ?? []).forEach((id) => usedFixed123.add(id));
    }
  }

  return { excludedAdaptive, usedFixed123 };
}

// ─────────────────────────────────────────────
// Score 계산
// ─────────────────────────────────────────────

interface ScoreContext {
  subCoreStats: Record<string, StatEntryLike>;
  weakTypeSet: Set<string>;
  userEloPercent: number; // 0~100, 사용자 평균 이해도
  subCoreCounts: Map<string, number>; // sub_core_id → 인덱스 내 총 문항 수
}

function calcScore(it: QuestionIndexItem, ctx: ScoreContext): number {
  const subCoreId = it.metadata?.sub_core_id ?? '';
  const prof = subCoreId ? (ctx.subCoreStats[subCoreId]?.proficiency ?? 1200) : 1200;
  const profPercent = eloToPercent(prof);

  // 1. WeaknessBonus: proficiency 낮을수록 높음 (0~1)
  const weaknessBonus = Math.max(0, (100 - profPercent) / 100);

  // 2. TrendScore: stats.trend 0~1.0 그대로
  const trend = typeof it.stats?.trend === 'number' ? it.stats.trend : 0;

  // 3. DifficultyFit: 사용자 수준에 맞는 난이도
  const diff = typeof it.stats?.difficulty === 'number' ? it.stats.difficulty : 0.5;
  const targetDiff = Math.max(0.2, ctx.userEloPercent / 100 * 0.8); // 수준이 낮을수록 낮은 난이도 선호
  const diffFit = Math.max(0, 1 - Math.abs(diff - targetDiff) / 0.5);

  // 4. WeakTypeBonus
  const pt = it.metadata?.problem_type ?? '';
  const weakTypeBonus = ctx.weakTypeSet.has(pt) ? 1 : 0;

  // 희소 sub_core_id 패널티
  const count = subCoreId ? (ctx.subCoreCounts.get(subCoreId) ?? 10) : 10;
  const scarce = count <= SCARCE_THRESHOLD ? SCARCE_PENALTY : 1.0;

  const raw = W_WEAKNESS * weaknessBonus + W_TREND * trend + W_DIFF * diffFit + W_WEAKTYPE * weakTypeBonus;
  // 약간의 랜덤 소음 추가 (±0.05) → 매번 다른 문항 선택
  const noise = (Math.random() - 0.5) * 0.10;
  return (raw + noise) * scarce;
}

// ─────────────────────────────────────────────
// 과목별 다양-적응 선발
// ─────────────────────────────────────────────

/**
 * 한 과목에서 count개 선발:
 * 1단계: 각 core_id 최고 Score 1개 → 커버리지 확보
 * 2단계: 남은 슬롯 → sub_core_id 미중복 + Score 상위
 */
function selectForSubject(
  candidates: QuestionIndexItem[],
  count: number,
  ctx: ScoreContext,
  globalUsedSubCoreIds: Set<string>,
): string[] {
  if (candidates.length === 0) return [];

  const selected: string[] = [];
  const localUsed = new Set<string>(globalUsedSubCoreIds);

  // core_id별 그룹화
  const byCoreId = new Map<number, QuestionIndexItem[]>();
  for (const it of candidates) {
    const cId = it.metadata?.core_id ?? 0;
    if (!byCoreId.has(cId)) byCoreId.set(cId, []);
    byCoreId.get(cId)!.push(it);
  }

  // 1단계: 각 core_id에서 sub_core_id 미중복 & 최고 Score 1개
  const coreEntries = [...byCoreId.entries()]
    .map(([cId, items]) => {
      const eligible = items.filter((it) => !localUsed.has(it.metadata?.sub_core_id ?? ''));
      if (eligible.length === 0) return null;
      const best = eligible.reduce((a, b) => calcScore(a, ctx) >= calcScore(b, ctx) ? a : b);
      return { cId, best };
    })
    .filter((x): x is { cId: number; best: QuestionIndexItem } => x !== null)
    .sort((a, b) => calcScore(b.best, ctx) - calcScore(a.best, ctx));

  for (const { best } of coreEntries) {
    if (selected.length >= count) break;
    const sc = best.metadata?.sub_core_id ?? '';
    if (localUsed.has(sc)) continue;
    localUsed.add(sc);
    selected.push(best.q_id);
  }

  // 2단계: 남은 슬롯 채우기 (sub_core_id 미중복, Score 상위)
  const rest = candidates
    .filter((it) => !selected.includes(it.q_id) && !localUsed.has(it.metadata?.sub_core_id ?? ''))
    .map((it) => ({ it, score: calcScore(it, ctx) }))
    .sort((a, b) => b.score - a.score);

  for (const { it } of rest) {
    if (selected.length >= count) break;
    const sc = it.metadata?.sub_core_id ?? '';
    if (localUsed.has(sc)) continue;
    localUsed.add(sc);
    selected.push(it.q_id);
  }

  // 여전히 부족하면 sub_core_id 제약 완화해서 채움
  if (selected.length < count) {
    const filled = candidates
      .filter((it) => !selected.includes(it.q_id))
      .sort((a, b) => calcScore(b, ctx) - calcScore(a, ctx));
    for (const it of filled) {
      if (selected.length >= count) break;
      selected.push(it.q_id);
    }
  }

  // globalUsedSubCoreIds에 반영
  for (const qid of selected) {
    const it = candidates.find((c) => c.q_id === qid);
    if (it?.metadata?.sub_core_id) globalUsedSubCoreIds.add(it.metadata.sub_core_id);
  }

  return selected;
}

// ─────────────────────────────────────────────
// 메인 선발 함수
// ─────────────────────────────────────────────

async function selectDiverseAdaptiveQIds(
  certCode: string,
  uid: string,
  currentRound: number,
): Promise<string[]> {
  // 인덱스 로드
  let items = await getQuestionIndexFromCache(certCode);
  if (!items || items.length === 0) {
    await syncQuestionIndex(certCode);
    items = await getQuestionIndexFromCache(certCode);
  }
  if (!items || items.length === 0) return [];

  // 제외 q_id 수집
  const { excludedAdaptive, usedFixed123 } = await collectExcludedQIds(uid, currentRound);
  const allExcluded = new Set([...excludedAdaptive, ...usedFixed123]);

  // 사용 가능 풀 구성 (round 99 기본, 맞춤형 4번째부터 1~3 포함)
  const adaptiveN = currentRound - 3;
  const pool = items.filter((it) => {
    if (allExcluded.has(it.q_id)) return false;
    const r = it.metadata?.round ?? 99;
    if (r <= 3) {
      // 1~3회차 문항: 맞춤형 4번째부터 허용
      return adaptiveN >= REUSE_FIXED_FROM_ADAPTIVE_N;
    }
    return r === 99; // round 99만 맞춤형 풀로 사용
  });

  // Stats 조회
  const stats = await fetchStatsForCert(uid, certCode);
  const subCoreStats = (stats.sub_core_id_stats ?? {}) as Record<string, StatEntryLike>;
  const problemTypeStats = (stats.problem_type_stats ?? {}) as Record<string, StatEntryLike>;
  const subjectStats = (stats.subject_stats ?? {}) as Record<string, StatEntryLike>;

  // 사용자 평균 Elo%
  const subjectProfs = Object.values(subjectStats)
    .map((e) => e?.proficiency ?? 1200)
    .filter((p) => p > 0);
  const avgProf = subjectProfs.length > 0
    ? subjectProfs.reduce((a, b) => a + b, 0) / subjectProfs.length
    : 1200;
  const userEloPercent = eloToPercent(avgProf);

  // 약한 유형 Set (proficiency 하위 3개)
  const weakTypeSet = new Set<string>(
    Object.entries(problemTypeStats)
      .filter(([, v]) => (v.total ?? 0) > 0)
      .sort((a, b) => (a[1].proficiency ?? 1200) - (b[1].proficiency ?? 1200))
      .slice(0, 3)
      .map(([k]) => k.trim())
  );

  // sub_core_id별 전체 문항 수 (희소도 계산용)
  const subCoreCounts = new Map<string, number>();
  for (const it of items) {
    const sc = it.metadata?.sub_core_id ?? '';
    if (sc) subCoreCounts.set(sc, (subCoreCounts.get(sc) ?? 0) + 1);
  }

  const ctx: ScoreContext = { subCoreStats, weakTypeSet, userEloPercent, subCoreCounts };

  // 과목별 선발 (1→2→3→4 순서)
  const globalUsedSubCoreIds = new Set<string>();
  const allSelected: string[] = [];

  for (const subjectNum of [1, 2, 3, 4]) {
    const subPool = pool.filter((it) => (it.metadata?.subject ?? 0) === subjectNum);
    const picked = selectForSubject(subPool, QUESTIONS_PER_SUBJECT, ctx, globalUsedSubCoreIds);
    allSelected.push(...picked);
  }

  return allSelected;
}

// ─────────────────────────────────────────────
// Firestore getDoc 병렬 조회
// ─────────────────────────────────────────────

async function fetchQuestionsByIds(certCode: string, qIds: string[]): Promise<Question[]> {
  if (qIds.length === 0) return [];
  const poolId = QUESTION_POOL_ID_BY_CERT[certCode];
  if (!poolId) return [];

  const promises = qIds.map((qId) => {
    const ref = doc(db, 'certifications', certCode, 'question_pools', poolId, 'questions', qId);
    return getDoc(ref);
  });
  const snaps = await Promise.all(promises);
  const orderMap = new Map<string, Question>();
  snaps.forEach((snap, i) => {
    if (snap.exists()) {
      orderMap.set(qIds[i], mapPoolDocToQuestion(qIds[i], snap.data() as FirestoreQuestionDoc));
    }
  });
  return qIds.map((id) => orderMap.get(id)).filter((q): q is Question => !!q);
}

// ─────────────────────────────────────────────
// 공개 API
// ─────────────────────────────────────────────

/**
 * Round 4+ 맞춤형 문제 Fetch (항상 80문항)
 * examService.getQuestionsForRound에서 round >= 4 시 호출
 */
export async function fetchAdaptiveQuestions(
  uid: string,
  certId: string,
  _user: User | null,
  round: number,
  _curationMode?: AiMockExamMode
): Promise<Question[]> {
  const certCode = certIdToCode(certId);
  if (!certCode) throw new Error('해당 자격증을 찾을 수 없습니다.');

  const ids = await selectDiverseAdaptiveQIds(certCode, uid, round);
  if (ids.length === 0) return [];
  return fetchQuestionsByIds(certCode, ids);
}

/**
 * 기존 generateAdaptiveExam 호환 (examService에서 직접 호출되는 경우)
 */
export async function generateAdaptiveExam(
  uid: string,
  certCode: string,
  _certId: string,
  _targetExamDate: string | null,
  round: number = 4
): Promise<Question[]> {
  const ids = await selectDiverseAdaptiveQIds(certCode, uid, round);
  if (ids.length === 0) return [];
  return fetchQuestionsByIds(certCode, ids);
}

/**
 * generateIndexBasedExam 호환 (기존 코드에서 직접 호출되는 경우)
 */
export async function generateIndexBasedExam(
  uid: string,
  certCode: string,
  _totalCount: number,
  _mode?: AiMockExamMode,
  round: number = 4
): Promise<Question[]> {
  const ids = await selectDiverseAdaptiveQIds(certCode, uid, round);
  if (ids.length === 0) return [];
  return fetchQuestionsByIds(certCode, ids);
}

/**
 * tag_stats에서 정답률이 낮은 상위 태그명 반환 (오버레이 안내 문구용)
 */
export async function getTopWeakTags(uid: string, certId: string, limit: number = 3): Promise<string[]> {
  const certCode = certIdToCode(certId);
  if (!certCode) return [];
  const stats = await fetchStatsForCert(uid, certCode);
  const tagStats = stats.tag_stats ?? {};
  return Object.entries(tagStats)
    .filter(([, v]) => (v.total ?? 0) > 0)
    .sort((a, b) => (a[1].correct ?? 0) / (a[1].total ?? 1) - (b[1].correct ?? 0) / (b[1].total ?? 1))
    .slice(0, limit)
    .map(([tagKey]) => tagKey);
}

/**
 * 오버레이 메시지용 분석 컨텍스트 생성
 */
export async function getAnalysisContext(
  uid: string,
  certId: string,
  user: User | null
): Promise<AiAnalysisContext> {
  const certCode = certIdToCode(certId);
  if (!certCode) {
    return {
      mode: 'WEAKNESS_ATTACK',
      top1Unit: null,
      avgProficiency: 0,
      hasData: false,
      isDataScanty: true,
      isNewUser: false,
      daysLeft: null,
    };
  }

  const isNew = isNewUser(user);
  const statsData = await fetchStatsForCert(uid, certCode);
  const conceptStats = (statsData.core_concept_stats ?? (statsData as { hierarchy_stats?: Record<string, StatEntryLike> }).hierarchy_stats ?? {}) as Record<string, StatEntryLike>;
  const subCoreStats = (statsData.sub_core_id_stats ?? {}) as Record<string, StatEntryLike>;

  const hasData = Object.keys(conceptStats).length > 0 || Object.keys(subCoreStats).length > 0;

  // 가장 약한 개념 찾기 (proficiency 최저)
  let top1Unit: string | null = null;
  let top1Proficiency: number | undefined;
  let top1Misconception: number | undefined;

  const allStats = Object.keys(subCoreStats).length > 0 ? subCoreStats : conceptStats;
  const sorted = Object.entries(allStats)
    .filter(([, v]) => (v.total ?? 0) > 0)
    .sort((a, b) => (a[1].proficiency ?? 1200) - (b[1].proficiency ?? 1200));
  if (sorted.length > 0) {
    top1Unit = sorted[0][0];
    top1Proficiency = sorted[0][1].proficiency;
    top1Misconception = sorted[0][1].misconception_count;
  }

  let avgProficiency = 0;
  if (hasData) {
    const probs = Object.values(allStats).map((s) => s.proficiency ?? 0).filter((p) => p > 0);
    avgProficiency = probs.length > 0 ? probs.reduce((a, b) => a + b, 0) / probs.length : 0;
  }

  return {
    mode: 'WEAKNESS_ATTACK',
    top1Unit,
    top1Proficiency,
    top1Misconception,
    avgProficiency,
    hasData,
    isDataScanty: !hasData,
    isNewUser: isNew,
    daysLeft: null,
  };
}
