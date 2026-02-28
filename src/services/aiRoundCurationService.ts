/**
 * aiRoundCurationService.ts
 * Round 4 이상 맞춤형 큐레이션 엔진 (index 기반)
 * - Firestore 풀 쿼리 없음: localCacheDB의 index.json 배열 사용
 * - 3 Zone: 약점(낮은 proficiency sub_core_id) / 강점(높은 proficiency) / 랜덤
 * - 선발된 q_id 80개(또는 20개)만 Firestore getDoc 병렬 조회 후 반환
 */

import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { Question, User } from '../types';
import { CERTIFICATIONS } from '../constants';
import { to1BasedAnswer, wrongFeedbackTo1Based } from '../utils/questionUtils';
import { getCertificationInfo } from './gradingService';
import { generateAdaptiveExamPlan, extractTopicUnit, type AiMockExamMode } from './examService';
import {
  getQuestionIndexFromCache,
  type QuestionIndexItem,
} from './db/localCacheDB';

const ROUND4_TOTAL = 20;
const ROUND5_TOTAL = 80;

/** 자격증별 question_pools 하위 풀 ID (getDoc 경로용) */
const QUESTION_POOL_ID_BY_CERT: Record<string, string> = {
  BIGDATA: 'contents_1681',
};

/** 3 Zone 비율: 약점 / 강점 / 랜덤 (합 1) */
const ZONE_RATIO_WEAKNESS = 0.4;
const ZONE_RATIO_STRENGTH = 0.3;
const ZONE_RATIO_RANDOM = 0.3;

/** stats.core_concept_stats / stats.tag_stats 항목 (Phase 2: stats 문서 사용) */
interface StatEntryLike {
  proficiency?: number;
  correct?: number;
  total?: number;
  misconception_count?: number;
}

/** Firestore 문제 문서 규격 (getDoc으로 조회한 문서) */
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
  core_concept?: string;
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

/** 취약 유형(problem_type) 상위 N개 — proficiency 낮은 순 (유형 큐레이션 시 우선 출제) */
const WEAK_TYPE_TOP_N = 3;

/**
 * index 기반 3 Zone 선발: 약점(낮은 sub_core_id proficiency) / 강점(높은) / 랜덤
 * + 취약 유형(problem_type_stats 낮은 순) 문항을 시험 앞쪽에 우선 배치
 */
async function selectQuestionIdsBy3Zones(
  certCode: string,
  uid: string,
  totalCount: number,
  mode?: AiMockExamMode
): Promise<string[]> {
  const items = await getQuestionIndexFromCache(certCode);
  if (!items || items.length === 0) return [];

  const stats = await fetchStatsForCert(uid, certCode);
  const subCoreStats = stats.sub_core_id_stats ?? {};
  const problemTypeStats = stats.problem_type_stats ?? {};
  const getProficiency = (subCoreId: string) => {
    const ent = subCoreStats[subCoreId];
    return ent?.proficiency ?? 1200;
  };

  const weakTypeSet = new Set<string>(
    Object.entries(problemTypeStats)
      .filter(([, v]) => (v.total ?? 0) > 0)
      .sort((a, b) => (a[1].proficiency ?? 1200) - (b[1].proficiency ?? 1200))
      .slice(0, WEAK_TYPE_TOP_N)
      .map(([key]) => String(key).trim())
  );
  const isWeakType = (it: QuestionIndexItem) => {
    const pt = it.metadata?.problem_type;
    return typeof pt === 'string' && pt.trim() && weakTypeSet.has(pt.trim());
  };

  const weakness: QuestionIndexItem[] = [];
  const strength: QuestionIndexItem[] = [];
  const random: QuestionIndexItem[] = [];
  for (const it of items) {
    const subId = it.metadata?.sub_core_id ?? '';
    const prof = subId ? getProficiency(subId) : 1200;
    if (subId && prof < 1150) weakness.push(it);
    else if (subId && prof >= 1250) strength.push(it);
    else random.push(it);
  }

  let nWeak = Math.round(totalCount * ZONE_RATIO_WEAKNESS);
  let nStrong = Math.round(totalCount * ZONE_RATIO_STRENGTH);
  let nRand = totalCount - nWeak - nStrong;
  if (mode === 'WEAKNESS_ATTACK') {
    nWeak = Math.min(totalCount, Math.round(totalCount * 0.5));
    nStrong = Math.round(totalCount * 0.2);
    nRand = totalCount - nWeak - nStrong;
  }

  const pick = (arr: QuestionIndexItem[], n: number, preferWeakType = false): string[] => {
    let list = [...arr];
    if (preferWeakType && weakTypeSet.size > 0) {
      list.sort((a, b) => (isWeakType(b) ? 1 : 0) - (isWeakType(a) ? 1 : 0));
    }
    const sh = shuffleArray(list);
    return sh.slice(0, n).map((x) => x.q_id);
  };
  const seen = new Set<string>();
  const add = (ids: string[]): string[] => {
    const out: string[] = [];
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    return out;
  };

  const w = add(pick(weakness, nWeak, true));
  const s = add(pick(strength, nStrong, true));
  const r = add(pick(random, nRand, true));
  let combined = [...w, ...s, ...r];
  if (combined.length < totalCount) {
    const rest = items.filter((it) => !seen.has(it.q_id));
    const extra = add(shuffleArray(rest).slice(0, totalCount - combined.length).map((x) => x.q_id));
    combined = [...combined, ...extra];
  }
  combined = combined.slice(0, totalCount);

  if (weakTypeSet.size > 0) {
    const qidToItem = new Map(items.map((it) => [it.q_id, it]));
    const weakTypeIds = new Set(
      combined.filter((id) => {
        const it = qidToItem.get(id);
        return it ? isWeakType(it) : false;
      })
    );
    const weakFirst = combined.filter((id) => weakTypeIds.has(id));
    const rest = combined.filter((id) => !weakTypeIds.has(id));
    return [...weakFirst, ...rest];
  }
  return combined;
}

