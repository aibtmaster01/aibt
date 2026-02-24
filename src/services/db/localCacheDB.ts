/**
 * localCacheDB.ts
 * IndexedDB 기반 통합 로컬 캐시 (idb 사용)
 * - 캐시 삭제 전까지 다음날 접속해도 유지
 * - 서버 갱신은 수동 새로고침 또는 시험 제출 시
 */

import { openDB, DBSchema, IDBPDatabase } from 'idb';

// ========== 스토어 스키마 ==========

/** 문제 고르기용 메타데이터 (본문/옵션/해설 제외) */
export interface QuestionMetadataRecord {
  /** composite: certCode_q_id */
  id: string;
  certCode: string;
  q_id: string;
  subject_number?: number;
  hierarchy?: string;
  difficulty_level?: number;
  tags: string[];
  round?: number;
  trap_score: number;
  trend?: string | null;
  estimated_time_sec: number;
  problem_types?: string[];
  core_id?: string;
}

/** 마이페이지용 통계 캐시 (trend + dashboard 한 번에) */
export interface UserStatsCacheRecord {
  /** composite: uid_certCode */
  key: string;
  uid: string;
  certCode: string;
  trendData: import('../statsService').TrendDataItem[];
  recentPassRate: number;
  radarData: import('../statsService').RadarDataItem[];
  subjectScores: import('../statsService').SubjectScore[];
  weaknessTop2: import('../statsService').WeaknessItem[];
  lastUpdated: number;
  /** 서버에서 받은 updated_at(있을 경우) - 정합성 비교용 */
  serverUpdatedAt?: number | null;
}

/** 최근 시험 기록 캐시 (페이징용 리스트) */
export interface ExamResultsCacheRecord {
  /** composite: uid_examId */
  id: string;
  uid: string;
  certCode: string;
  examId: string;
  resultData: {
    roundId?: string | null;
    subject_scores?: Record<string, number>;
    is_passed?: boolean;
    predicted_pass_rate?: number;
    totalQuestions?: number;
    correctCount?: number;
    submittedAt?: number;
  };
  timestamp: number;
}

interface LocalCacheDBSchema extends DBSchema {
  questionMetadata: {
    key: string;
    value: QuestionMetadataRecord;
    indexes: { 'by_cert': string };
  };
  userStatsCache: {
    key: string;
    value: UserStatsCacheRecord;
    indexes: { 'by_uid': string };
  };
  examResultsCache: {
    key: string;
    value: ExamResultsCacheRecord;
    indexes: { 'by_uid': string; 'by_uid_cert': [string, string] };
  };
}

const DB_NAME = 'aibt_local_cache';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<LocalCacheDBSchema>> | null = null;

function getDB(): Promise<IDBPDatabase<LocalCacheDBSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<LocalCacheDBSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('questionMetadata')) {
          const meta = db.createObjectStore('questionMetadata', { keyPath: 'id' });
          meta.createIndex('by_cert', 'certCode', { unique: false });
        }
        if (!db.objectStoreNames.contains('userStatsCache')) {
          const stats = db.createObjectStore('userStatsCache', { keyPath: 'key' });
          stats.createIndex('by_uid', 'uid', { unique: false });
        }
        if (!db.objectStoreNames.contains('examResultsCache')) {
          const exam = db.createObjectStore('examResultsCache', { keyPath: 'id' });
          exam.createIndex('by_uid', 'uid', { unique: false });
          exam.createIndex('by_uid_cert', ['uid', 'certCode'], { unique: false });
        }
      },
    });
  }
  return dbPromise;
}

// ========== Question Metadata (큐레이션용) ==========

export async function getQuestionMetadataByCert(certCode: string): Promise<QuestionMetadataRecord[]> {
  const db = await getDB();
  const tx = db.transaction('questionMetadata', 'readonly');
  const index = tx.store.index('by_cert');
  return index.getAll(certCode);
}

export async function putQuestionMetadataBulk(items: QuestionMetadataRecord[]): Promise<void> {
  if (items.length === 0) return;
  const db = await getDB();
  const tx = db.transaction('questionMetadata', 'readwrite');
  for (const item of items) {
    await tx.store.put(item);
  }
  await tx.done;
}

