/**
 * examService.ts
 * - 실제 Firestore DB 구조 기반 문제 Fetching
 * - 회원 등급별 접근/마스킹 정책
 * - certifications/{certId}/question_pools/{대분류}/questions/{문제ID}
 *
 * --- Firestore 인덱스 (단일 필드, 콘솔에서만 생성 가능) ---
 * collectionGroup('questions') + where('q_id', 'in', chunk) 쿼리 사용 시
 * 아래 링크를 브라우저로 열어 "인덱스 생성" 버튼 클릭 후 Enabled 될 때까지 대기.
 * Firebase 프로젝트: aibt-99bc6 (서비스: FINSET/핀셋)
 *
 * [단일 필드 - q_id] create_exemption 링크:
 * https://console.firebase.google.com/v1/r/project/aibt-99bc6/firestore/indexes?create_exemption=Ck5wcm9qZWN0cy9haWJ0LTk5YmM2L2RhdGFiYXNlcy8oZGVmYXVsdCkvY29sbGVjdGlvbkdyb3Vwcy9xdWVzdGlvbnMvZmllbGRzL3FfaWQQAhoICgRxX2lkEAE
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
  updateDoc,
  setDoc,
} from 'firebase/firestore';
import { db } from '../firebase';
import { Question, User, type ExamAnswerEntry, type UserRound } from '../types';
import { CERTIFICATIONS, CERT_IDS_WITH_QUESTIONS, WRONG_FEEDBACK_PLACEHOLDER } from '../constants';
import {
  hasQuestionMetadataForCert,
  getQuestionMetadataByCert,
  putQuestionMetadataBulk,
  getQuestionIndexFromCache,
  syncQuestionIndex,
  type QuestionMetadataRecord,
  type QuestionIndexItem,
} from './db/localCacheDB';
import { getCertificationInfo } from './gradingService';
import { to1BasedAnswer, wrongFeedbackTo1Based } from '../utils/questionUtils';

const IN_QUERY_LIMIT = 30; // Firestore 'in' 쿼리 최대 30개 (대량 로딩 병렬화)

/** 시험 장부 문서 구조 - question_refs 사용 */
interface QuestionRef {
  q_id: string;
  difficulty?: number;
  core_concept?: string;
}

interface StaticExamDoc {
  question_refs: QuestionRef[];
  title?: string;
  description?: string;
  round?: number;
  isPremium?: boolean;
  timeLimit?: number;
}

/** Firestore 문제 문서 실제 규격 */
export interface FirestoreQuestionDoc {
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
  hierarchy?: string;
  topic?: string;
  random_id?: number;
  tags?: string[];
  trend?: string | null;
  estimated_time_sec?: number;
  trap_score?: number;
  problem_types?: string[];
  subject_number?: number;
  core_id?: string;
  sub_core_id?: string;
  round?: number;
  table_data?: string | { headers: string[]; rows: string[][] } | null;
  stats?: Record<string, number>;
}

export type AiMockExamMode = 'REAL_EXAM' | 'WEAKNESS_ATTACK';

/** AI 모의고사 계획 - core_concept별 출제 조건 */
export interface WeaknessPlanItem {
  core_concept: string;
  difficultyLevels: number[];
  count: number;
}

/** generateAdaptiveExamPlan 반환 타입 */
export interface AdaptiveExamPlan {
  mode: 'REAL_EXAM_BALANCE' | 'WEAKNESS_ATTACK';
  plan: WeaknessPlanItem[];
  randomCount: number;
}

interface UserWeaknessStat {
  proficiency?: number;
  misconception_count?: number;
  last_attempted_at?: { toDate: () => Date };
}

/** users/{uid}/stats/{certCode} 문서 */
export interface UserStatsForCert {
  core_concept_stats?: Record<string, { correct?: number; total?: number; misconception_count?: number; proficiency?: number; last_attempted_at?: { toDate: () => Date } }>;
  hierarchy_stats?: Record<string, { proficiency?: number; misconception_count?: number; total?: number; correct?: number; last_attempted_at?: { toDate: () => Date } }>;
}