/** index 항목의 과목 번호 (metadata.subject 또는 subject_number, 없으면 1) */
function getSubjectFromItem(it: QuestionIndexItem): number {
  const s = it.metadata?.subject ?? (it.metadata?.subject_number as number | undefined);
  return typeof s === 'number' && s >= 1 ? s : 1;
}

/**
 * 과목별 20개씩, 1→2→3→4 순서로 선발 (약점공략 모의고사 큐레이션용).
 * 각 과목 내부는 동일 3 Zone(약점/강점/랜덤) 비율 + 취약 유형 우선.
 */
async function selectQuestionIdsBy3ZonesPerSubject(
  certCode: string,
  uid: string,
  subjectQuotas: { subjectNumber: number; count: number }[],
  mode?: AiMockExamMode
): Promise<string[]> {
  const items = await getQuestionIndexFromCache(certCode);
  if (!items || items.length === 0) return [];

  const stats = await fetchStatsForCert(uid, certCode);
  const subCoreStats = stats.sub_core_id_stats ?? {};
  const problemTypeStats = stats.problem_type_stats ?? {};
  const getProficiency = (subCoreId: string) => {
    const ent = subCoreStats[subCoreId];
    return ent?.proficiency ?? 1200;
  };
  const weakTypeSet = new Set<string>(
    Object.entries(problemTypeStats)
      .filter(([, v]) => (v.total ?? 0) > 0)
      .sort((a, b) => (a[1].proficiency ?? 1200) - (b[1].proficiency ?? 1200))
      .slice(0, WEAK_TYPE_TOP_N)
      .map(([key]) => String(key).trim())
  );
  const isWeakType = (it: QuestionIndexItem) => {
    const pt = it.metadata?.problem_type;
    return typeof pt === 'string' && pt.trim() && weakTypeSet.has(pt.trim());
  };

  const result: string[] = [];
  const seen = new Set<string>();

  for (const { subjectNumber, count } of subjectQuotas) {
    const subItems = items.filter((it) => getSubjectFromItem(it) === subjectNumber);
    if (subItems.length === 0) continue;

    const weakness: QuestionIndexItem[] = [];
    const strength: QuestionIndexItem[] = [];
    const random: QuestionIndexItem[] = [];
    for (const it of subItems) {
      if (seen.has(it.q_id)) continue;
      const subId = it.metadata?.sub_core_id ?? '';
      const prof = subId ? getProficiency(subId) : 1200;
      if (subId && prof < 1150) weakness.push(it);
      else if (subId && prof >= 1250) strength.push(it);
      else random.push(it);
    }

    let nWeak = Math.round(count * (mode === 'WEAKNESS_ATTACK' ? 0.5 : ZONE_RATIO_WEAKNESS));
    let nStrong = Math.round(count * (mode === 'WEAKNESS_ATTACK' ? 0.2 : ZONE_RATIO_STRENGTH));
    let nRand = count - nWeak - nStrong;
    if (nRand < 0) nRand = 0;

    const pick = (arr: QuestionIndexItem[], n: number, preferWeakType = false): string[] => {
      let list = arr.filter((it) => !seen.has(it.q_id));
      if (preferWeakType && weakTypeSet.size > 0) {
        list.sort((a, b) => (isWeakType(b) ? 1 : 0) - (isWeakType(a) ? 1 : 0));
      }
      const sh = shuffleArray(list);
      return sh.slice(0, n).map((x) => x.q_id);
    };
    const add = (ids: string[]): string[] => {
      const out: string[] = [];
      for (const id of ids) {
        if (seen.has(id)) continue;
        seen.add(id);
        out.push(id);
      }
      return out;
    };

    const w = add(pick(weakness, nWeak, true));
    const s = add(pick(strength, nStrong, true));
    const r = add(pick(random, nRand, true));
    let combined = [...w, ...s, ...r];
    if (combined.length < count) {
      const rest = subItems.filter((it) => !seen.has(it.q_id));
      const extra = add(shuffleArray(rest).slice(0, count - combined.length).map((x) => x.q_id));
      combined = [...combined, ...extra];
    }
    result.push(...combined.slice(0, count));
  }

  if (weakTypeSet.size > 0) {
    const qidToItem = new Map(items.map((it) => [it.q_id, it]));
    const reordered: string[] = [];
    for (const { subjectNumber, count } of subjectQuotas) {
      const start = reordered.length;
      const segment = result.slice(start, start + count);
      const weakFirst = segment.filter((id) => {
        const it = qidToItem.get(id);
        return it ? isWeakType(it) : false;
      });
      const rest = segment.filter((id) => {
        const it = qidToItem.get(id);
        return !it || !isWeakType(it);
      });
      reordered.push(...weakFirst, ...rest);
    }
    return reordered.length ? reordered : result;
  }
  return result;
}