export async function hasQuestionMetadataForCert(certCode: string): Promise<boolean> {
  const list = await getQuestionMetadataByCert(certCode);
  return list.length > 0;
}

export async function clearQuestionMetadataForCert(certCode: string): Promise<void> {
  const db = await getDB();
  const list = await getQuestionMetadataByCert(certCode);
  const tx = db.transaction('questionMetadata', 'readwrite');
  for (const r of list) {
    await tx.store.delete(r.id);
  }
  await tx.done;
}

// ========== User Stats Cache (마이페이지용) ==========

const CACHE_STALE_MS = 24 * 60 * 60 * 1000; // 24시간 - 다음날 접속해도 유지, 갱신은 수동/제출 시

export function getUserStatsCacheKey(uid: string, certCode: string): string {
  return `${uid}_${certCode}`;
}

export async function getUserStatsCache(
  uid: string,
  certCode: string
): Promise<UserStatsCacheRecord | null> {
  const db = await getDB();
  const key = getUserStatsCacheKey(uid, certCode);
  return db.get('userStatsCache', key) ?? null;
}

export async function setUserStatsCache(record: UserStatsCacheRecord): Promise<void> {
  const db = await getDB();
  await db.put('userStatsCache', record);
}

/** 마이페이지 캐시가 유효한지 (존재하고, 서버보다 오래되지 않았으면 유효). staleMs 넘으면 서버 재요청 권장 */
export function isUserStatsCacheValid(
  record: UserStatsCacheRecord | null,
  options?: { staleMs?: number }
): boolean {
  if (!record) return false;
  const staleMs = options?.staleMs ?? CACHE_STALE_MS;
  return Date.now() - record.lastUpdated < staleMs;
}

/** 시험 제출 후 해당 자격증 캐시 무효화 */
export async function invalidateMyPageCache(uid: string, certCode: string): Promise<void> {
  const key = getUserStatsCacheKey(uid, certCode);
  const db = await getDB();
  await db.delete('userStatsCache', key);
  // examResultsCache는 해당 cert만 삭제하거나, 다음 로드 시 서버에서 최신 8건 받아 덮어쓸 수 있음
  const tx = db.transaction('examResultsCache', 'readwrite');
  const index = tx.store.index('by_uid_cert');
  const toDelete = await index.getAll([uid, certCode]);
  for (const r of toDelete) {
    await tx.store.delete(r.id);
  }
  await tx.done;
}

// ========== Exam Results Cache (최근 시험 기록, limit 8 + 페이징) ==========

export async function getExamResultsCache(
  uid: string,
  certCode: string,
  limitCount: number = 8
): Promise<ExamResultsCacheRecord[]> {
  const db = await getDB();
  const index = db.transaction('examResultsCache', 'readonly').store.index('by_uid_cert');
  const all = await index.getAll([uid, certCode]);
  all.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
  return all.slice(0, limitCount);
}

export async function getExamResultsCachePage(
  uid: string,
  certCode: string,
  page: number,
  perPage: number = 8
): Promise<ExamResultsCacheRecord[]> {
  const db = await getDB();
  const index = db.transaction('examResultsCache', 'readonly').store.index('by_uid_cert');
  const all = await index.getAll([uid, certCode]);
  all.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
  const start = (page - 1) * perPage;
  return all.slice(start, start + perPage);
}

export async function getExamResultsCacheTotalCount(uid: string, certCode: string): Promise<number> {
  const db = await getDB();
  const index = db.transaction('examResultsCache', 'readonly').store.index('by_uid_cert');
  const all = await index.getAll([uid, certCode]);
  return all.length;
}

export async function putExamResultsCacheBulk(records: ExamResultsCacheRecord[]): Promise<void> {
  if (records.length === 0) return;
  const db = await getDB();
  const tx = db.transaction('examResultsCache', 'readwrite');
  for (const r of records) {
    await tx.store.put(r);
  }
  await tx.done;
}

// ========== 캐시 삭제 (설정 등에서 호출) ==========

export async function clearAllLocalCache(): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(
    ['questionMetadata', 'userStatsCache', 'examResultsCache'],
    'readwrite'
  );
  await tx.objectStore('questionMetadata').clear();
  await tx.objectStore('userStatsCache').clear();
  await tx.objectStore('examResultsCache').clear();
  await tx.done;
}