function _calculatePriority(stat: UserWeaknessStat): number {
  const proficiency = stat.proficiency ?? 0;
  const misconceptionCount = stat.misconception_count ?? 0;
  let daysSince = 14;
  if (stat.last_attempted_at && typeof stat.last_attempted_at.toDate === 'function') {
    const lastDate = stat.last_attempted_at.toDate();
    daysSince = Math.floor((Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
  }
  return (100 - proficiency) * 0.5 + daysSince * 0.3 + misconceptionCount * 5 * 0.2;
}

async function _fetchUserWeaknessStats(uid: string, certCode: string): Promise<Record<string, UserWeaknessStat>> {
  const ref = doc(db, 'users', uid, 'stats', certCode);
  const snap = await getDoc(ref);
  if (!snap.exists()) return {};
  const data = snap.data() as UserStatsForCert;
  const conceptStats = data.core_concept_stats ?? data.hierarchy_stats ?? {};
  const out: Record<string, UserWeaknessStat> = {};
  for (const [key, entry] of Object.entries(conceptStats)) {
    if (!key) continue;
    const e = entry as { proficiency?: number; misconception_count?: number; last_attempted_at?: { toDate: () => Date } };
    out[key] = { proficiency: e.proficiency, misconception_count: e.misconception_count, last_attempted_at: e.last_attempted_at };
  }
  return out;
}

export function extractTopicUnit(topic: string | undefined): string | null {
  if (!topic || typeof topic !== 'string') return null;
  const parts = topic.split(' > ').map((s) => s.trim()).filter(Boolean);
  return parts.length >= 2 ? parts[1] : null;
}

export function mapPoolDocToQuestion(docId: string, data: FirestoreQuestionDoc): Question {
  const baseExplanation = data.explanation ?? '';
  const aiExplanation = data.ai_explanation ?? '';
  const options = Array.isArray(data.options) ? data.options : [];
  const rawAnswer = typeof data.answer === 'number' ? data.answer : 1;
  const coreConcept =
    (typeof data.core_concept === 'string' && data.core_concept.trim()) ||
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
    core_concept: coreConcept ?? undefined,
    tags: Array.isArray(data.tags) ? data.tags : [],
    trend: data.trend ?? null,
    estimated_time_sec: typeof data.estimated_time_sec === 'number' ? data.estimated_time_sec : 0,
    trap_score: typeof data.trap_score === 'number' ? data.trap_score : 0,
    problem_types: Array.isArray(data.problem_types) ? data.problem_types : undefined,
    subject_number: typeof data.subject_number === 'number' ? data.subject_number : undefined,
    difficulty_level: typeof data.difficulty_level === 'number' ? data.difficulty_level : undefined,
    core_id: typeof data.core_id === 'string' ? data.core_id : undefined,
    sub_core_id: typeof data.sub_core_id === 'string' ? data.sub_core_id : undefined,
    round: typeof data.round === 'number' ? data.round : undefined,
    tableData: data.table_data ?? undefined,
  };
}

export async function generateAdaptiveExamPlan(
  uid: string,
  certCode: string,
  targetExamDate: string | null
): Promise<AdaptiveExamPlan> {
  const TOTAL_QUESTIONS = 80;
  let isRealExamMode = false;
  if (targetExamDate) {
    const daysLeft = Math.floor((new Date(targetExamDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    if (daysLeft <= 7) isRealExamMode = true;
  }
  const targetRatio = isRealExamMode ? 0.4 : 0.8;
  const weaknessQCount = Math.floor(TOTAL_QUESTIONS * targetRatio);
  const randomQCount = TOTAL_QUESTIONS - weaknessQCount;
  const userStats = await _fetchUserWeaknessStats(uid, certCode);
  const rankedTopics = Object.entries(userStats)
    .map(([core_concept, stat]) => ({ core_concept, proficiency: stat.proficiency ?? 0, priorityScore: _calculatePriority(stat) }))
    .sort((a, b) => b.priorityScore - a.priorityScore)
    .slice(0, 3);
  const weaknessPlan: WeaknessPlanItem[] = rankedTopics.map((topic) => {
    const targetDifficulty = topic.proficiency < 50 ? [1, 2] : [3, 4, 5];
    return { core_concept: topic.core_concept, difficultyLevels: targetDifficulty, count: Math.floor(weaknessQCount / 3) };
  });
  return { mode: isRealExamMode ? 'REAL_EXAM_BALANCE' : 'WEAKNESS_ATTACK', plan: weaknessPlan, randomCount: randomQCount + (weaknessQCount % 3) };
}

export type ExamAccessResult = { allowed: boolean; reason?: string };

/**
 * 단원명 정규화 (stats/ question_pools 문서 ID 매칭용)
 * 공백·대소문자 차이로 매칭 실패 방지
 */
export function normalizeUnitKey(s: string | undefined | null): string {
  if (!s || typeof s !== 'string') return '';
  return s.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Fisher-Yates Shuffle */
function shuffleArray<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}


/**
 * 계획(plan) 기반 약점 문제 Fetch
 * - allPool 있으면: 풀에서 core_concept·난이도로 필터 (단일 풀 구조 대응)
 * - 없으면: question_pools/{core_concept}/questions 쿼리 또는 collectionGroup topic 폴백
 */
async function fetchWeaknessQuestions(
  certCode: string,
  plan: WeaknessPlanItem[],
  normToDocId: Map<string, string>,
  allPool?: Question[]
): Promise<Question[]> {
  if (allPool && allPool.length > 0) {
    const results: Question[] = [];
    const used = new Set<string>();
    for (const item of plan) {
      if (item.count <= 0) continue;
      const itemNorm = normalizeUnitKey(item.core_concept);
      const bag = shuffleArray(
        allPool.filter(
          (q) =>
            !used.has(q.id) &&
            normalizeUnitKey((q.core_concept ?? '').trim() || '기타') === itemNorm &&
            item.difficultyLevels.includes(q.difficulty_level ?? 0)
        )
      );
      for (let i = 0; i < Math.min(item.count, bag.length); i++) {
        used.add(bag[i].id);
        results.push(bag[i]);
      }
    }
    if (results.length > 0) return results;
  }

  const results: Question[] = [];
  for (const item of plan) {
    if (item.count <= 0) continue;
    const docId = normToDocId.get(normalizeUnitKey(item.core_concept)) ?? item.core_concept;
    const qRef = collection(db, 'certifications', certCode, 'question_pools', docId, 'questions');
    const q = query(
      qRef,
      where('difficulty_level', 'in', item.difficultyLevels.slice(0, 10)),
      limit(item.count)
    );
    const snap = await getDocs(q);
    snap.docs.forEach((d) => {
      results.push(mapPoolDocToQuestion(d.id, d.data() as FirestoreQuestionDoc));
    });
  }
  if (results.length > 0) return results;

  const topicPrefix = `${certCode} > `;
  for (const item of plan) {
    if (item.count <= 0) continue;
    const prefix = `${topicPrefix}${item.core_concept}`;
    const q = query(
      collectionGroup(db, 'questions'),
      where('cert_id', '==', certCode),
      where('topic', '>=', prefix),
      where('topic', '<=', prefix + '\uf8ff'),
      limit(item.count * 3)
    );
    const snap = await getDocs(q);
    const itemNorm = normalizeUnitKey(item.core_concept);
    const filtered = snap.docs
      .map((d) => ({ doc: d, data: d.data() as FirestoreQuestionDoc }))
      .filter(
        ({ data }) => {
          const unit = (data.core_concept ?? data.hierarchy)?.trim() || extractTopicUnit(data.topic) || '';
          return (
            normalizeUnitKey(unit) === itemNorm &&
            data.difficulty_level != null &&
            item.difficultyLevels.includes(data.difficulty_level)
          );
        }
      )
      .slice(0, item.count);
    filtered.forEach(({ doc, data }) => {
      results.push(mapPoolDocToQuestion(doc.id, data));
    });
  }
  return results;
}

/**
 * trend 필드 우선 큐레이션 설계
 * - trend가 존재하는 문제만 쓰려면: where('trend', '!=', null) 또는
 *   where('trend', 'in', ['2024상반기', '핵심']) 등으로 필터 후 limit.
 * - 복합: cert_id + trend != null + orderBy('trend') 등으로 인덱스 필요 시 Firebase 콘솔에 복합 인덱스 추가.
 */

/** array-contains-any 최대 10개 제한 */
const ARRAY_CONTAINS_ANY_LIMIT = 10;

/**
 * 특정 태그 리스트로 문제 조회 (array-contains-any, 태그 10개 단위 청크)
 * - certifications/{certCode} question_pools 하위 또는 collectionGroup('questions') 사용
 */
export async function fetchQuestionsByTags(
  certCode: string,
  tagList: string[],
  limitCount: number = 50
): Promise<Question[]> {
  if (!tagList.length) return [];
  const seen = new Set<string>();
  const results: Question[] = [];
  for (let i = 0; i < tagList.length; i += ARRAY_CONTAINS_ANY_LIMIT) {
    const chunk = tagList.slice(i, i + ARRAY_CONTAINS_ANY_LIMIT);
    const q = query(
      collectionGroup(db, 'questions'),
      where('cert_id', '==', certCode),
      where('tags', 'array-contains-any', chunk),
      limit(limitCount)
    );
    const snap = await getDocs(q);
    snap.docs.forEach((d) => {
      const qq = mapPoolDocToQuestion(d.id, d.data() as FirestoreQuestionDoc);
      if (!seen.has(qq.id)) {
        seen.add(qq.id);
        results.push(qq);
      }
    });
    if (results.length >= limitCount) break;
  }
  return results.slice(0, limitCount);
}

/**
 * question_pools에서 랜덤 문제 Fetch (random_id: 0~100만 정수)
 */
async function fetchRandomQuestionsFromPools(
  certCode: string,
  randomCount: number,
  excludeIds: Set<string>
): Promise<Question[]> {
  const poolRef = collection(db, 'certifications', certCode, 'question_pools');
  const poolSnap = await getDocs(poolRef);
  const hierarchies = poolSnap.docs.map((d) => d.id).filter(Boolean);
  if (hierarchies.length === 0) return [];

  const perHierarchy = Math.max(1, Math.ceil(randomCount / hierarchies.length));
  const results: Question[] = [];
  const randomInt = Math.floor(Math.random() * 1_000_001); // 0 ~ 1,000,000

  for (const h of hierarchies) {
    const qRef = collection(db, 'certifications', certCode, 'question_pools', h, 'questions');
    const q = query(
      qRef,
      where('random_id', '>=', randomInt),
      orderBy('random_id'),
      limit(perHierarchy)
    );
    const snap = await getDocs(q);
    snap.docs.forEach((d) => {
      const qq = mapPoolDocToQuestion(d.id, d.data() as FirestoreQuestionDoc);
      if (!excludeIds.has(qq.id)) results.push(qq);
    });
    if (results.length >= randomCount) break;
  }

  if (results.length < randomCount) {
    for (const h of hierarchies) {
      if (results.length >= randomCount) break;
      const qRef = collection(db, 'certifications', certCode, 'question_pools', h, 'questions');
      const q = query(
        qRef,
        where('random_id', '<', randomInt),
        orderBy('random_id', 'desc'),
        limit(perHierarchy)
      );
      const snap = await getDocs(q);
      snap.docs.forEach((d) => {
        const qq = mapPoolDocToQuestion(d.id, d.data() as FirestoreQuestionDoc);
        if (!excludeIds.has(qq.id) && results.length < randomCount) results.push(qq);
      });
    }
  }

  return results.slice(0, randomCount);
}

/**
 * 80문항 미달 시: collectionGroup에서 cert_id로 부족분 채우기
 */
async function fetchFromCollectionGroupFallback(
  certCode: string,
  needed: number,
  excludeIds: Set<string>
): Promise<Question[]> {
  const randomInt = Math.floor(Math.random() * 1_000_001);
  const q = query(
    collectionGroup(db, 'questions'),
    where('cert_id', '==', certCode),
    where('random_id', '>=', randomInt),
    orderBy('random_id'),
    limit(needed * 3)
  );
  const snap = await getDocs(q);
  const results: Question[] = [];
  for (const d of snap.docs) {
    const qq = mapPoolDocToQuestion(d.id, d.data() as FirestoreQuestionDoc);
    if (!excludeIds.has(qq.id)) results.push(qq);
    if (results.length >= needed) break;
  }
  if (results.length < needed) {
    const q2 = query(
      collectionGroup(db, 'questions'),
      where('cert_id', '==', certCode),
      where('random_id', '<', randomInt),
      orderBy('random_id', 'desc'),
      limit(needed * 3)
    );
    const snap2 = await getDocs(q2);
    for (const d of snap2.docs) {
      const qq = mapPoolDocToQuestion(d.id, d.data() as FirestoreQuestionDoc);
      if (!excludeIds.has(qq.id) && !results.some((r) => r.id === qq.id)) results.push(qq);
      if (results.length >= needed) break;
    }
  }
  return results.slice(0, needed);
}

const TOTAL_QUESTIONS = 80;

/** 큐레이션된 문제 목록의 총 예상 풀이 시간(초) */
export function getTotalEstimatedTimeSec(questions: Question[]): number {
  return questions.reduce((s, q) => s + (q.estimated_time_sec ?? 0), 0);
}

/** users/{uid}/stats/{certCode} 조회 */
async function fetchStatsDoc(uid: string, certCode: string): Promise<UserStatsForCert> {
  const ref = doc(db, 'users', uid, 'stats', certCode);
  const snap = await getDoc(ref);
  return snap.exists() ? (snap.data() as UserStatsForCert) : {};
}

const EXAM_RESULTS_READ_LIMIT = 100;

/** exam_results에서 맞춘/틀린 문제 ID 집합 (certCode 기준, 최근 N건만 읽어 Full Scan 방지) */
async function fetchExamResultAnswerSets(
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

/** 오답 ID를 '가장 최근에 틀린 순'으로 반환 (exam_results submittedAt desc 순으로 수집, 중복 시 첫 등장만) */
async function fetchWrongIdsByRecency(uid: string, certCode: string): Promise<string[]> {
  const seen = new Set<string>();
  const order: string[] = [];
  const examRef = collection(db, 'users', uid, 'exam_results');
  const q = query(examRef, orderBy('submittedAt', 'desc'), limit(EXAM_RESULTS_READ_LIMIT));
  const snap = await getDocs(q);
  snap.docs.forEach((d) => {
    const data = d.data();
    if (data.certCode !== certCode) return;
    const answers = (data.answers as ExamAnswerEntry[] | undefined) ?? [];
    answers.forEach((a) => {
      const qid = a?.qid ?? '';
      if (!qid || a.isCorrect) return;
      if (!seen.has(qid)) {
        seen.add(qid);
        order.push(qid);
      }
    });
  });
  return order;
}

/** 오답 개수만 반환 (약점 카드 버튼 노출 여부용) */
export async function getWrongQuestionCount(uid: string, certCode: string): Promise<number> {
  const { wrongIds } = await fetchExamResultAnswerSets(uid, certCode);
  return wrongIds.size;
}

const POOL_QUESTIONS_READ_LIMIT = 2000;

/** 메타데이터 레코드 → 큐레이션용 Question 스텁 (본문/옵션 제외, 강화 학습 필터링용) */
function metadataToQuestionStub(r: QuestionMetadataRecord): Question {
  return {
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
    core_concept: r.core_concept,
    difficulty_level: r.difficulty_level,
    round: r.round,
  };
}

/** Firestore 문서 → QuestionMetadataRecord (캐시 저장용) */
function firestoreDocToMetadata(certCode: string, docId: string, data: FirestoreQuestionDoc): QuestionMetadataRecord {
  return {
    id: `${certCode}_${data.q_id ?? docId}`,
    certCode,
    q_id: data.q_id ?? docId,
    subject_number: data.subject_number,
    core_concept: (data.core_concept ?? (data as { hierarchy?: string }).hierarchy) ?? undefined,
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

/** 인덱스 항목 → 취약유형/취약개념 필터링용 Question 스텁 (BIGDATA 풀 폴백) */
function indexItemToQuestionStub(item: QuestionIndexItem): Question {
  const pt = item.metadata?.problem_type;
  const difficultyRaw = item.stats?.difficulty;
  const difficultyLevel =
    typeof difficultyRaw === 'number'
      ? difficultyRaw <= 0.2
        ? 1
        : difficultyRaw <= 0.4
          ? 2
          : difficultyRaw <= 0.6
            ? 3
            : difficultyRaw <= 0.8
              ? 4
              : 5
      : undefined;
  return {
    id: item.q_id,
    content: '',
    options: [],
    answer: 1,
    explanation: '',
    tags: Array.isArray(item.metadata?.tags) ? item.metadata.tags : [],
    trend: null,
    estimated_time_sec: typeof item.stats?.estimated_time_sec === 'number' ? item.stats.estimated_time_sec : 0,
    trap_score: typeof item.stats?.trap_score === 'number' ? item.stats.trap_score : 0,
    problem_types: typeof pt === 'string' && pt.trim() ? [pt.trim()] : undefined,
    subject_number: typeof item.metadata?.subject === 'number' ? item.metadata.subject : undefined,
    core_concept: undefined,
    difficulty_level: difficultyLevel,
    sub_core_id: typeof item.metadata?.sub_core_id === 'string' ? item.metadata.sub_core_id : undefined,
  };
}

/**
 * question_pools: IndexedDB 메타데이터 캐시 우선 → 없을 때만 Firestore 1회 조회 후 캐싱
 * (과목강화/취약유형/취약개념 등 강화 학습 호출 시 2000 read 방지)
 * BIGDATA: 메타 캐시 미사용 → 인덱스 우선 로드(동기화 후 사용), 없거나 실패 시에만 Firestore 시도
 */
async function fetchAllPoolQuestions(certCode: string): Promise<Question[]> {
  const fromCache = await hasQuestionMetadataForCert(certCode);
  if (fromCache) {
    const records = await getQuestionMetadataByCert(certCode);
    return records.map(metadataToQuestionStub);
  }

  if (certCode === 'BIGDATA') {
    let indexItems = await getQuestionIndexFromCache(certCode);
    if (!indexItems || indexItems.length === 0) {
      await syncQuestionIndex(certCode);
      indexItems = await getQuestionIndexFromCache(certCode);
    }
    if (indexItems && indexItems.length > 0) {
      const fromIndex = indexItems.map(indexItemToQuestionStub);
      return fromIndex;
    }
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

  if (list.length === 0 && certCode === 'BIGDATA') {
    let indexItems = await getQuestionIndexFromCache(certCode);
    if (!indexItems || indexItems.length === 0) {
      await syncQuestionIndex(certCode);
      indexItems = await getQuestionIndexFromCache(certCode);
    }
    if (indexItems && indexItems.length > 0) {
      const fromIndex = indexItems.map(indexItemToQuestionStub);
      return fromIndex;
    }
  }

  return list;
}

/** Firestore 필드명용 (tag_stats 키와 비교 시 사용) */
function sanitizeTagKey(s: string): string {
  return s.replace(/[./\[\]*~]/g, '_');
}

/** Elo proficiency → 0~1 (Cold Start/데이터 없음 → 0으로 간주하여 Low 처리) */
function eloToProficiency01(elo: number | undefined): number {
  if (elo == null || elo <= 0) return 0;
  return 1 / (1 + Math.pow(10, (1200 - elo) / 400));
}

/** 이해도 밴드: Low < 0.4, Mid 0.4~0.7, High >= 0.7 */
export type ProficiencyBand = 'low' | 'mid' | 'high';
function getProficiencyBand(proficiency01: number): ProficiencyBand {
  if (proficiency01 < 0.4) return 'low';
  if (proficiency01 < 0.7) return 'mid';
  return 'high';
}

/** difficulty_level 1~5: 1=저, 2=중, 3+=고. 이해도에 따라 선호 난이도 [1,2] 또는 [2,3,4,5] */
function getPreferredDifficultyLevels(band: ProficiencyBand): number[] {
  return band === 'low' ? [1, 2] : [2, 3, 4, 5];
}

/** 풀에서 선호 난이도 우선 수집 후 부족분은 난이도 해제하여 50개 채움 */
function pickByDifficultyThenFill(
  pool: Question[],
  preferredLevels: number[],
  excludeIds: Set<string>,
  target: number,
  logPrefix: string
): Question[] {
  const preferred = pool.filter(
    (q) => !excludeIds.has(q.id) && preferredLevels.includes(q.difficulty_level ?? 0)
  );
  const rest = pool.filter(
    (q) => !excludeIds.has(q.id) && !preferredLevels.includes(q.difficulty_level ?? 0)
  );
  const shuffledPreferred = shuffleArray(preferred);
  const shuffledRest = shuffleArray(rest);
  const result: Question[] = [];
  for (const q of shuffledPreferred) {
    if (result.length >= target) break;
    result.push(q);
    excludeIds.add(q.id);
  }
  const fromPreferred = result.length;
  if (result.length < target) {
    for (const q of shuffledRest) {
      if (result.length >= target) break;
      result.push(q);
      excludeIds.add(q.id);
    }
  }
  return result;
}

/**
 * 실전 대비형 (8:2): 80% Trend&New(Zone B, trend 있음, 난이도≥3, 과목 비중 준수), 20% Zone A 랜덤
 */
async function generateRealExamMode(
  uid: string,
  certCode: string,
  certInfo: { subjects?: { subject_number: number; name: string; question_count: number }[] } | null
): Promise<Question[]> {
  const subjectConfigs = certInfo?.subjects ?? [{ subject_number: 1, name: '전체', question_count: 64 }];
  const needTrendNew = 64;
  const needReview = 16;

  const [answerSets, allPool] = await Promise.all([
    fetchExamResultAnswerSets(uid, certCode),
    fetchAllPoolQuestions(certCode),
  ]);
  const { correctIds, wrongIds } = answerSets;

  const zoneB = allPool.filter((q) => !correctIds.has(q.id));
  const zoneA = allPool.filter((q) => wrongIds.has(q.id));
  const trendAndNew = zoneB.filter(
    (q) => (q.trend != null && q.trend !== '') && ((q.difficulty_level ?? 0) >= 3)
  );

  const bySubject = new Map<number, Question[]>();
  for (const q of trendAndNew) {
    const subj = q.subject_number ?? 1;
    if (!bySubject.has(subj)) bySubject.set(subj, []);
    bySubject.get(subj)!.push(q);
  }
  const totalSubjectCount = subjectConfigs.reduce((s, c) => s + (c.question_count ?? 0), 0) || 1;
  const pickedTrend: Question[] = [];
  const seenTrend = new Set<string>();
  for (const subjConfig of subjectConfigs) {
    const num = subjConfig.subject_number;
    const ratio = (subjConfig.question_count ?? 0) / totalSubjectCount;
    const needForSubj = Math.round(needTrendNew * ratio) || 0;
    const bag = shuffleArray(bySubject.get(num) ?? []);
    for (let i = 0; i < needForSubj && i < bag.length; i++) {
      if (!seenTrend.has(bag[i].id)) {
        seenTrend.add(bag[i].id);
        pickedTrend.push(bag[i]);
      }
    }
  }
  let shortfallTrend = needTrendNew - pickedTrend.length;
  for (const q of shuffleArray(trendAndNew)) {
    if (shortfallTrend <= 0) break;
    if (!seenTrend.has(q.id)) {
      seenTrend.add(q.id);
      pickedTrend.push(q);
      shortfallTrend--;
    }
  }
  const reviewPool = shuffleArray(zoneA).slice(0, needReview);
  const combined = [...pickedTrend, ...reviewPool];
  const bySubj = (a: Question, b: Question) => (a.subject_number ?? 1) - (b.subject_number ?? 1);
  combined.sort(bySubj);
  if (combined.length >= TOTAL_QUESTIONS) return combined.slice(0, TOTAL_QUESTIONS);
  const extra = await fetchFromCollectionGroupFallback(
    certCode,
    TOTAL_QUESTIONS - combined.length,
    new Set(combined.map((q) => q.id))
  );
  const withExtra = [...combined, ...extra].sort(bySubj);
  return withExtra.slice(0, TOTAL_QUESTIONS);
}

/**
 * 약점 강화형 (3:3:4): 30% confused, 30% Zone A 낮은 proficiency, 40% tag_stats 하위 3태그 Zone B
 * - 과목별 question_count는 certification_info.subjects 기준 유지, 1과목부터 차근차근 출력
 */
async function generateWeaknessAttackMode(
  uid: string,
  certCode: string
): Promise<Question[]> {
  const certInfo = await getCertificationInfo(certCode);
  const subjectConfigs = certInfo?.subjects ?? [{ subject_number: 1, name: '전체', question_count: 80 }];
  const totalTarget = subjectConfigs.reduce((s, c) => s + (c.question_count ?? 0), 0) || TOTAL_QUESTIONS;

  const stats = await fetchStatsDoc(uid, certCode);
  const confusedQids = stats.confused_qids ?? [];
  const conceptStats = stats.core_concept_stats ?? (stats as UserStatsForCert & { hierarchy_stats?: Record<string, unknown> }).hierarchy_stats ?? {};
  const tagStats = stats.tag_stats ?? {};

  const [answerSets, allPool] = await Promise.all([
    fetchExamResultAnswerSets(uid, certCode),
    fetchAllPoolQuestions(certCode),
  ]);
  const { correctIds, wrongIds } = answerSets;
  const zoneB = allPool.filter((q) => !correctIds.has(q.id));
  const zoneA = allPool.filter((q) => wrongIds.has(q.id));
  const idToQ = new Map(allPool.map((q) => [q.id, q]));

  const needConfused = 24;
  const needWrong = 24;
  const needTag = 32;

  const confusedQs: Question[] = [];
  const recentConfused = confusedQids.slice(-needConfused * 2);
  for (let i = recentConfused.length - 1; i >= 0 && confusedQs.length < needConfused; i--) {
    const q = idToQ.get(recentConfused[i]);
    if (q && !confusedQs.some((c) => c.id === q.id)) confusedQs.push(q);
  }

  const conceptOrder = Object.entries(conceptStats)
    .filter(([, v]) => ((v as { total?: number }).total ?? 0) > 0)
    .sort((a, b) => ((a[1] as { proficiency?: number }).proficiency ?? 9999) - ((b[1] as { proficiency?: number }).proficiency ?? 9999))
    .map(([c]) => c);
  const zoneAByConcept = new Map<string, Question[]>();
  for (const q of zoneA) {
    const c = (q.core_concept ?? '').trim() || '기타';
    if (!zoneAByConcept.has(c)) zoneAByConcept.set(c, []);
    zoneAByConcept.get(c)!.push(q);
  }
  const wrongQs: Question[] = [];
  for (const c of conceptOrder) {
    const bag = shuffleArray(zoneAByConcept.get(c) ?? []);
    for (const q of bag) {
      if (wrongQs.length >= needWrong) break;
      if (!wrongQs.some((w) => w.id === q.id)) wrongQs.push(q);
    }
  }

  const tagOrder = Object.entries(tagStats)
    .filter(([, v]) => (v.total ?? 0) > 0)
    .sort((a, b) => (a[1].correct ?? 0) / (a[1].total ?? 1) - (b[1].correct ?? 0) / (b[1].total ?? 1))
    .slice(0, 3)
    .map(([t]) => t);
  const tagSet = new Set(tagOrder);
  const tagZoneB = zoneB.filter((q) => q.tags?.some((t) => tagSet.has(sanitizeTagKey(t))));
  const tagQs = shuffleArray(tagZoneB).slice(0, needTag);

  const combined = [...confusedQs, ...wrongQs, ...tagQs];
  const bySubject = new Map<number, Question[]>();
  for (const q of combined) {
    const subj = q.subject_number ?? 1;
    if (!bySubject.has(subj)) bySubject.set(subj, []);
    bySubject.get(subj)!.push(q);
  }

  const picked: Question[] = [];
  const used = new Set<string>();
  for (const subjConfig of subjectConfigs) {
    const num = subjConfig.subject_number;
    const need = subjConfig.question_count ?? 0;
    const bag = shuffleArray(bySubject.get(num) ?? []);
    let n = 0;
    for (const q of bag) {
      if (n >= need) break;
      if (!used.has(q.id)) {
        used.add(q.id);
        picked.push(q);
        n++;
      }
    }
  }

  if (picked.length >= totalTarget) return picked.slice(0, totalTarget);
  const extra = await fetchFromCollectionGroupFallback(
    certCode,
    totalTarget - picked.length,
    new Set(picked.map((q) => q.id))
  );
  const bySubj = (a: Question, b: Question) => (a.subject_number ?? 1) - (b.subject_number ?? 1);
  return [...picked, ...extra].sort(bySubj).slice(0, totalTarget);
}

/**
 * AI 모의고사 80문제 생성
 * - mode 없음: 기존 plan 기반 약점 + 랜덤
 * - REAL_EXAM: 실전 대비형 8:2 (trend·신규 80%, 오답 복습 20%, 과목 비중 준수)
 * - WEAKNESS_ATTACK: 약점 강화형 3:3:4 (헷갈림 30%, 오답 core_concept 30%, 취약 태그 40%)
 */
export async function generateAiMockExam(
  uid: string,
  certCode: string,
  targetExamDate: string | null,
  mode?: AiMockExamMode
): Promise<Question[]> {
  if (mode === 'REAL_EXAM') {
    const certInfo = await getCertificationInfo(certCode);
    return generateRealExamMode(uid, certCode, certInfo ?? null);
  }
  if (mode === 'WEAKNESS_ATTACK') {
    return generateWeaknessAttackMode(uid, certCode);
  }

  const { plan, randomCount: baseRandomCount } = await generateAdaptiveExamPlan(uid, certCode, targetExamDate);
  const poolRef = collection(db, 'certifications', certCode, 'question_pools');
  const poolSnap = await getDocs(poolRef);
  const normToDocId = new Map<string, string>();
  poolSnap.docs.forEach((d) => {
    normToDocId.set(normalizeUnitKey(d.id), d.id);
  });
  const allPool = await fetchAllPoolQuestions(certCode);
  const weaknessQs = await fetchWeaknessQuestions(certCode, plan, normToDocId, allPool);
  const plannedWeaknessCount = plan.reduce((sum, p) => sum + p.count, 0);
  const shortfall = Math.max(0, plannedWeaknessCount - weaknessQs.length);
  const neededRandom = TOTAL_QUESTIONS - weaknessQs.length;
  const randomCount = Math.max(neededRandom, baseRandomCount + shortfall);

  const excludeIds = new Set(weaknessQs.map((q) => q.id));
  let randomQs: Question[] = [];
  let attemptExclude = new Set(excludeIds);
  let attempts = 0;
  const maxAttempts = 5;

  while (randomQs.length < neededRandom && attempts < maxAttempts) {
    const batch = await fetchRandomQuestionsFromPools(certCode, neededRandom - randomQs.length, attemptExclude);
    randomQs = [...randomQs, ...batch];
    batch.forEach((q) => attemptExclude.add(q.id));
    attempts++;
  }

  let combined = shuffleArray([...weaknessQs, ...randomQs]);
  if (combined.length < TOTAL_QUESTIONS) {
    const extra = await fetchFromCollectionGroupFallback(certCode, TOTAL_QUESTIONS - combined.length, new Set(combined.map((q) => q.id)));
    combined = shuffleArray([...combined, ...extra]);
  }
  if (combined.length < TOTAL_QUESTIONS) {
    const lastResort = await fetchFromCollectionGroupFallback(certCode, TOTAL_QUESTIONS - combined.length, new Set());
    combined = shuffleArray([...combined, ...lastResort]);
  }
  return combined.slice(0, TOTAL_QUESTIONS);
}

/** 회원 등급: Guest | Free | Premium | Expired */
type UserGrade = 'Guest' | 'Free' | 'Premium' | 'Expired';

/**
 * [2] 회원 등급별 권한 체크 (개편 정책)
 * - Guest: Round 1만 (UI에서 20문제 제한)
 * - Free: Round 1, 2만. Round 3+ 접근 불가
 * - Premium/Admin: Round 1~3(고정형), Round 6+(맞춤형) 모두 무제한
 */
export function checkExamAccess(params: {
  user: User | null;
  certId: string;
  round: number;
}): ExamAccessResult {
  const { user, certId, round } = params;

  // Admin: 전체 유료 기능 사용 가능
  if (user?.isAdmin) {
    if (!CERT_IDS_WITH_QUESTIONS.includes(certId)) {
      return { allowed: false, reason: '해당 과목은 현재 준비중입니다.' };
    }
    return { allowed: true };
  }

  // 문제 없는 과목은 상위(App/ExamList)에서 "준비중" 처리
  if (!CERT_IDS_WITH_QUESTIONS.includes(certId)) {
    return { allowed: false, reason: '해당 과목은 현재 준비중입니다.' };
  }

  const cert = CERTIFICATIONS.find((c) => c.id === certId);
  const certName = cert?.name ?? '해당 과목';

  // === Guest 시나리오 ===
  if (!user) {
    if (round === 1) {
      return { allowed: true }; // UI에서 20문제 제한
    }
    return {
      allowed: false,
      reason: '로그인하면 더 많은 회차를 풀 수 있어요.',
    };
  }

  // === 해당 과목 구독 여부 ===
  const hasSubscription = user.subscriptions.some((s) => s.id === certId);
  const isPaid = user.paidCertIds?.includes(certId) ?? false;
  const isExpired = user.expiredCertIds?.includes(certId) ?? false;

  // 구독 없음 → Guest와 동일 (Round 1만)
  if (!hasSubscription) {
    if (round === 1) return { allowed: true };
    return { allowed: false, reason: `${certName} 구독 후 이용 가능합니다.` };
  }

  // === Expired 시나리오 (유료였으나 만료) ===
  if (isPaid && isExpired) {
    return {
      allowed: false,
      reason: '구독이 만료되었습니다. 오답노트 열람만 가능해요.',
    };
  }

  // === Premium 시나리오 (유료, 유효) ===
  if (isPaid && !isExpired) {
    return { allowed: true }; // Round 1~3, Round 6+ 모두 접근 가능
  }

  // === Free 시나리오 (무료 회원): Round 1, 2만 ===
  if (round <= 2) {
    return { allowed: true };
  }
  return {
    allowed: false,
    reason: '열공모드로 합격권에 진입하세요.',
  };
}

/** 오답 가이드 플레이스홀더 (Quiz에서 게스트 오답 영역 노출용) */
export const PREMIUM_EXPLANATION_PLACEHOLDER = '가입 후 확인하기';
/** 오답 가이드 비프리미엄 문구 (constants에서 re-export, 순환 의존성 방지) */
export { WRONG_FEEDBACK_PLACEHOLDER };

/**
 * [3] 데이터 마스킹 정책
 * - Premium: 마스킹 없음
 * - Guest / Free: aiExplanation만 삭제. wrongFeedback은 유지 (결과 화면에서 오답 상위 2개에 한해 노출)
 */
export function maskQuestionData(
  questions: Question[],
  userGrade: UserGrade
): Question[] {
  if (userGrade === 'Premium') {
    return questions;
  }

  return questions.map((q) => {
    const masked = { ...q };
    delete masked.aiExplanation;
    return masked;
  });
}

/** User → UserGrade 변환 (해당 certId 기준) */
function getUserGradeForCert(user: User | null, certId: string): UserGrade {
  if (!user) return 'Guest';
  if (user.isAdmin) return 'Premium'; // Admin: 마스킹 없이 전체 데이터
  const isPaid = user.paidCertIds?.includes(certId) ?? false;
  const isExpired = user.expiredCertIds?.includes(certId) ?? false;
  const hasSub = user.subscriptions.some((s) => s.id === certId);

  if (!hasSub) return 'Guest';
  if (isPaid && isExpired) return 'Expired';
  if (isPaid) return 'Premium';
  return 'Free';
}

/** BIGDATA 문항 경로: question_pools/contents_1681/questions/{q_id} (collectionGroup 인덱스 없어도 getDoc으로 조회) */
const BIGDATA_QUESTION_POOL_ID = 'contents_1681';

/**
 * [1] 실제 DB 구조 기반 문제 가져오기 (static exam)
 * - BIGDATA: 직접 경로 getDoc (인덱스 불필요, 취약유형/취약개념 집중학습 안정화)
 * - 그 외: collectionGroup('questions') + where('q_id', 'in', chunk)
 */
export async function fetchQuestionsFromPools(certCode: string, qIds: string[]): Promise<Question[]> {
  if (qIds.length === 0) return [];

  if (certCode === 'BIGDATA') {
    const poolId = BIGDATA_QUESTION_POOL_ID;
    const results: Question[] = [];
    for (let i = 0; i < qIds.length; i += IN_QUERY_LIMIT) {
      const chunk = qIds.slice(i, i + IN_QUERY_LIMIT);
      const snaps = await Promise.all(
        chunk.map((qId) => getDoc(doc(db, 'certifications', certCode, 'question_pools', poolId, 'questions', qId)))
      );
      snaps.forEach((snap, j) => {
        const qId = chunk[j];
        if (snap.exists()) {
          const data = snap.data() as FirestoreQuestionDoc;
          results.push(mapPoolDocToQuestion(qId, data));
        }
      });
    }
    const orderMap = new Map(results.map((q) => [q.id, q]));
    const ordered = qIds.map((id) => orderMap.get(id)).filter(Boolean) as Question[];
    return ordered;
  }

  const chunks: string[][] = [];
  for (let i = 0; i < qIds.length; i += IN_QUERY_LIMIT) {
    chunks.push(qIds.slice(i, i + IN_QUERY_LIMIT));
  }

  const queries = chunks.map((chunk) =>
    getDocs(query(collectionGroup(db, 'questions'), where('q_id', 'in', chunk)))
  );
  const snaps = await Promise.all(queries);
  const results: Question[] = [];

  for (const snap of snaps) {
    snap.docs.forEach((d) => {
      const data = d.data() as FirestoreQuestionDoc;
      results.push(mapPoolDocToQuestion(d.id, data));
    });
  }

  const orderMap = new Map(results.map((q) => [q.id, q]));
  return qIds.map((id) => orderMap.get(id)).filter(Boolean) as Question[];
}

/** Round별 Static 문항 수 폴백 (certification_info 없을 때만 사용) */
const STATIC_QUESTIONS_PER_ROUND: Record<number, number> = {
  1: 80,
  2: 80,
  3: 80,
};

/**
 * index 항목을 해당 회차(round)만 필터링
 */
function filterIndexByRound(items: QuestionIndexItem[] | null, round: number): QuestionIndexItem[] {
  if (!items || items.length === 0) return [];
  return items.filter((item) => (item.metadata?.round ?? 99) === round);
}

/** metadata에서 정렬용 숫자 추출 (subject, core_id) */
function getSubjectAndCore(item: QuestionIndexItem): { subject: number; core_id: number } {
  const subject = item.metadata?.subject;
  const core = item.metadata?.core_id;
  return {
    subject: typeof subject === 'number' ? subject : parseInt(String(subject ?? 99), 10) || 99,
    core_id: typeof core === 'number' ? core : parseInt(String(core ?? 0), 10) || 0,
  };
}

/**
 * Static 회차용: 과목 순(S1→S2→S3→S4), 같은 과목 내 개념 순(core_id 오름차순)으로 정렬 후 앞에서 needCount개 q_id 반환
 */
function pickStaticRoundIdsInOrder(items: QuestionIndexItem[], count: number): string[] {
  if (items.length === 0 || count <= 0) return [];
  const sorted = [...items].sort((a, b) => {
    const { subject: sa, core_id: ca } = getSubjectAndCore(a);
    const { subject: sb, core_id: cb } = getSubjectAndCore(b);
    if (sa !== sb) return sa - sb;
    return ca - cb;
  });
  return sorted.slice(0, count).map((x) => x.q_id);
}

/**
 * getQuestionsForRound (UserRound 기반 박제 흐름)
 * 1. user_rounds/{round} 존재 시 → 고정된 questionIds로 즉시 반환
 * 2. 없으면: Static(1~3) vs 맞춤형(round >= 6, Zone 기반) 판단 후 생성
 * 3. UserRound 저장(트랜잭션으로 중복 방지) 후 반환
 */
export async function getQuestionsForRound(
  certId: string,
  round: number,
  user: User | null
): Promise<Question[]> {
  if (!CERT_IDS_WITH_QUESTIONS.includes(certId)) {
    throw new Error('해당 과목은 현재 준비중입니다.');
  }

  const cert = CERTIFICATIONS.find((c) => c.id === certId);
  if (!cert) throw new Error('해당 자격증을 찾을 수 없습니다.');
  const certCode = cert.code;

  const grade = getUserGradeForCert(user, certId);

  /** [1] 유저 있고 UserRound 존재 → 즉시 반환 */
  if (user) {
    const userRoundRef = doc(db, 'users', user.id, 'user_rounds', String(round));
    const userRoundSnap = await getDoc(userRoundRef);
    if (userRoundSnap.exists()) {
      const data = userRoundSnap.data() as UserRound;
      const qIds = Array.isArray(data.questionIds) ? data.questionIds : [];
      if (qIds.length > 0) {
        const questions = await fetchQuestionsFromPools(certCode, qIds);
        if (questions.length > 0) return maskQuestionData(questions, grade);
      }
    }
  }

  /** [2] Static(1~3) vs 맞춤형(6+) 판단 */
  const useStatic = round <= 3;

  let questions: Question[];
  let sourceRounds: number[];

  if (useStatic) {
    /** Static 1~3: index 캐시만 사용. 회차(round)별로 index 필터 후 문항 수는 certification_info 또는 폴백 사용 */
    let needCount = STATIC_QUESTIONS_PER_ROUND[round] ?? 80;
    if (round <= 3) {
      try {
        const certInfo = await getCertificationInfo(certCode);
        const subjects = certInfo?.subjects;
        if (Array.isArray(subjects) && subjects.length > 0) {
          const total = subjects.reduce((s, c) => s + (c.question_count ?? 0), 0);
          if (total > 0) needCount = total;
        }
      } catch {
        // certInfo 실패 시 위 needCount 유지
      }
    }
    let indexItems = await getQuestionIndexFromCache(certCode);
    if (!indexItems || indexItems.length === 0) {
      await syncQuestionIndex(certCode);
      indexItems = await getQuestionIndexFromCache(certCode);
    }
    const roundFiltered = filterIndexByRound(indexItems ?? [], round);
    if (roundFiltered.length < needCount) {
      throw new Error(
        `Round_${round} 문제를 불러오려면 인덱스에 해당 회차 문항이 필요합니다. ` +
        `(회차 ${round} 문항: ${roundFiltered.length}건, 필요: ${needCount}건). ` +
        `Firebase Storage/Firestore에 index가 업로드되어 있는지 확인하고 다시 시도해 주세요.`
      );
    }
    const qIds = pickStaticRoundIdsInOrder(roundFiltered, needCount);
    questions = await fetchQuestionsFromPools(certCode, qIds);
    if (questions.length < qIds.length) throw new Error(`문제 로딩 실패: ${qIds.length}개 중 ${questions.length}개만 불러왔습니다.`);
    sourceRounds = [round];
  } else {
    /** 맞춤형: round >= 6 → 큐레이션 기반 생성 후 user_rounds 저장 */
    if (!user) throw new Error('맞춤형 모의고사는 로그인이 필요합니다.');
    questions = await fetchAdaptiveQuestions(user.id, certId, user, round);
    sourceRounds = [round];
  }

  /** [3] UserRound 저장: 이미 있으면 덮어쓰지 않음. 트랜잭션 대신 getDoc → 없을 때만 setDoc 으로 409 방지 */
  if (user && questions.length > 0) {
    const userRoundRef = doc(db, 'users', user.id, 'user_rounds', String(round));
    const beforeWrite = await getDoc(userRoundRef);
    if (beforeWrite.exists()) {
      const data = beforeWrite.data() as UserRound;
      const qIds = Array.isArray(data.questionIds) ? data.questionIds : [];
      if (qIds.length > 0) {
        const existingQuestions = await fetchQuestionsFromPools(certCode, qIds);
        if (existingQuestions.length > 0) return maskQuestionData(existingQuestions, grade);
      }
    }
    const userRoundData: UserRound = {
      roundNum: round,
      sourceRounds,
      questionIds: questions.map((q) => q.id),
      createdAt: new Date().toISOString(),
    };
    await setDoc(userRoundRef, userRoundData);
  }

  return maskQuestionData(questions, grade);
}

/**
 * Round 6+ 맞춤형 문제 Fetch — aiRoundCurationService를 동적 로드해 순환 의존성 제거.
 * Quiz 등에서는 이 함수만 사용하고 aiRoundCurationService를 직접 import하지 말 것.
 */
export async function fetchAdaptiveQuestions(
  uid: string,
  certId: string,
  user: User | null,
  round: number,
  curationMode?: 'REAL_EXAM' | 'WEAKNESS_ATTACK'
): Promise<Question[]> {
  const m = await import('./aiRoundCurationService');
  return m.fetchAdaptiveQuestions(uid, certId, user, round, curationMode);
}

const WEAKNESS_RETRY_MAX = 50;
const WEAKNESS_RETRY_HALF = Math.floor(WEAKNESS_RETRY_MAX / 2); // 25

/**
 * 오답 다시풀기 세트(50문항): '가장 최근에 틀린 문제' 50% + 'Elo 점수 가장 낮은 취약 문제' 50%
 * - orderBy 'core_concept': 취약 50% = core_concept_stats proficiency 낮은 순
 * - orderBy 'problem_type': 취약 50% = problem_type_stats proficiency 낮은 순
 */
export async function fetchWeaknessRetryQuestions(
  uid: string,
  certId: string,
  orderBy: 'core_concept' | 'problem_type' = 'core_concept'
): Promise<Question[]> {
  if (!CERT_IDS_WITH_QUESTIONS.includes(certId)) return [];
  const cert = CERTIFICATIONS.find((c) => c.id === certId);
  if (!cert) return [];
  const certCode = cert.code;

  const [answerSets, allPool, stats, wrongIdsByRecency] = await Promise.all([
    fetchExamResultAnswerSets(uid, certCode),
    fetchAllPoolQuestions(certCode),
    fetchStatsDoc(uid, certCode),
    fetchWrongIdsByRecency(uid, certCode),
  ]);
  const { wrongIds } = answerSets;
  if (wrongIds.size === 0) return [];

  const wrongQuestions = allPool.filter((q) => wrongIds.has(q.id));

  // 50%: 가장 최근에 틀린 순 (최대 25문항)
  const recentHalf = wrongIdsByRecency.filter((id) => wrongIds.has(id)).slice(0, WEAKNESS_RETRY_HALF);
  const used = new Set(recentHalf);

  // 50%: Elo(proficiency) 가장 낮은 취약 문제 25문항 (중복 제외)
  const weakHalf: string[] = [];
  if (orderBy === 'problem_type') {
    const ptStats = (stats.problem_type_stats ?? {}) as Record<string, { proficiency?: number }>;
    const getProficiency = (q: Question): number => {
      const types = q.problem_types ?? [];
      if (types.length === 0) return 9999;
      const min = Math.min(...types.map((t) => ptStats[t]?.proficiency ?? 9999));
      return min;
    };
    const sorted = [...wrongQuestions].sort((a, b) => getProficiency(a) - getProficiency(b));
    for (const q of sorted) {
      if (weakHalf.length >= WEAKNESS_RETRY_HALF) break;
      if (!used.has(q.id)) {
        used.add(q.id);
        weakHalf.push(q.id);
      }
    }
  } else {
    const conceptStats = stats.core_concept_stats ?? (stats as UserStatsForCert & { hierarchy_stats?: Record<string, { proficiency?: number }> }).hierarchy_stats ?? {};
    const getProficiency = (q: Question): number =>
      conceptStats[(q.core_concept ?? '').trim() || '기타']?.proficiency ?? 9999;
    const sorted = [...wrongQuestions].sort((a, b) => getProficiency(a) - getProficiency(b));
    for (const q of sorted) {
      if (weakHalf.length >= WEAKNESS_RETRY_HALF) break;
      if (!used.has(q.id)) {
        used.add(q.id);
        weakHalf.push(q.id);
      }
    }
  }

  let combinedIds = [...recentHalf, ...weakHalf];
  if (combinedIds.length < WEAKNESS_RETRY_MAX) {
    const rest = wrongIdsByRecency.filter((id) => !used.has(id));
    for (const id of rest) {
      if (combinedIds.length >= WEAKNESS_RETRY_MAX) break;
      combinedIds.push(id);
    }
  }
  if (combinedIds.length < WEAKNESS_RETRY_MAX) {
    const remaining = wrongQuestions.filter((q) => !used.has(q.id)).map((q) => q.id);
    for (const id of shuffleArray(remaining)) {
      if (combinedIds.length >= WEAKNESS_RETRY_MAX) break;
      combinedIds.push(id);
    }
  }

  const finalIds = combinedIds.slice(0, WEAKNESS_RETRY_MAX);
  if (finalIds.length === 0) return [];
  return fetchQuestionsFromPools(certCode, finalIds);
}

const SUBJECT_RETRY_MAX = 20;

/** 과목 강화 학습: 20문항 (오답 우선 → 미풀이 우선 → 부족분 랜덤), 중복 없음 */
const SUBJECT_STRENGTH_TRAINING_MAX = 20;

/**
 * 과목 강화 학습용 문제 큐레이션 (총 20문항)
 * 1. 해당 과목 중 오답 이력 있는 문제 우선
 * 2. 해당 과목 중 아직 안 푼 문제 우선
 * 3. 부족분은 해당 과목 전체 풀에서 랜덤 채우기
 * 4. 한 세트 내 동일 문제 중복 없음
 */
export async function fetchSubjectStrengthTraining(
  uid: string,
  certId: string,
  subjectNumber: number
): Promise<Question[]> {
  if (!CERT_IDS_WITH_QUESTIONS.includes(certId)) return [];
  const cert = CERTIFICATIONS.find((c) => c.id === certId);
  if (!cert) return [];
  const certCode = cert.code;

  const [answerSets, allPool] = await Promise.all([
    fetchExamResultAnswerSets(uid, certCode),
    fetchAllPoolQuestions(certCode),
  ]);
  const { correctIds, wrongIds } = answerSets;

  const subjectPool = allPool.filter((q) => (q.subject_number ?? 1) === subjectNumber);
  if (subjectPool.length === 0) return [];

  const wrongInSubject = subjectPool.filter((q) => wrongIds.has(q.id));
  const notAttemptedInSubject = subjectPool.filter(
    (q) => !correctIds.has(q.id) && !wrongIds.has(q.id)
  );
  const seen = new Set<string>();
  const result: Question[] = [];

  for (const q of shuffleArray(wrongInSubject)) {
    if (result.length >= SUBJECT_STRENGTH_TRAINING_MAX) break;
    if (!seen.has(q.id)) {
      seen.add(q.id);
      result.push(q);
    }
  }
  for (const q of shuffleArray(notAttemptedInSubject)) {
    if (result.length >= SUBJECT_STRENGTH_TRAINING_MAX) break;
    if (!seen.has(q.id)) {
      seen.add(q.id);
      result.push(q);
    }
  }
  const rest = shuffleArray(subjectPool).filter((q) => !seen.has(q.id));
  for (const q of rest) {
    if (result.length >= SUBJECT_STRENGTH_TRAINING_MAX) break;
    result.push(q);
  }

  return shuffleArray(result).slice(0, SUBJECT_STRENGTH_TRAINING_MAX);
}

const SUBJECT_STRENGTH_50_TARGET = 50;

export type SubjectStrength50Result = { questions: Question[]; insufficient: boolean };

/** 과목별 배분 비율: 가장 낮은 이해도 50%, 나머지 20%, 10%, 10% (합 90%, 나머지 10%는 최저 과목에) → 50문항 기준 [30, 10, 5, 5] */
const SUBJECT_QUOTA_PCTS = [50, 20, 10, 10];

/**
 * 과목 강화 학습 (전체 4과목): 50문항 큐레이션
 * - 과목별 이해도(subject_stats.proficiency) 낮은 순으로 나열, 비율: 최저 50% / 그다음 20% / 10% / 10%
 * - 각 과목 내: 오답 우선 → 맞춘 문제 중 이해도 낮은 개념 위주 → 부족분 랜덤
 * - 과목별 이해도는 users/{uid}/stats/{certCode}.subject_stats 에 채점 시 갱신됨 (별도 필드 없이 동일 문서)
 */
export async function fetchSubjectStrengthTraining50(
  uid: string,
  certId: string
): Promise<SubjectStrength50Result> {
  if (!CERT_IDS_WITH_QUESTIONS.includes(certId)) return { questions: [], insufficient: true };
  const cert = CERTIFICATIONS.find((c) => c.id === certId);
  if (!cert) return { questions: [], insufficient: true };
  const certCode = cert.code;

  const [answerSets, allPool, stats, certInfo] = await Promise.all([
    fetchExamResultAnswerSets(uid, certCode),
    fetchAllPoolQuestions(certCode),
    fetchStatsDoc(uid, certCode),
    getCertificationInfo(certCode),
  ]);
  const { correctIds, wrongIds } = answerSets;
  const conceptStats = stats.core_concept_stats ?? (stats as UserStatsForCert & { hierarchy_stats?: Record<string, { total?: number; proficiency?: number }> }).hierarchy_stats ?? {};
  const subjectStats = stats.subject_stats ?? {};

  const subjectNumbers = (certInfo?.subjects ?? []).map((s) => s.subject_number);
  if (subjectNumbers.length === 0) {
    const hasSubj = new Set(allPool.map((q) => q.subject_number ?? 1));
    subjectNumbers.push(...Array.from(hasSubj).sort((a, b) => a - b));
  }
  if (subjectNumbers.length === 0) subjectNumbers.push(1);

  const getSubjectProficiency = (subjNum: number): number => {
    const ent = subjectStats[String(subjNum)];
    return ent?.proficiency != null && Number.isFinite(ent.proficiency) ? ent.proficiency : 9999;
  };
  const subjectOrder = subjectNumbers.slice().sort((a, b) => getSubjectProficiency(a) - getSubjectProficiency(b));

  const n = Math.min(4, subjectOrder.length);
  const pcts = SUBJECT_QUOTA_PCTS.slice(0, n);
  const remainder = 50 - pcts.reduce((s, p) => s + Math.round(50 * (p / 100)), 0);
  const quotas = subjectOrder.slice(0, n).map((_, i) => {
    let q = Math.round(50 * (pcts[i] / 100));
    if (i === 0 && remainder > 0) q += remainder;
    return q;
  });

  const wrongPool =
    wrongIds.size > 0 ? await fetchQuestionsFromPools(certCode, Array.from(wrongIds)) : [];
  const bySubjectWrong = new Map<number, Question[]>();
  const bySubjectCorrect = new Map<number, Question[]>();
  for (const q of wrongPool) {
    const s = q.subject_number ?? 1;
    if (!bySubjectWrong.has(s)) bySubjectWrong.set(s, []);
    bySubjectWrong.get(s)!.push(q);
  }
  for (const q of allPool) {
    if (wrongIds.has(q.id)) continue;
    if (!correctIds.has(q.id)) continue;
    const s = q.subject_number ?? 1;
    if (!bySubjectCorrect.has(s)) bySubjectCorrect.set(s, []);
    bySubjectCorrect.get(s)!.push(q);
  }

  const conceptOrder = Object.entries(conceptStats)
    .filter(([, v]) => (v.total ?? 0) > 0)
    .sort((a, b) => (a[1].proficiency ?? 9999) - (b[1].proficiency ?? 9999))
    .map(([c]) => c);
  const byConceptBySubject = new Map<number, Map<string, Question[]>>();
  for (const [subj, list] of bySubjectCorrect) {
    const byConcept = new Map<string, Question[]>();
    for (const q of list) {
      const c = (q.core_concept ?? '').trim() || '기타';
      if (!byConcept.has(c)) byConcept.set(c, []);
      byConcept.get(c)!.push(q);
    }
    byConceptBySubject.set(subj, byConcept);
  }

  const seen = new Set<string>();
  const orderedIds: string[] = [];

  for (let i = 0; i < subjectOrder.length && orderedIds.length < SUBJECT_STRENGTH_50_TARGET; i++) {
    const subj = subjectOrder[i];
    const quota = quotas[i] ?? 0;
    if (quota <= 0) continue;
    const startLen = orderedIds.length;
    const subjectCap = startLen + quota;

    const wrongList = shuffleArray(bySubjectWrong.get(subj) ?? []);
    for (const q of wrongList) {
      if (orderedIds.length >= subjectCap || orderedIds.length >= SUBJECT_STRENGTH_50_TARGET) break;
      if (!seen.has(q.id)) {
        seen.add(q.id);
        orderedIds.push(q.id);
      }
    }
    const byConcept = byConceptBySubject.get(subj);
    if (byConcept && orderedIds.length < subjectCap) {
      for (const c of conceptOrder) {
        if (orderedIds.length >= subjectCap) break;
        const bag = shuffleArray(byConcept.get(c) ?? []);
        for (const q of bag) {
          if (orderedIds.length >= subjectCap) break;
          if (!seen.has(q.id)) {
            seen.add(q.id);
            orderedIds.push(q.id);
          }
        }
      }
    }
    const correctList = shuffleArray(bySubjectCorrect.get(subj) ?? []).filter((q) => !seen.has(q.id));
    for (const q of correctList) {
      if (orderedIds.length >= subjectCap || orderedIds.length >= SUBJECT_STRENGTH_50_TARGET) break;
      orderedIds.push(q.id);
      seen.add(q.id);
    }
  }

  const questionIds = orderedIds.slice(0, SUBJECT_STRENGTH_50_TARGET);
  let questions = questionIds.length > 0 ? await fetchQuestionsFromPools(certCode, questionIds) : [];
  const idToIndex = new Map(questionIds.map((id, idx) => [id, idx]));
  questions = questions.slice().sort((a, b) => (idToIndex.get(a.id) ?? 999) - (idToIndex.get(b.id) ?? 999));
  const hasLearningHistory = correctIds.size + wrongIds.size >= 40;
  return {
    questions,
    insufficient: questions.length < SUBJECT_STRENGTH_50_TARGET && !hasLearningHistory,
  };
}

const WEAK_FOCUS_50_TARGET = 50;
export type WeakFocus50Result = { questions: Question[]; insufficient: boolean };

const WEAK_TYPE_MAX_TAGS = 5;

/**
 * 취약 유형 집중학습 (1회 이상 모의고사 후 학습결과 기반, 부족 모달 없음)
 * - 유형 순서: problem_type_stats 기준 이해도(proficiency) 낮은 순 → 1순위 취약, 2순위 취약, …
 * - 각 유형 내: 1순위 틀렸던 문제 → 2순위 맞춘 문제 → 3순위 이해도 기반 난이도 스캐폴딩 (최대 50개)
 * - 다음 유형에서 동일 방식 반복. 총 50개 또는 가용분만 반환.
 */
export async function fetchWeakTypeFocus50(
  uid: string,
  certId: string
): Promise<WeakFocus50Result> {
  if (!CERT_IDS_WITH_QUESTIONS.includes(certId)) return { questions: [], insufficient: true };
  const cert = CERTIFICATIONS.find((c) => c.id === certId);
  if (!cert) return { questions: [], insufficient: true };
  const certCode = cert.code;

  const [answerSets, allPool, stats] = await Promise.all([
    fetchExamResultAnswerSets(uid, certCode),
    fetchAllPoolQuestions(certCode),
    fetchStatsDoc(uid, certCode),
  ]);
  const { correctIds, wrongIds } = answerSets;
  const tagStats = stats.tag_stats ?? {};
  const problemTypeStats = (stats.problem_type_stats ?? {}) as Record<string, { correct?: number; total?: number; proficiency?: number }>;

  if (allPool.length === 0) {
    return { questions: [], insufficient: false };
  }

  const norm = (s: string) => sanitizeTagKey(String(s).trim());

  const tagEntries = Object.entries(tagStats)
    .filter(([, v]) => (v.total ?? 0) > 0)
    .sort((a, b) => (a[1].correct ?? 0) / (a[1].total ?? 1) - (b[1].correct ?? 0) / (b[1].total ?? 1));
  const mainTag = tagEntries.length > 0 ? norm(tagEntries[0][0]) : null;

  let topTagSet = new Set<string>(mainTag ? [mainTag] : []);
  if (mainTag) {
    const mainTagQuestions = allPool.filter((q) =>
      (q.tags ?? []).some((t) => norm(t) === mainTag)
    );
    const subjectCount: Record<number, number> = {};
    for (const q of mainTagQuestions) {
      const s = q.subject_number ?? 1;
      subjectCount[s] = (subjectCount[s] ?? 0) + 1;
    }
    const primarySubject =
      Object.entries(subjectCount).sort((a, b) => b[1] - a[1])[0]?.[0] != null
        ? Number(Object.entries(subjectCount).sort((a, b) => b[1] - a[1])[0][0])
        : 1;
    const tagsInSubject = new Set<string>();
    for (const q of allPool) {
      if ((q.subject_number ?? 1) !== primarySubject) continue;
      for (const t of q.tags ?? []) {
        tagsInSubject.add(norm(t));
      }
    }
    const otherInSubject = tagEntries
      .map(([t]) => norm(t))
      .filter((t) => t !== mainTag && tagsInSubject.has(t));
    const restTags = otherInSubject.slice(0, WEAK_TYPE_MAX_TAGS - 1);
    restTags.forEach((t) => topTagSet.add(t));
  }

  let typePool = allPool.filter((q) =>
    (q.tags ?? []).some((t) => topTagSet.has(norm(t)))
  );
  let wrongPoolById =
    wrongIds.size > 0 ? await fetchQuestionsFromPools(certCode, Array.from(wrongIds)) : [];
  let wrongInType = wrongPoolById.filter((q) =>
    (q.tags ?? []).some((t) => topTagSet.has(norm(t)))
  );

  let useProblemTypeFallback = false;
  if (typePool.length === 0 && wrongInType.length === 0) {
    const ptEntries = Object.entries(problemTypeStats)
      .filter(([, v]) => (v.total ?? 0) > 0)
      .sort((a, b) => (a[1].correct ?? 0) / (a[1].total ?? 1) - (b[1].correct ?? 0) / (b[1].total ?? 1));
    const mainPt = ptEntries.length > 0 ? String(ptEntries[0][0]).trim().replace(/[./\[\]*~]/g, '_') : null;
    if (mainPt) {
      const ptSet = new Set<string>([mainPt]);
      for (let i = 1; i < Math.min(WEAK_TYPE_MAX_TAGS, ptEntries.length); i++) {
        ptSet.add(String(ptEntries[i][0]).trim().replace(/[./\[\]*~]/g, '_'));
      }
      typePool = allPool.filter((q) =>
        (q.problem_types ?? []).some((pt) => ptSet.has(String(pt).trim().replace(/[./\[\]*~]/g, '_')))
      );
      wrongInType = wrongPoolById.filter((q) =>
        (q.problem_types ?? []).some((pt) => ptSet.has(String(pt).trim().replace(/[./\[\]*~]/g, '_')))
      );
      useProblemTypeFallback = true;
    }
  }

  const seen = new Set<string>();
  const resultIds: string[] = [];
  const TARGET = WEAK_FOCUS_50_TARGET;
  const normPt = (s: string) => String(s).trim().replace(/[./\[\]*~]/g, '_');
  const weakTypeOrder = Object.entries(problemTypeStats)
    .filter(([, v]) => (v.total ?? 0) > 0)
    .sort((a, b) => (a[1].proficiency ?? 1200) - (b[1].proficiency ?? 1200))
    .map(([k]) => normPt(k));
  if (weakTypeOrder.length === 0) {
    for (const q of allPool) {
      for (const pt of q.problem_types ?? []) {
        if (String(pt).trim()) weakTypeOrder.push(normPt(pt));
      }
    }
  }

  for (const typeKey of [...new Set(weakTypeOrder)]) {
    if (resultIds.length >= TARGET) break;
    const typePool = allPool.filter((q) =>
      (q.problem_types ?? []).some((pt) => normPt(pt) === typeKey)
    );
    const wrongInType = typePool.filter((q) => wrongIds.has(q.id));
    const correctInType = typePool.filter((q) => correctIds.has(q.id));
    for (const q of shuffleArray(wrongInType)) {
      if (resultIds.length >= TARGET || seen.has(q.id)) continue;
      seen.add(q.id);
      resultIds.push(q.id);
    }
    if (resultIds.length >= TARGET) break;
    for (const q of shuffleArray(correctInType)) {
      if (resultIds.length >= TARGET || seen.has(q.id)) continue;
      seen.add(q.id);
      resultIds.push(q.id);
    }
    if (resultIds.length >= TARGET) break;
    const typeProficiency01 = (() => {
      const ent = Object.entries(problemTypeStats).find(([k]) => normPt(k) === typeKey);
      if (!ent) return 0;
      const total = ent[1].total ?? 0;
      return total === 0 ? 0 : (ent[1].correct ?? 0) / total;
    })();
    const band = getProficiencyBand(typeProficiency01);
    const preferredLevels = getPreferredDifficultyLevels(band);
    const need = TARGET - resultIds.length;
    const added = pickByDifficultyThenFill(typePool, preferredLevels, seen, need, `취약유형(${typeKey})`);
    for (const q of added) {
      resultIds.push(q.id);
      seen.add(q.id);
    }
  }

  const questionIds = resultIds.slice(0, TARGET);
  const questions = questionIds.length > 0 ? await fetchQuestionsFromPools(certCode, questionIds) : [];
  const orderMap = new Map(questions.map((q) => [q.id, q]));
  const ordered = questionIds.map((id) => orderMap.get(id)).filter((q): q is Question => !!q);
  const bySubject = (a: Question, b: Question) => (a.subject_number ?? 1) - (b.subject_number ?? 1);
  const sorted = (ordered.length > 0 ? ordered : questions).slice().sort(bySubject);
  return { questions: sorted, insufficient: false };
}

/**
 * 취약 개념 집중학습: 이해도 낮은 개념 2~10개 Pool, 난이도 스캐폴딩 적용
 * - 취약 개념 분석 상위 3개와 동일한 기준으로 top3 도출 → 선정 개념에 최소 1개 포함, 해당 3개 개념 문제를 먼저 제공
 * - 1순위: 선정 Pool 내 오답 중 top3 개념 → 나머지 오답
 * - 2순위: top3 개념 Pool에서 난이도 매칭 → 나머지 개념에서 난이도 매칭
 * - 3순위: 난이도 해제 후 50개 채움
 */
export async function fetchWeakConceptFocus50(
  uid: string,
  certId: string
): Promise<WeakFocus50Result> {
  if (!CERT_IDS_WITH_QUESTIONS.includes(certId)) return { questions: [], insufficient: true };
  const cert = CERTIFICATIONS.find((c) => c.id === certId);
  if (!cert) return { questions: [], insufficient: true };
  const certCode = cert.code;

  const [answerSets, allPool, stats] = await Promise.all([
    fetchExamResultAnswerSets(uid, certCode),
    fetchAllPoolQuestions(certCode),
    fetchStatsDoc(uid, certCode),
  ]);
  const { wrongIds } = answerSets;
  const conceptStats = stats.core_concept_stats ?? (stats as UserStatsForCert & { hierarchy_stats?: Record<string, { total?: number; proficiency?: number }> }).hierarchy_stats ?? {};
  const subCoreIdStats = stats.sub_core_id_stats ?? {};

  const conceptOrder = Object.entries(conceptStats)
    .filter(([, v]) => (v.total ?? 0) > 0)
    .sort((a, b) => (a[1].proficiency ?? 9999) - (b[1].proficiency ?? 9999))
    .map(([c]) => c);

  // 취약 개념 분석 상위 3개와 동일 로직: sub_core_id → coreId 합산 후 이해도 낮은 순 3개, 없으면 core_concept_stats 상위 3개
  const coreAggFromSubCore: Record<string, { sumProficiency: number; total: number }> = {};
  for (const [subCoreId, ent] of Object.entries(subCoreIdStats)) {
    const coreId = subCoreId.includes('-') ? subCoreId.split('-')[0] : subCoreId;
    if (!coreAggFromSubCore[coreId]) coreAggFromSubCore[coreId] = { sumProficiency: 0, total: 0 };
    const prof = ent?.proficiency ?? 1200;
    const total = ent?.total ?? 0;
    coreAggFromSubCore[coreId].sumProficiency += prof * total;
    coreAggFromSubCore[coreId].total += total;
  }
  let top3CoreIds: Set<string> = new Set();
  let top3ConceptNames: Set<string> = new Set();
  if (Object.keys(coreAggFromSubCore).length > 0) {
    const sorted = Object.entries(coreAggFromSubCore)
      .filter(([, agg]) => agg.total >= 3)
      .map(([coreId, agg]) => {
        const avgProficiency = agg.total > 0 ? agg.sumProficiency / agg.total : 1200;
        return { coreId, avgProficiency };
      })
      .sort((a, b) => a.avgProficiency - b.avgProficiency)
      .slice(0, 3);
    top3CoreIds = new Set(sorted.map((s) => s.coreId));
  }
  if (top3CoreIds.size === 0 && conceptOrder.length > 0) {
    const fromConcept = Object.entries(conceptStats)
      .filter(([, v]) => (v.total ?? 0) >= 3 && (v.correct ?? 0) >= 1)
      .sort((a, b) => (a[1].proficiency ?? 9999) - (b[1].proficiency ?? 9999))
      .slice(0, 3)
      .map(([name]) => name);
    top3ConceptNames = new Set(fromConcept);
  }
  const conceptNamesFromTop3CoreIds = new Set<string>();
  if (top3CoreIds.size > 0) {
    for (const q of allPool) {
      const coreId = (q.sub_core_id ?? '').split('-')[0];
      if (coreId && top3CoreIds.has(coreId)) {
        const name = (q.core_concept ?? '').trim() || '기타';
        conceptNamesFromTop3CoreIds.add(name);
      }
    }
  }
  const top3AsConceptNames = top3CoreIds.size > 0 ? conceptNamesFromTop3CoreIds : top3ConceptNames;
  const isInTop3 = (q: Question) => {
    if (top3CoreIds.size > 0) {
      const coreId = (q.sub_core_id ?? '').split('-')[0];
      return coreId !== '' && top3CoreIds.has(coreId);
    }
    return top3ConceptNames.has((q.core_concept ?? '').trim() || '기타');
  };

  const maxConcepts = 10;
  let selectedConcepts: string[] = [...new Set([...top3AsConceptNames, ...conceptOrder.slice(0, 2).map(([c]) => c)])];
  for (let n = 2; n <= maxConcepts && n <= conceptOrder.length + top3AsConceptNames.size; n++) {
    const fromOrder = conceptOrder.slice(0, n).map(([c]) => c);
    const set = new Set([...top3AsConceptNames, ...fromOrder]);
    selectedConcepts = [...set];
    const poolSize = allPool.filter((q) => set.has((q.core_concept ?? '').trim() || '기타')).length;
    if (poolSize >= WEAK_FOCUS_50_TARGET) break;
  }
  const conceptSet = new Set(selectedConcepts);
  const conceptPool = allPool.filter((q) =>
    conceptSet.has((q.core_concept ?? '').trim() || '기타')
  );
  const wrongPoolById =
    wrongIds.size > 0 ? await fetchQuestionsFromPools(certCode, Array.from(wrongIds)) : [];
  const wrongInConcept = wrongPoolById.filter((q) =>
    conceptSet.has((q.core_concept ?? '').trim() || '기타')
  );
  if (conceptPool.length === 0 && wrongInConcept.length === 0) return { questions: [], insufficient: true };


  const seen = new Set<string>();
  const result: Question[] = [];

  const wrongInTop3 = wrongInConcept.filter((q) => isInTop3(q));
  const wrongInRest = wrongInConcept.filter((q) => !isInTop3(q));
  for (const q of shuffleArray(wrongInTop3)) {
    if (result.length >= WEAK_FOCUS_50_TARGET) break;
    if (!seen.has(q.id)) {
      seen.add(q.id);
      result.push(q);
    }
  }
  for (const q of shuffleArray(wrongInRest)) {
    if (result.length >= WEAK_FOCUS_50_TARGET) break;
    if (!seen.has(q.id)) {
      seen.add(q.id);
      result.push(q);
    }
  }
  if (result.length >= WEAK_FOCUS_50_TARGET) {
    const questionIds = result.map((q) => q.id);
    const questions = await fetchQuestionsFromPools(certCode, questionIds);
    return { questions, insufficient: false };
  }

  const worstConceptName = conceptOrder[0];
  const proficiency01 = worstConceptName
    ? eloToProficiency01(conceptStats[worstConceptName]?.proficiency)
    : 0;
  const band = getProficiencyBand(proficiency01);
  const preferredLevels = getPreferredDifficultyLevels(band);

  const need = WEAK_FOCUS_50_TARGET - result.length;
  const poolTop3 = conceptPool.filter((q) => isInTop3(q));
  const poolRest = conceptPool.filter((q) => !isInTop3(q));
  const addedFromTop3 = pickByDifficultyThenFill(poolTop3, preferredLevels, seen, need, '취약개념(top3)');
  result.push(...addedFromTop3);
  const stillNeed = WEAK_FOCUS_50_TARGET - result.length;
  if (stillNeed > 0) {
    const addedFromRest = pickByDifficultyThenFill(poolRest, preferredLevels, seen, stillNeed, '취약개념(나머지)');
    result.push(...addedFromRest);
  }

  if (result.length < WEAK_FOCUS_50_TARGET) {
    const restPool = shuffleArray(conceptPool).filter((q) => !seen.has(q.id));
    for (const q of restPool) {
      if (result.length >= WEAK_FOCUS_50_TARGET) break;
      result.push(q);
      seen.add(q.id);
    }
  }

  const questionIds = result.slice(0, WEAK_FOCUS_50_TARGET).map((q) => q.id);
  const questions = questionIds.length > 0 ? await fetchQuestionsFromPools(certCode, questionIds) : [];
  const bySubject = (a: Question, b: Question) => (a.subject_number ?? 1) - (b.subject_number ?? 1);
  const sorted = questions.slice().sort(bySubject);
  const insufficient = sorted.length < WEAK_FOCUS_50_TARGET;
  return { questions: sorted, insufficient };
}

/**
 * 과목별 다시풀기용 - 해당 과목 오답만 제공, 최대 20개 랜덤
 */
export async function fetchSubjectRetryQuestions(
  uid: string,
  certId: string,
  subjectNumber: number
): Promise<Question[]> {
  if (!CERT_IDS_WITH_QUESTIONS.includes(certId)) return [];
  const cert = CERTIFICATIONS.find((c) => c.id === certId);
  if (!cert) return [];
  const certCode = cert.code;

  const [answerSets, allPool] = await Promise.all([
    fetchExamResultAnswerSets(uid, certCode),
    fetchAllPoolQuestions(certCode),
  ]);
  const { wrongIds } = answerSets;
  if (wrongIds.size === 0) return [];

  const wrongQuestions = allPool.filter((q) => wrongIds.has(q.id));
  const bySubject = wrongQuestions.filter(
    (q) => (q.subject_number ?? 1) === subjectNumber
  );
  return shuffleArray(bySubject).slice(0, SUBJECT_RETRY_MAX);
}

/** 약점 공략 1회 사용 처리 (Firestore users 문서 업데이트) */
export async function markWeaknessTrialUsed(
  userId: string,
  certId: string
): Promise<void> {
  const userRef = doc(db, 'users', userId);
  const userSnap = await getDoc(userRef);
  if (!userSnap.exists()) return;

  const data = userSnap.data();
  const current = (data.weakness_trial_used as Record<string, boolean>) ?? {};
  if (current[certId]) return;

  await updateDoc(userRef, {
    weakness_trial_used: { ...current, [certId]: true },
  });
}