/**
 * 선발된 q_id에 대해 question_pools/{poolId}/questions/{q_id} getDoc 병렬 조회
 */
async function fetchQuestionsByIdsWithGetDoc(certCode: string, qIds: string[]): Promise<Question[]> {
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
    const qId = qIds[i];
    if (snap.exists()) {
      const data = snap.data() as FirestoreQuestionDoc;
      orderMap.set(qId, mapPoolDocToQuestion(qId, data));
    }
  });
  return qIds.map((id) => orderMap.get(id)).filter((q): q is Question => !!q);
}

/**
 * index 기반 3 Zone 선발 후 getDoc 병렬로 본문 로드 (Round 4: 20, Round 5: 80)
 * 80문항(약점공략) 시 과목별 20개씩 1→2→3→4 순서로 선발.
 */
export async function generateIndexBasedExam(
  uid: string,
  certCode: string,
  totalCount: number,
  mode?: AiMockExamMode
): Promise<Question[]> {
  let ids: string[];
  if (totalCount === ROUND5_TOTAL) {
    const certInfo = await getCertificationInfo(certCode);
    const subjects = certInfo?.subjects ?? [];
    const fourSubjects20 =
      subjects.length === 4 &&
      subjects.every((s) => (s.question_count ?? 0) >= 20) &&
      subjects.reduce((sum, s) => sum + (s.question_count ?? 0), 0) >= 80;
    if (fourSubjects20) {
      const subjectQuotas = subjects
        .slice(0, 4)
        .sort((a, b) => (a.subject_number ?? 1) - (b.subject_number ?? 1))
        .map((s) => ({ subjectNumber: s.subject_number ?? 1, count: 20 }));
      ids = await selectQuestionIdsBy3ZonesPerSubject(certCode, uid, subjectQuotas, mode);
    } else {
      ids = await selectQuestionIdsBy3Zones(certCode, uid, totalCount, mode);
    }
  } else {
    ids = await selectQuestionIdsBy3Zones(certCode, uid, totalCount, mode);
  }
  if (ids.length === 0) return [];
  return fetchQuestionsByIdsWithGetDoc(certCode, ids);
}

/**
 * Round 4+ 맞춤형 시험 생성: index 기반 3 Zone (약점/강점/랜덤) 비율 선발 후 getDoc 병렬 조회
 */
export async function generateAdaptiveExam(
  uid: string,
  certCode: string,
  _certId: string,
  _targetExamDate: string | null,
  questionCount: number = ROUND4_TOTAL
): Promise<Question[]> {
  const certInfo = await getCertificationInfo(certCode);
  const totalTarget = certInfo?.subjects?.length
    ? certInfo.subjects.reduce((s, subj) => s + subj.question_count, 0)
    : questionCount;
  return generateIndexBasedExam(uid, certCode, totalTarget);
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
    return generateIndexBasedExam(uid, certCode, ROUND5_TOTAL, curationMode);
  }

  return generateAdaptiveExam(uid, certCode, certId, targetExamDate, ROUND4_TOTAL);
}

/**
 * users/{uid}/stats/{certCode} 조회 (core_concept_stats, tag_stats, problem_type_stats)
 */
async function fetchStatsForCert(uid: string, certCode: string): Promise<{
  core_concept_stats?: Record<string, StatEntryLike>;
  sub_core_id_stats?: Record<string, StatEntryLike>;
  tag_stats?: Record<string, StatEntryLike>;
  problem_type_stats?: Record<string, StatEntryLike>;
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
 * 오버레이 메시지용 분석 컨텍스트 생성 (Phase 2: stats.core_concept_stats 기반)
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
  const top1Unit = plan.plan[0]?.core_concept ?? null;

  const statsData = await fetchStatsForCert(uid, certCode);
  const conceptStats = statsData.core_concept_stats ?? (statsData as { hierarchy_stats?: Record<string, StatEntryLike> }).hierarchy_stats ?? {};
  const hasData = Object.keys(conceptStats).length > 0;

  let avgProficiency = 0;
  let top1Proficiency: number | undefined;
  let top1Misconception: number | undefined;
  if (hasData) {
    const probs = Object.values(conceptStats).map((s) => s.proficiency ?? 0).filter((p) => p > 0);
    avgProficiency = probs.length > 0 ? probs.reduce((a, b) => a + b, 0) / probs.length : 0;
    if (top1Unit) {
      const topStat = conceptStats[top1Unit];
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
