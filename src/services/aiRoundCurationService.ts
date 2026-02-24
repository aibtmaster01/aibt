/**
 * aiRoundCurationService.ts
 * Round 4 이상 맞춤형 큐레이션 엔진
 * - Smart Recycling & Wide Pool: 전체 question_pools 사용
 * - Exclude: 이전에 맞춘 문제 영구 제외
 * - Zone A: 틀린 문제 (복습 우선), Zone B: 안 푼 문제 (도전)
 * - certification_info.subjects 기준 과목별 question_count 배분
 */

import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
} from 'firebase/firestore';
import { db } from '../firebase';
import { Question, User, type ExamAnswerEntry } from '../types';
import { CERTIFICATIONS, EXAM_ROUNDS } from '../constants';
import { to1BasedAnswer, wrongFeedbackTo1Based } from '../utils/questionUtils';
import { getCertificationInfo } from './gradingService';
import {
  generateAiMockExam,
  generateAdaptiveExamPlan,
  extractTopicUnit,
  fetchQuestionsFromPools,
  type AdaptiveExamPlan,
  type AiMockExamMode,
} from './examService';
import {
  getQuestionMetadataByCert,
  hasQuestionMetadataForCert,
  putQuestionMetadataBulk,
  type QuestionMetadataRecord,
} from './db/localCacheDB';

const ROUND4_TOTAL = 20;
const ROUND5_TOTAL = 80;
const DEFAULT_ELO = 1200;
const RANDOM_ID_MAX = 1_000_000;

/** stats.hierarchy_stats / stats.tag_stats 항목 (Phase 2: stats 문서 사용) */
interface StatEntryLike {
  proficiency?: number;
  correct?: number;
  total?: number;
  misconception_count?: number;
}

