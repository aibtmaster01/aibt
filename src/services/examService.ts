/**
 * examService.ts
 * - 실제 Firestore DB 구조 기반 문제 Fetching
 * - 회원 등급별 접근/마스킹 정책
 * - certifications/{certId}/question_pools/{대분류}/questions/{문제ID}
 *
 * --- Firestore 인덱스 (단일 필드, 콘솔에서만 생성 가능) ---
 * collectionGroup('questions') + where('q_id', 'in', chunk) 쿼리 사용 시
 * 아래 링크를 브라우저로 열어 "인덱스 생성" 버튼 클릭 후 Enabled 될 때까지 대기.
 * 프로젝트: aibt-99bc6
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
  runTransaction,
} from 'firebase/firestore';
import { db } from '../firebase';
import { Question, User, type ExamAnswerEntry, type UserRound } from '../types';
import { CERTIFICATIONS, CERT_IDS_WITH_QUESTIONS } from '../constants';
import { getDaysLeft, getDaysLeftForDate } from '../utils/dateUtils';
import { fetchUserTrendData } from './statsService';
import { to1BasedAnswer, wrongFeedbackTo1Based } from '../utils/questionUtils';
import {
  hasQuestionMetadataForCert,
  getQuestionMetadataByCert,
  putQuestionMetadataBulk,
  type QuestionMetadataRecord,
} from './db/localCacheDB';

const IN_QUERY_LIMIT = 30; // Firestore 'in' 쿼리 최대 30개 (대량 로딩 병렬화)

/** 시험 장부 문서 구조 - question_refs 사용 */
interface QuestionRef {
  q_id: string;
  difficulty?: number;
  hierarchy?: string;
}

interface StaticExamDoc {
  question_refs: QuestionRef[];
  title?: string;
  description?: string;
  round?: number;
  isPremium?: boolean;
  timeLimit?: number;
}

/** Firestore 문제 문서 실제 규격 (question_text, difficulty_level, q_id, hierarchy/topic 등) */
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
  /** 통계/큐레이션 1단계 분류 (우선 참조) */
  hierarchy?: string;
  /** 전체 경로 3단계 - 표시/하위 호환용 */
  topic?: string;
  random_id?: number;
  tags?: string[];
  trend?: string | null;
  estimated_time_sec?: number;
  trap_score?: number;
  problem_types?: string[];
  subject_number?: number;
  core_id?: string;
  round?: number;
  /** 문제 본문 표 (HTML 또는 { headers, rows }) */
  table_data?: string | { headers: string[]; rows: string[][] } | null;
  /** 난이도/함정 등 큐레이션용 (difficulty, trap_score, comp_diff 등) */
  stats?: Record<string, number>;
}

export type ExamAccessResult = { allowed: boolean; reason?: string };

/** hierarchy별 stat (stats.hierarchy_stats 항목 또는 약점 계획용) */
interface UserWeaknessStat {
  proficiency?: number;
  misconception_count?: number;
  last_attempted_at?: { toDate: () => Date };
}

/** users/{uid}/stats/{certCode} 문서 - hierarchy_stats, tag_stats, confused_qids 등 */
interface UserStatsForCert {
  hierarchy_stats?: Record<string, { correct?: number; total?: number; misconception_count?: number; proficiency?: number }>;
  tag_stats?: Record<string, { correct?: number; total?: number; misconception_count?: number }>;
  confused_qids?: string[];
  problem_type_stats?: Record<string, unknown>;
}

/** AI 모의고사 계획 - hierarchy별 출제 조건 */
export interface WeaknessPlanItem {
  hierarchy: string;
  difficultyLevels: number[];
  count: number;
}

/** generateAdaptiveExamPlan 반환 타입 */
export interface AdaptiveExamPlan {
  mode: 'REAL_EXAM_BALANCE' | 'WEAKNESS_ATTACK';
  plan: WeaknessPlanItem[];
  randomCount: number;
}

/**
 * 우선순위 점수 계산 (Priority Score)
 * Priority = (100 - Proficiency) × 0.5 + DaysSince × 0.3 + MisconceptionCount × 5 × 0.2
 * - Proficiency: 0~100 (eloToPercent 변환 후 사용 시)
 * - DaysSince: 마지막 시도 경과일
 * - MisconceptionCount: 헷갈림(오개념) 누적 횟수
 */
