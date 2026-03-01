/**
 * aiRoundCurationService.ts
 * Round 6 이상 맞춤형 큐레이션 엔진 (index 기반)
 * - Firestore 풀 쿼리 없음: localCacheDB의 index.json 배열 사용
 * - 3 Zone: 약점(낮은 proficiency sub_core_id) / 강점(높은 proficiency) / 랜덤
 * - 선발된 q_id 80개만 Firestore getDoc 병렬 조회 후 반환
 */

import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { Question, User } from '../types';
import { CERTIFICATIONS } from '../constants';

import { getCertificationInfo } from './gradingService';
import { generateAdaptiveExamPlan, extractTopicUnit, mapPoolDocToQuestion, type AiMockExamMode, type FirestoreQuestionDoc } from './examService';
import {
  getQuestionIndexFromCache,
  type QuestionIndexItem,
} from './db/localCacheDB';

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
  questionCount: number = ROUND5_TOTAL
): Promise<Question[]> {
  const certInfo = await getCertificationInfo(certCode);
  const totalTarget = certInfo?.subjects?.length
    ? certInfo.subjects.reduce((s, subj) => s + subj.question_count, 0)
    : questionCount;
  return generateIndexBasedExam(uid, certCode, totalTarget);
}

/**
 * Round 6+ 맞춤형 문제 Fetch (80문제)
 * @param curationMode 실전 대비형(REAL_EXAM) / 약점 강화형(WEAKNESS_ATTACK)
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

  return generateAdaptiveExam(uid, certCode, certId, targetExamDate, ROUND5_TOTAL);
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

  const isNew = isNewUser(user);

  const plan = await generateAdaptiveExamPlan(uid, certCode, targetExamDate);
  const mode = plan.mode as AiExamMode;
  const top1Unit = plan.plan[0]?.core_concept ?? null;

  const statsData = await fetchStatsForCert(uid, certCode);
  const conceptStats = statsData.core_concept_stats ?? (statsData as { hierarchy_stats?: Record<string, StatEntryLike> }).hierarchy_stats ?? {};
  const hasData = Object.keys(conceptStats).length > 0;
  let top1Proficiency: number | undefined;
  let top1Misconception: number | undefined;

  let avgProficiency = 0;
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