/** Firestore 문제 문서 규격 (examService와 동일하게 hierarchy/tags/trend 등 반영) */
interface FirestoreQuestionDoc {
  q_id?: string;
  question_text?: string;
  options?: string[];
  answer?: number;
  explanation?: string;
  ai_explanation?: string;
  wrong_feedback?: Record<string, string> | string[];
  image?: string;
  difficulty_level?: number;
  hierarchy?: string;
  topic?: string;
  random_id?: number;
  tags?: string[];
  trend?: string | null;
  estimated_time_sec?: number;
  trap_score?: number;
  problem_types?: string[];
  subject_number?: number;
  round?: number;
  core_id?: string;
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

function codeToCertId(certCode: string): string | null {
  return CERTIFICATIONS.find((c) => c.code === certCode)?.id ?? null;
}

/** 시험일: passesByCert(메인) 우선, 레거시 targetExamDateByCert 폴백 */
function getTargetExamDate(user: User | null, certId: string): string | null {
  const pass = user?.passesByCert?.[certId];
  if (pass) return pass.examDate;
  return user?.targetExamDateByCert?.[certId] ?? null;
}

function getDaysLeft(targetDate: string | null): number | null {
  if (!targetDate) return null;
  return Math.floor(
    (new Date(targetDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  );
}

function isNewUser(user: User | null): boolean {
  if (!user?.createdAt) return false;
  const created = new Date(user.createdAt).getTime();
  return (Date.now() - created) / (1000 * 60 * 60) < 24;
}

function mapPoolDocToQuestion(docId: string, data: FirestoreQuestionDoc): Question {
  const baseExplanation = data.explanation ?? '';
  const aiExplanation = data.ai_explanation ?? '';
  const options = Array.isArray(data.options) ? data.options : [];
  const rawAnswer = typeof data.answer === 'number' ? data.answer : 1;
  const hierarchy =
    (typeof data.hierarchy === 'string' && data.hierarchy.trim()) ||
    extractTopicUnit(data.topic) ||
    undefined;
  return {
    id: data.q_id ?? docId,
    content: data.question_text ?? '',
    options,
    answer: to1BasedAnswer(rawAnswer, options.length),
    explanation: aiExplanation || baseExplanation,
    aiExplanation: data.ai_explanation,
    wrongFeedback: wrongFeedbackTo1Based(data.wrong_feedback),
    imageUrl: data.image,
    topic: data.topic,
    hierarchy: hierarchy ?? undefined,
    tags: Array.isArray(data.tags) ? data.tags : [],
    trend: data.trend ?? null,
    estimated_time_sec: typeof data.estimated_time_sec === 'number' ? data.estimated_time_sec : 0,
    trap_score: typeof data.trap_score === 'number' ? data.trap_score : 0,
    problem_types: data.problem_types,
    subject_number: typeof data.subject_number === 'number' ? data.subject_number : undefined,
    difficulty_level: typeof data.difficulty_level === 'number' ? data.difficulty_level : undefined,
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

/** Elo → difficulty_level 범위 (1~5). Elo 1200 ±50 → 약 2~4 */
function eloToDifficultyRange(elo: number): number[] {
  const base = Math.round((elo - 1000) / 100);
  const levels = new Set<number>();
  for (let d = Math.max(1, base - 1); d <= Math.min(5, base + 1); d++) {
    levels.add(d);
  }
  return levels.size > 0 ? Array.from(levels) : [2, 3, 4];
}

/**
 * 유저의 exam_results에서 맞춘 문제(Exclude)·틀린 문제(Zone A) ID 집합 반환
 * (answers 필드: ExamAnswerEntry[] - qid, isCorrect, isConfused)
 */
const EXAM_RESULTS_READ_LIMIT = 100;

async function fetchUserExamResultAnswerSets(
  uid: string,
  certCode: string
): Promise<{ correctIds: Set<string>; wrongIds: Set<string> }> {
  const correctIds = new Set<string>();
  const wrongIds = new Set<string>();
  const examRef = collection(db, 'users', uid, 'exam_results');
  const q = query(examRef, orderBy('submittedAt', 'desc'), limit(EXAM_RESULTS_READ_LIMIT));
  const snap = await getDocs(q);
  snap.docs.forEach((d) => {
    const data = d.data();
    if (data.certCode !== certCode) return;
    const answers = (data.answers as ExamAnswerEntry[] | undefined) ?? [];
    answers.forEach((a) => {
      const qid = a?.qid ?? '';
      if (!qid) return;
      if (a.isCorrect) correctIds.add(qid);
      else wrongIds.add(qid);
    });
  });
  return { correctIds, wrongIds };
}

/** 맞춘 문제별 가장 오래전 풀이 시각 (ms) - Fallback 정렬용 */
async function fetchCorrectQuestionEarliestDates(
  uid: string,
  certCode: string
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const examRef = collection(db, 'users', uid, 'exam_results');
  const q = query(examRef, orderBy('submittedAt', 'desc'), limit(EXAM_RESULTS_READ_LIMIT));
  const snap = await getDocs(q);
  snap.docs.forEach((d) => {
    const data = d.data();
    if (data.certCode !== certCode) return;
    const submittedAt = data.submittedAt as { toMillis?: () => number; _seconds?: number } | undefined;
    const ts = typeof submittedAt?.toMillis === 'function'
      ? submittedAt.toMillis()
      : typeof submittedAt?._seconds === 'number'
        ? submittedAt._seconds * 1000
        : Date.now();
    const answers = (data.answers as ExamAnswerEntry[] | undefined) ?? [];
    answers.forEach((a) => {
      if (!a?.isCorrect) return;
      const qid = a.qid ?? '';
      if (!qid) return;
      const prev = map.get(qid);
      if (prev == null || ts < prev) map.set(qid, ts);
    });
  });
  return map;
}

/** Static 4·5회차 완료 여부 (고난이도 스케일링 판단용) */
async function hasCompletedStatic45(uid: string, certId: string): Promise<boolean> {
  const roundIds = EXAM_ROUNDS.filter((r) => r.certId === certId && (r.round === 4 || r.round === 5)).map((r) => r.id);
  if (roundIds.length === 0) return false;
  const examRef = collection(db, 'users', uid, 'exam_results');
  const q = query(examRef, orderBy('submittedAt', 'desc'), limit(80));
  const snap = await getDocs(q);
  const cert = CERTIFICATIONS.find((c) => c.id === certId);
  const certCode = cert?.code ?? null;
  if (!certCode) return false;
  for (const d of snap.docs) {
    const data = d.data();
    if (data.certCode !== certCode) continue;
    const rid = data.roundId as string | undefined;
    if (rid && roundIds.includes(rid)) return true;
  }
  return false;
}

/** 맞춤형 큐레이션 시 풀 문제 수 상한 (Read 비용·성능 제한) */
const POOL_QUESTIONS_READ_LIMIT = 2000;

/** 메타데이터 레코드 → 큐레이션용 Question 스텁 (본문/옵션 제외) */
function metadataToQuestionStubs(records: QuestionMetadataRecord[]): Question[] {
  return records.map((r) => ({
    id: r.q_id,
    content: '',
    options: [],
    answer: 1,
    explanation: '',
    tags: r.tags ?? [],
    trend: r.trend ?? null,
    estimated_time_sec: r.estimated_time_sec ?? 0,
    trap_score: r.trap_score ?? 0,
    problem_types: r.problem_types,
    subject_number: r.subject_number,
    hierarchy: r.hierarchy,
    difficulty_level: r.difficulty_level,
    round: r.round,
  }));
}

/** Firestore 문서 → QuestionMetadataRecord */
function firestoreDocToMetadata(certCode: string, docId: string, data: FirestoreQuestionDoc): QuestionMetadataRecord {
  return {
    id: `${certCode}_${data.q_id ?? docId}`,
    certCode,
    q_id: data.q_id ?? docId,
    subject_number: data.subject_number,
    hierarchy: data.hierarchy,
    difficulty_level: data.difficulty_level,
    tags: Array.isArray(data.tags) ? data.tags : [],
    round: data.round,
    trap_score: typeof data.trap_score === 'number' ? data.trap_score : 0,
    trend: data.trend ?? null,
    estimated_time_sec: typeof data.estimated_time_sec === 'number' ? data.estimated_time_sec : 0,
    problem_types: data.problem_types,
    core_id: data.core_id,
  };
}

/**
 * question_pools: IndexedDB 메타데이터 캐시 우선 → 없을 때만 Firestore 1회 조회 후 캐싱
 * 이후 큐레이션은 로컬에서 0.1초 내 처리
 */
async function fetchAllPoolQuestions(certCode: string): Promise<Question[]> {
  const fromCache = await hasQuestionMetadataForCert(certCode);
  if (fromCache) {
    const records = await getQuestionMetadataByCert(certCode);
    return metadataToQuestionStubs(records);
  }

  const q = query(
    collectionGroup(db, 'questions'),
    where('cert_id', '==', certCode),
    limit(POOL_QUESTIONS_READ_LIMIT)
  );
  const snap = await getDocs(q);
  const metaRecords: QuestionMetadataRecord[] = [];
  const list: Question[] = [];
  snap.docs.forEach((d) => {
    const data = d.data() as FirestoreQuestionDoc;
    metaRecords.push(firestoreDocToMetadata(certCode, d.id, data));
    list.push(mapPoolDocToQuestion(d.id, data));
  });
  if (metaRecords.length > 0) {
    putQuestionMetadataBulk(metaRecords).catch(() => {});
  }
  return list;
}

/**
 * Round 4+ 맞춤형 시험 생성: Zone 기반 적응형 문항 배분
 * 1. Zone A (복습): 과거에 틀렸던 문제
 * 2. Zone B (도전): 한 번도 풀지 않은 신규 문제 (round 99 또는 round 1~5)
 * 3. Fallback: Zone A·B 부족 시 맞춘 문제 중 가장 오래전에 푼 문제 또는 trap_score 높은 순
 * - 과목별 question_count 엄격 유지, 고난이도 스케일링(Static 4·5 완료 시 Zone B에 difficulty_level 높은 문제 우선)
 */
export async function generateAdaptiveExam(
  uid: string,
  certCode: string,
  certId: string,
  targetExamDate: string | null,
  questionCount: number = ROUND4_TOTAL
): Promise<Question[]> {
  const certInfo = await getCertificationInfo(certCode);
  const totalTarget = certInfo?.subjects?.length
    ? certInfo.subjects.reduce((s, subj) => s + subj.question_count, 0)
    : questionCount;

  const [answerSets, allPool, earliestDates, useHighDifficulty] = await Promise.all([
    fetchUserExamResultAnswerSets(uid, certCode),
    fetchAllPoolQuestions(certCode),
    fetchCorrectQuestionEarliestDates(uid, certCode),
    hasCompletedStatic45(uid, certId),
  ]);
  const { correctIds, wrongIds } = answerSets;

  /** Zone B: round 99 또는 1~5인 신규(안 푼) 문제만 */
  const isZoneBPool = (q: Question) => {
    const r = q.round;
    if (r == null) return true;
    return r === 99 || (r >= 1 && r <= 5);
  };

  const bySubject = new Map<number, { zoneA: Question[]; zoneB: Question[]; fallback: Question[] }>();
  for (const q of allPool) {
    const subj = q.subject_number ?? 1;
    if (!bySubject.has(subj)) bySubject.set(subj, { zoneA: [], zoneB: [], fallback: [] });
    const bag = bySubject.get(subj)!;
    if (wrongIds.has(q.id)) bag.zoneA.push(q);
    else if (!correctIds.has(q.id) && isZoneBPool(q)) bag.zoneB.push(q);
    else if (correctIds.has(q.id)) bag.fallback.push(q);
  }

  /** Fallback 정렬: 가장 오래전에 푼 문제 우선, 동일 시 trap_score 높은 순 */
  for (const bag of bySubject.values()) {
    bag.fallback.sort((a, b) => {
      const ta = earliestDates.get(a.id) ?? Infinity;
      const tb = earliestDates.get(b.id) ?? Infinity;
      if (ta !== tb) return ta - tb;
      return (b.trap_score ?? 0) - (a.trap_score ?? 0);
    });
  }

  const picked: Question[] = [];
  const subjectCounts = certInfo?.subjects ?? [{ subject_number: 1, name: '전체', question_count: totalTarget }];
  const seen = new Set<string>();
  const add = (q: Question) => {
    if (seen.has(q.id)) return false;
    seen.add(q.id);
    picked.push(q);
    return true;
  };

  for (const subjConfig of subjectCounts) {
    const num = subjConfig.subject_number;
    const need = subjConfig.question_count;
    const bag = bySubject.get(num) ?? { zoneA: [], zoneB: [], fallback: [] };
    const zoneA = shuffleArray([...bag.zoneA]);
    let zoneB = shuffleArray([...bag.zoneB]);
    if (useHighDifficulty) {
      zoneB.sort((a, b) => (b.difficulty_level ?? 0) - (a.difficulty_level ?? 0));
    }
    const fallback = [...bag.fallback];
    let n = 0;
    for (const q of zoneA) { if (n >= need) break; if (add(q)) n++; }
    for (const q of zoneB) { if (n >= need) break; if (add(q)) n++; }
    for (const q of fallback) { if (n >= need) break; if (add(q)) n++; }
  }

  const pickedSlice = picked.slice(0, totalTarget);
  const isStubs = pickedSlice.length > 0 && (!pickedSlice[0].content || pickedSlice[0].options.length === 0);
  if (isStubs && pickedSlice.length > 0) {
    const full = await fetchQuestionsFromPools(certCode, pickedSlice.map((q) => q.id));
    const orderMap = new Map(full.map((q) => [q.id, q]));
    return pickedSlice.map((q) => orderMap.get(q.id)).filter((q): q is Question => !!q);
  }
  return pickedSlice;
}

/**
 * Round 4+ 문제 Fetch (20문제) 또는 Round 5 (80문제)
 * @param curationMode 실전 대비형(REAL_EXAM) / 약점 강화형(WEAKNESS_ATTACK) - 4회차 이상에서 선택 시 전달
 */
export async function fetchAdaptiveQuestions(
  uid: string,
  certId: string,
  user: User | null,
  round: number,
  curationMode?: AiMockExamMode
): Promise<Question[]> {
  const certCode = certIdToCode(certId);
  if (!certCode) throw new Error('해당 자격증을 찾을 수 없습니다.');

  const targetExamDate = getTargetExamDate(user, certId);

  if (round >= 5) {
    return generateAiMockExam(uid, certCode, targetExamDate, curationMode);
  }

  return generateAdaptiveExam(uid, certCode, certId, targetExamDate, ROUND4_TOTAL);
}

/**
 * users/{uid}/stats/{certCode} 조회 (hierarchy_stats, tag_stats)
 */
async function fetchStatsForCert(uid: string, certCode: string): Promise<{
  hierarchy_stats?: Record<string, StatEntryLike>;
  tag_stats?: Record<string, StatEntryLike>;
  confused_qids?: string[];
}> {
  const ref = doc(db, 'users', uid, 'stats', certCode);
  const snap = await getDoc(ref);
  return snap.exists() ? (snap.data() as Record<string, unknown>) : {};
}

/**
 * tag_stats에서 정답률이 낮은 상위 태그명 반환 (약점 강화형 안내 문구용)
 * @param limit 상위 N개 (기본 3)
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
 * 오버레이 메시지용 분석 컨텍스트 생성 (Phase 2: stats.hierarchy_stats 기반)
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

  const targetExamDate = getTargetExamDate(user, certId);
  const daysLeft = getDaysLeft(targetExamDate);
  const isNew = isNewUser(user);

  const plan = await generateAdaptiveExamPlan(uid, certCode, targetExamDate);
  const mode = plan.mode as AiExamMode;
  const top1Unit = plan.plan[0]?.hierarchy ?? null;

  const statsData = await fetchStatsForCert(uid, certCode);
  const hierarchyStats = statsData.hierarchy_stats ?? {};
  const hasData = Object.keys(hierarchyStats).length > 0;

  let avgProficiency = 0;
  let top1Proficiency: number | undefined;
  let top1Misconception: number | undefined;
  if (hasData) {
    const probs = Object.values(hierarchyStats).map((s) => s.proficiency ?? 0).filter((p) => p > 0);
    avgProficiency = probs.length > 0 ? probs.reduce((a, b) => a + b, 0) / probs.length : 0;
    if (top1Unit) {
      const topStat = hierarchyStats[top1Unit];
      top1Proficiency = topStat?.proficiency;
      top1Misconception = topStat?.misconception_count;
    }
  }

  return {
    mode,
    top1Unit,
    top1Proficiency,
    top1Misconception,
    avgProficiency,
    hasData,
    isDataScanty: !hasData,
    isNewUser: isNew,
    daysLeft,
  };
}