function calculatePriority(stat: UserWeaknessStat): number {
  const proficiency = stat.proficiency ?? 0;
  const misconceptionCount = stat.misconception_count ?? 0;

  let daysSince = 14;
  if (stat.last_attempted_at && typeof stat.last_attempted_at.toDate === 'function') {
    const lastDate = stat.last_attempted_at.toDate();
    daysSince = Math.floor((Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
  }

  return (100 - proficiency) * 0.5 + daysSince * 0.3 + misconceptionCount * 5 * 0.2;
}

/**
 * 단원명 정규화 (stats/ question_pools 문서 ID 매칭용)
 * 공백·대소문자 차이로 매칭 실패 방지
 */
export function normalizeUnitKey(s: string | undefined | null): string {
  if (!s || typeof s !== 'string') return '';
  return s.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * topic에서 학습 단원 추출 (stats/ question_pools 키와 매칭용)
 * "BIGDATA > 상관분석 > 시각화" → "상관분석"
 */
export function extractTopicUnit(topic: string | undefined): string | null {
  if (!topic || typeof topic !== 'string') return null;
  const parts = topic.split(' > ').map((s) => s.trim()).filter(Boolean);
  return parts.length >= 2 ? parts[1] : null;
}

/**
 * users/{uid}/stats/{certCode}에서 hierarchy_stats 기반 약점 스탯 Fetch
 */
async function fetchUserWeaknessStats(
  uid: string,
  certCode: string
): Promise<Record<string, UserWeaknessStat>> {
  const ref = doc(db, 'users', uid, 'stats', certCode);
  const snap = await getDoc(ref);
  if (!snap.exists()) return {};
  const data = snap.data() as UserStatsForCert;
  const hierarchyStats = data.hierarchy_stats ?? {};
  const out: Record<string, UserWeaknessStat> = {};
  for (const [key, entry] of Object.entries(hierarchyStats)) {
    if (!key) continue;
    out[key] = {
      proficiency: entry.proficiency,
      misconception_count: entry.misconception_count,
    };
  }
  return out;
}

/**
 * 5회차 AI 모의고사 계획 생성 (D-Day 기반 비율 조절)
 */
export async function generateAdaptiveExamPlan(
  uid: string,
  certCode: string,
  targetExamDate: string | null
): Promise<AdaptiveExamPlan> {
  const TOTAL_QUESTIONS = 80;

  let isRealExamMode = false;
  if (targetExamDate) {
    const daysLeft = Math.floor(
      (new Date(targetExamDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    );
    if (daysLeft <= 7) isRealExamMode = true;
  }

  const targetRatio = isRealExamMode ? 0.4 : 0.8;
  const weaknessQCount = Math.floor(TOTAL_QUESTIONS * targetRatio);
  const randomQCount = TOTAL_QUESTIONS - weaknessQCount;

  const userStats = await fetchUserWeaknessStats(uid, certCode);

  const rankedTopics = Object.entries(userStats)
    .map(([hierarchy, stat]) => ({
      hierarchy,
      proficiency: stat.proficiency ?? 0,
      priorityScore: calculatePriority(stat),
    }))
    .sort((a, b) => b.priorityScore - a.priorityScore)
    .slice(0, 3);

  const weaknessPlan: WeaknessPlanItem[] = rankedTopics.map((topic) => {
    const targetDifficulty = topic.proficiency < 50 ? [1, 2] : [3, 4, 5];
    return {
      hierarchy: topic.hierarchy,
      difficultyLevels: targetDifficulty,
      count: Math.floor(weaknessQCount / 3),
    };
  });

  return {
    mode: isRealExamMode ? 'REAL_EXAM_BALANCE' : 'WEAKNESS_ATTACK',
    plan: weaknessPlan,
    randomCount: randomQCount + (weaknessQCount % 3),
  };
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
 * Firestore 문제 문서 → Question 변환 (실제 필드 규격 반영)
 * - 모든 큐레이션/통계 기준: hierarchy 우선, 없을 때만 topic에서 단원 추출
 */
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
    estimated_time_sec:
      typeof data.estimated_time_sec === 'number' ? data.estimated_time_sec : 0,
    trap_score: typeof data.trap_score === 'number' ? data.trap_score : 0,
    problem_types: Array.isArray(data.problem_types) ? data.problem_types : undefined,
    subject_number: typeof data.subject_number === 'number' ? data.subject_number : undefined,
    difficulty_level: typeof data.difficulty_level === 'number' ? data.difficulty_level : undefined,
    core_id: typeof data.core_id === 'string' ? data.core_id : undefined,
    round: typeof data.round === 'number' ? data.round : undefined,
    tableData: data.table_data ?? undefined,
  };
}

/**
 * 계획(plan) 기반 question_pools에서 약점 문제 Fetch
 * - 분류는 hierarchy 기준 (풀 문서 ID = hierarchy). topic은 fallback용.
 * - 정규화(normalizeUnitKey)로 공백·대소문자 차이 매칭
 */
async function fetchWeaknessQuestions(
  certCode: string,
  plan: WeaknessPlanItem[],
  normToDocId: Map<string, string>
): Promise<Question[]> {
  const results: Question[] = [];
  for (const item of plan) {
    if (item.count <= 0) continue;
    const docId = normToDocId.get(normalizeUnitKey(item.hierarchy)) ?? item.hierarchy;
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

  // Fallback: collectionGroup에서 hierarchy 또는 topic으로 매칭 (hierarchy 우선)
  const topicPrefix = `${certCode} > `;
  for (const item of plan) {
    if (item.count <= 0) continue;
    const prefix = `${topicPrefix}${item.hierarchy}`;
    const q = query(
      collectionGroup(db, 'questions'),
      where('cert_id', '==', certCode),
      where('topic', '>=', prefix),
      where('topic', '<=', prefix + '\uf8ff'),
      limit(item.count * 3)
    );
    const snap = await getDocs(q);
    const itemNorm = normalizeUnitKey(item.hierarchy);
    const filtered = snap.docs
      .map((d) => ({ doc: d, data: d.data() as FirestoreQuestionDoc }))
      .filter(
        ({ data }) => {
          const unit = data.hierarchy?.trim() || extractTopicUnit(data.topic) || '';
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

export type AiMockExamMode = 'REAL_EXAM' | 'WEAKNESS_ATTACK';

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
    hierarchy: r.hierarchy,
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
 * (과목강화/취약유형/취약개념 등 강화 학습 호출 시 2000 read 방지)
 */
async function fetchAllPoolQuestions(certCode: string): Promise<Question[]> {
  const fromCache = await hasQuestionMetadataForCert(certCode);
  if (fromCache) {
    const records = await getQuestionMetadataByCert(certCode);
    return records.map(metadataToQuestionStub);
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

/** Firestore 필드명용 (tag_stats 키와 비교 시 사용) */
function sanitizeTagKey(s: string): string {
  return s.replace(/[./\[\]*~]/g, '_');
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
  const { getCertificationInfo } = await import('./gradingService');
  const certInfo = await getCertificationInfo(certCode);
  const subjectConfigs = certInfo?.subjects ?? [{ subject_number: 1, name: '전체', question_count: 80 }];
  const totalTarget = subjectConfigs.reduce((s, c) => s + (c.question_count ?? 0), 0) || TOTAL_QUESTIONS;

  const stats = await fetchStatsDoc(uid, certCode);
  const confusedQids = stats.confused_qids ?? [];
  const hierarchyStats = stats.hierarchy_stats ?? {};
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

  const hierarchyOrder = Object.entries(hierarchyStats)
    .filter(([, v]) => (v.total ?? 0) > 0)
    .sort((a, b) => (a[1].proficiency ?? 9999) - (b[1].proficiency ?? 9999))
    .map(([h]) => h);
  const zoneAByHierarchy = new Map<string, Question[]>();
  for (const q of zoneA) {
    const h = (q.hierarchy ?? '').trim() || '기타';
    if (!zoneAByHierarchy.has(h)) zoneAByHierarchy.set(h, []);
    zoneAByHierarchy.get(h)!.push(q);
  }
  const wrongQs: Question[] = [];
  for (const h of hierarchyOrder) {
    const bag = shuffleArray(zoneAByHierarchy.get(h) ?? []);
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
 * - WEAKNESS_ATTACK: 약점 강화형 3:3:4 (헷갈림 30%, 오답 hierarchy 30%, 취약 태그 40%)
 */
export async function generateAiMockExam(
  uid: string,
  certCode: string,
  targetExamDate: string | null,
  mode?: AiMockExamMode
): Promise<Question[]> {
  if (mode === 'REAL_EXAM') {
    const { getCertificationInfo } = await import('./gradingService');
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

  const weaknessQs = await fetchWeaknessQuestions(certCode, plan, normToDocId);
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
 * - Free: Round 1, 2만. Round 3+ 및 약점 공략(Round 5) 접근 불가
 * - Premium/Admin: Round 1~3(고정형), Round 4+(맞춤형) 모두 무제한
 */
export function checkExamAccess(params: {
  user: User | null;
  certId: string;
  round: number;
  isWeaknessRound?: boolean; // round 5 = 약점 공략
  weaknessTrialUsed?: boolean;
}): ExamAccessResult {
  const { user, certId, round, isWeaknessRound } = params;

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
    return { allowed: true }; // Round 1~4+ 모두 접근 가능
  }

  // === Free 시나리오 (무료 회원): Round 1, 2만. 약점 공략 1회 체험 제거 ===
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
/** 오답 가이드 비프리미엄 문구 (게스트/무료 공통) */
export const WRONG_FEEDBACK_PLACEHOLDER = '열공모드 가입 후 오답인 이유 확인하기';

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

/**
 * [1] 실제 DB 구조 기반 문제 가져오기 (static exam)
 * - collectionGroup('questions') + where('q_id', 'in', chunk) 사용
 * - 단일 필드 인덱스(q_id, 컬렉션 그룹) 필요 → Firebase 콘솔에서 설정
 */
export async function fetchQuestionsFromPools(certCode: string, qIds: string[]): Promise<Question[]> {
  if (qIds.length === 0) return [];

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

/**
 * getQuestionsForRound (UserRound 기반 박제 흐름)
 * 1. user_rounds/{round} 존재 시 → 고정된 questionIds로 즉시 반환
 * 2. 없으면: Static(1~5) vs 맞춤형(Zone 기반) 판단 후 생성
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

  /** [2] Static vs 맞춤형 판단 (round 4·5만 조건부) */
  let useStatic = round <= 3;
  if (round === 4 || round === 5) {
    const daysLeft = user?.passesByCert?.[certId]
      ? getDaysLeftForDate(user.passesByCert[certId].examDate)
      : getDaysLeft(certId);
    let recentPassRate = 0;
    if (user) {
      try {
        const trend = await fetchUserTrendData(user.id, certCode);
        recentPassRate = trend.recentPassRate ?? 0;
      } catch {
        recentPassRate = 0;
      }
    }
    const canUnlockFixed45 = daysLeft != null && daysLeft <= 3 && recentPassRate >= 70;
    useStatic = canUnlockFixed45;
  }

  let questions: Question[];
  let sourceRounds: number[];

  if (useStatic) {
    /** Static 1~5: static_exams에서 로드 */
    const examRef = doc(db, 'certifications', certCode, 'static_exams', `Round_${round}`);
    const examSnap = await getDoc(examRef);
    if (!examSnap.exists()) {
      throw new Error(
        `해당 회차(Round_${round}) 시험 장부를 찾을 수 없습니다. ` +
        `Firestore에 certifications/${certCode}/static_exams/Round_${round} 문서를 생성해 주세요.`
      );
    }
    const data = examSnap.data() as StaticExamDoc;
    const questionRefs = Array.isArray(data.question_refs) ? data.question_refs : [];
    const qIds = questionRefs.map((ref) => (ref && typeof ref === 'object' && 'q_id' in ref ? ref.q_id : '')).filter(Boolean);
    if (qIds.length === 0) throw new Error('시험 장부에 문제가 등록되어 있지 않습니다.');
    questions = await fetchQuestionsFromPools(certCode, qIds);
    if (questions.length < qIds.length) throw new Error(`문제 로딩 실패: ${qIds.length}개 중 ${questions.length}개만 불러왔습니다.`);
    sourceRounds = [round];
  } else {
    /** 맞춤형: round 4·5(조건 미달) 또는 round >= 6 → 약점 강화형 생성 후 user_rounds 저장 */
    if (!user) throw new Error('맞춤형 모의고사는 로그인이 필요합니다.');
    const { fetchAdaptiveQuestions } = await import('./aiRoundCurationService');
    questions = await fetchAdaptiveQuestions(user.id, certId, user, round, 'WEAKNESS_ATTACK');
    sourceRounds = [round];
  }

  /** [3] UserRound 저장: 기존 문서가 있을 때는 절대 덮어쓰지 않음 (재진입 시 동일 문제 세트 유지) */
  if (user && questions.length > 0) {
    const userRoundRef = doc(db, 'users', user.id, 'user_rounds', String(round));
    const userRoundData: UserRound = {
      roundNum: round,
      sourceRounds,
      questionIds: questions.map((q) => q.id),
      createdAt: new Date().toISOString(),
    };
    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(userRoundRef);
        if (!snap.exists()) {
          tx.set(userRoundRef, userRoundData);
        }
      });
    } catch (e) {
      const retrySnap = await getDoc(userRoundRef);
      if (retrySnap.exists()) {
        const data = retrySnap.data() as UserRound;
        const qIds = Array.isArray(data.questionIds) ? data.questionIds : [];
        if (qIds.length > 0) {
          const retryQuestions = await fetchQuestionsFromPools(certCode, qIds);
          if (retryQuestions.length > 0) return maskQuestionData(retryQuestions, grade);
        }
      }
      throw e;
    }
  }

  return maskQuestionData(questions, grade);
}

/**
 * Round 5(약점 공략) - AI 알고리즘 기반 맞춤형 80문제
 * - user 있음: generateAiMockExam (stats hierarchy_stats + D-Day 또는 실전/약점 모드)
 * - user 없음: static Round_5 장부 사용 (폴백)
 */
export async function getQuestionsForWeaknessRound(
  certId: string,
  user: User | null
): Promise<Question[]> {
  if (!CERT_IDS_WITH_QUESTIONS.includes(certId)) {
    throw new Error('해당 과목은 현재 준비중입니다.');
  }

  const cert = CERTIFICATIONS.find((c) => c.id === certId);
  if (!cert) throw new Error('해당 자격증을 찾을 수 없습니다.');
  const certCode = cert.code;

  if (user) {
    try {
      const targetExamDate = user.passesByCert?.[certId]?.examDate ?? user.targetExamDateByCert?.[certId] ?? null;
      const questions = await generateAiMockExam(user.id, certCode, targetExamDate);
      if (questions.length > 0) {
        return questions;
      }
    } catch {
      // AI 생성 실패 시 static 폴백
    }
  }

  return getQuestionsForRound(certId, 5, user);
}

const WEAKNESS_RETRY_MAX = 50;
const WEAKNESS_RETRY_HALF = Math.floor(WEAKNESS_RETRY_MAX / 2); // 25

/**
 * 오답 다시풀기 세트(50문항): '가장 최근에 틀린 문제' 50% + 'Elo 점수 가장 낮은 취약 문제' 50%
 * - orderBy 'hierarchy': 취약 50% = hierarchy_stats proficiency 낮은 순
 * - orderBy 'problem_type': 취약 50% = problem_type_stats proficiency 낮은 순
 */
export async function fetchWeaknessRetryQuestions(
  uid: string,
  certId: string,
  orderBy: 'hierarchy' | 'problem_type' = 'hierarchy'
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
    const hierarchyStats = stats.hierarchy_stats ?? {};
    const getProficiency = (q: Question): number =>
      hierarchyStats[(q.hierarchy ?? '').trim() || '기타']?.proficiency ?? 9999;
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

/**
 * 과목 강화 학습 (전체 4과목): 50문항 큐레이션
 * 1. 오답 우선 (전체 과목)
 * 2. 부족 시 맞춘 문제 중 이해도(proficiency) 낮은 hierarchy 개념 위주
 * 50미만이면 insufficient: true 반환 → 클라이언트에서 "데이터 부족" 팝업
 */
export async function fetchSubjectStrengthTraining50(
  uid: string,
  certId: string
): Promise<SubjectStrength50Result> {
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
  const hierarchyStats = stats.hierarchy_stats ?? {};

  const seen = new Set<string>();
  const result: Question[] = [];

  // 1) 오답 우선 (전체 과목) - 오답 ID로 직접 조회해 풀 2000개 제한에 걸리지 않도록
  const wrongPool =
    wrongIds.size > 0
      ? await fetchQuestionsFromPools(certCode, Array.from(wrongIds))
      : [];
  for (const q of shuffleArray(wrongPool)) {
    if (result.length >= SUBJECT_STRENGTH_50_TARGET) break;
    if (!seen.has(q.id)) {
      seen.add(q.id);
      result.push(q);
    }
  }

  // 2) 부족분: 맞춘 문제 중 이해도(proficiency) 낮은 개념 위주
  if (result.length < SUBJECT_STRENGTH_50_TARGET) {
    const correctPool = allPool.filter((q) => correctIds.has(q.id) && !seen.has(q.id));
    const hierarchyOrder = Object.entries(hierarchyStats)
      .filter(([, v]) => (v.total ?? 0) > 0)
      .sort((a, b) => (a[1].proficiency ?? 9999) - (b[1].proficiency ?? 9999))
      .map(([h]) => h);
    const byHierarchy = new Map<string, Question[]>();
    for (const q of correctPool) {
      const h = (q.hierarchy ?? '').trim() || '기타';
      if (!byHierarchy.has(h)) byHierarchy.set(h, []);
      byHierarchy.get(h)!.push(q);
    }
    for (const h of hierarchyOrder) {
      if (result.length >= SUBJECT_STRENGTH_50_TARGET) break;
      const bag = shuffleArray(byHierarchy.get(h) ?? []);
      for (const q of bag) {
        if (result.length >= SUBJECT_STRENGTH_50_TARGET) break;
        if (!seen.has(q.id)) {
          seen.add(q.id);
          result.push(q);
        }
      }
    }
    const remaining = shuffleArray(correctPool).filter((q) => !seen.has(q.id));
    for (const q of remaining) {
      if (result.length >= SUBJECT_STRENGTH_50_TARGET) break;
      result.push(q);
      seen.add(q.id);
    }
  }

  const picked = shuffleArray(result).slice(0, SUBJECT_STRENGTH_50_TARGET);
  const questionIds = picked.map((q) => q.id);
  const questions = questionIds.length > 0 ? await fetchQuestionsFromPools(certCode, questionIds) : [];
  return {
    questions,
    insufficient: questions.length < SUBJECT_STRENGTH_50_TARGET,
  };
}

const WEAK_FOCUS_50_TARGET = 50;
export type WeakFocus50Result = { questions: Question[]; insufficient: boolean };

/**
 * 취약 유형 집중학습: 유형 1,2,3위( tag_stats 정답률 하위 3개) 문제만 풀에서 50문항
 * - 오답 우선, 부족 시 맞춘 문제(이해도 낮은 개념 위주) 추가. 50 미만이면 insufficient
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
  const hierarchyStats = stats.hierarchy_stats ?? {};

  const top3WeakTags = Object.entries(tagStats)
    .filter(([, v]) => (v.total ?? 0) > 0)
    .sort((a, b) => (a[1].correct ?? 0) / (a[1].total ?? 1) - (b[1].correct ?? 0) / (b[1].total ?? 1))
    .slice(0, 3)
    .map(([t]) => sanitizeTagKey(t));
  const top3Set = new Set(top3WeakTags);
  const typePool = allPool.filter((q) =>
    (q.tags ?? []).some((t) => top3Set.has(sanitizeTagKey(t)))
  );
  const wrongPoolById =
    wrongIds.size > 0 ? await fetchQuestionsFromPools(certCode, Array.from(wrongIds)) : [];
  const wrongInType = wrongPoolById.filter((q) =>
    (q.tags ?? []).some((t) => top3Set.has(sanitizeTagKey(t)))
  );
  if (typePool.length === 0 && wrongInType.length === 0) return { questions: [], insufficient: true };

  const seen = new Set<string>();
  const result: Question[] = [];
  for (const q of shuffleArray(wrongInType)) {
    if (result.length >= WEAK_FOCUS_50_TARGET) break;
    if (!seen.has(q.id)) {
      seen.add(q.id);
      result.push(q);
    }
  }
  if (result.length < WEAK_FOCUS_50_TARGET) {
    const correctInType = typePool.filter((q) => correctIds.has(q.id) && !seen.has(q.id));
    const hierarchyOrder = Object.entries(hierarchyStats)
      .filter(([, v]) => (v.total ?? 0) > 0)
      .sort((a, b) => (a[1].proficiency ?? 9999) - (b[1].proficiency ?? 9999))
      .map(([h]) => h);
    const byHierarchy = new Map<string, Question[]>();
    for (const q of correctInType) {
      const h = (q.hierarchy ?? '').trim() || '기타';
      if (!byHierarchy.has(h)) byHierarchy.set(h, []);
      byHierarchy.get(h)!.push(q);
    }
    for (const h of hierarchyOrder) {
      if (result.length >= WEAK_FOCUS_50_TARGET) break;
      const bag = shuffleArray(byHierarchy.get(h) ?? []);
      for (const q of bag) {
        if (result.length >= WEAK_FOCUS_50_TARGET) break;
        if (!seen.has(q.id)) {
          seen.add(q.id);
          result.push(q);
        }
      }
    }
    const rest = shuffleArray(correctInType).filter((q) => !seen.has(q.id));
    for (const q of rest) {
      if (result.length >= WEAK_FOCUS_50_TARGET) break;
      result.push(q);
      seen.add(q.id);
    }
  }

  const picked = shuffleArray(result).slice(0, WEAK_FOCUS_50_TARGET);
  const questionIds = picked.map((q) => q.id);
  const questions = questionIds.length > 0 ? await fetchQuestionsFromPools(certCode, questionIds) : [];
  return { questions, insufficient: questions.length < WEAK_FOCUS_50_TARGET };
}

/**
 * 취약 개념 집중학습: 이해도 가장 낮은 개념 2~10개로 50문항
 * - 2개 개념만으로 풀 50개 이상이면 2개만 사용, 아니면 최대 10개까지 확장
 * - 오답 우선, 부족 시 맞춘 문제(이해도 낮은 순) 추가. 50 미만이면 insufficient
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
  const { correctIds, wrongIds } = answerSets;
  const hierarchyStats = stats.hierarchy_stats ?? {};

  const hierarchyOrder = Object.entries(hierarchyStats)
    .filter(([, v]) => (v.total ?? 0) > 0)
    .sort((a, b) => (a[1].proficiency ?? 9999) - (b[1].proficiency ?? 9999))
    .map(([h]) => h);
  const maxConcepts = 10;
  let selectedHierarchies: string[] = hierarchyOrder.slice(0, 2);
  for (let n = 2; n <= maxConcepts && n <= hierarchyOrder.length; n++) {
    const set = new Set(hierarchyOrder.slice(0, n));
    const poolSize = allPool.filter((q) => set.has((q.hierarchy ?? '').trim() || '기타')).length;
    selectedHierarchies = hierarchyOrder.slice(0, n);
    if (poolSize >= WEAK_FOCUS_50_TARGET) break;
  }
  const conceptSet = new Set(selectedHierarchies);
  const conceptPool = allPool.filter((q) =>
    conceptSet.has((q.hierarchy ?? '').trim() || '기타')
  );
  const wrongPoolById =
    wrongIds.size > 0 ? await fetchQuestionsFromPools(certCode, Array.from(wrongIds)) : [];
  const wrongInConcept = wrongPoolById.filter((q) =>
    conceptSet.has((q.hierarchy ?? '').trim() || '기타')
  );
  if (conceptPool.length === 0 && wrongInConcept.length === 0) return { questions: [], insufficient: true };

  const seen = new Set<string>();
  const result: Question[] = [];
  for (const q of shuffleArray(wrongInConcept)) {
    if (result.length >= WEAK_FOCUS_50_TARGET) break;
    if (!seen.has(q.id)) {
      seen.add(q.id);
      result.push(q);
    }
  }
  if (result.length < WEAK_FOCUS_50_TARGET) {
    const correctInConcept = conceptPool.filter((q) => correctIds.has(q.id) && !seen.has(q.id));
    const byHierarchy = new Map<string, Question[]>();
    for (const q of correctInConcept) {
      const h = (q.hierarchy ?? '').trim() || '기타';
      if (!byHierarchy.has(h)) byHierarchy.set(h, []);
      byHierarchy.get(h)!.push(q);
    }
    for (const h of selectedHierarchies) {
      if (result.length >= WEAK_FOCUS_50_TARGET) break;
      const bag = shuffleArray(byHierarchy.get(h) ?? []);
      for (const q of bag) {
        if (result.length >= WEAK_FOCUS_50_TARGET) break;
        if (!seen.has(q.id)) {
          seen.add(q.id);
          result.push(q);
        }
      }
    }
    const rest = shuffleArray(correctInConcept).filter((q) => !seen.has(q.id));
    for (const q of rest) {
      if (result.length >= WEAK_FOCUS_50_TARGET) break;
      result.push(q);
      seen.add(q.id);
    }
  }

  const picked = shuffleArray(result).slice(0, WEAK_FOCUS_50_TARGET);
  const questionIds = picked.map((q) => q.id);
  const questions = questionIds.length > 0 ? await fetchQuestionsFromPools(certCode, questionIds) : [];
  return { questions, insufficient: questions.length < WEAK_FOCUS_50_TARGET };
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
