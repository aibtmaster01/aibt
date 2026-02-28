/**
 * localCacheDB.ts
 * IndexedDB 기반 통합 로컬 캐시 (idb 사용)
 * - syncQuestionIndex: Storage index.json 다운로드 시도 → 실패 시(CORS 등) Firestore public/index 폴백
 */

import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { ref, getMetadata, getDownloadURL } from 'firebase/storage';
import { doc, getDoc } from 'firebase/firestore';
import { storage, db } from '../../firebase';

// ========== 스토어 스키마 ==========

/** Storage index.json 한 항목 (큐레이션용, 본문 제외) */
export interface QuestionIndexItem {
  q_id: string;
  metadata: {
    core_id?: number;
    subject?: number;
    problem_type?: string;
    tags?: string[];
    round?: number;
    sub_core_id?: string;
    [key: string]: unknown;
  };
  stats?: {
    trap_score?: number;
    trend?: number;
    estimated_time_sec?: number;
    difficulty?: number;
    [key: string]: unknown;
  };
}

/** 자격증별 질문 인덱스 캐시 (Storage index.json 동기화 결과) */
export interface QuestionIndexCacheRecord {
  certCode: string;
  items: QuestionIndexItem[];
  /** 서버 파일 기준 갱신 시각(ms). 새 버전 비교용 */
  serverUpdatedAt?: number;
}

/** 문제 고르기용 메타데이터 (본문/옵션/해설 제외) */
export interface QuestionMetadataRecord {
  /** composite: certCode_q_id */
  id: string;
  certCode: string;
  q_id: string;
  subject_number?: number;
  core_concept?: string;
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
  weaknessTop3: import('../statsService').WeaknessItem[];
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
  questionIndexCache: {
    key: string;
    value: QuestionIndexCacheRecord;
  };
}

const DB_NAME = 'aibt_local_cache';
const DB_VERSION = 2;

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
        if (!db.objectStoreNames.contains('questionIndexCache')) {
          db.createObjectStore('questionIndexCache', { keyPath: 'certCode' });
        }
      },
    });
  }
  return dbPromise;
}

// ========== Question Metadata (큐레이션용) ==========

/** BIGDATA: 기존 IndexedDB 메타데이터 캐시 미사용. 새 인덱스(Storage/Firestore)만 사용. */
const CERT_USE_NEW_INDEX_ONLY = 'BIGDATA';

export async function getQuestionMetadataByCert(certCode: string): Promise<QuestionMetadataRecord[]> {
  if (certCode === CERT_USE_NEW_INDEX_ONLY) return [];
  const db = await getDB();
  const tx = db.transaction('questionMetadata', 'readonly');
  const index = tx.store.index('by_cert');
  return index.getAll(certCode);
}

export async function putQuestionMetadataBulk(items: QuestionMetadataRecord[]): Promise<void> {
  if (items.length === 0) return;
  const certCode = items[0]?.certCode;
  if (certCode === CERT_USE_NEW_INDEX_ONLY) return;
  const db = await getDB();
  const tx = db.transaction('questionMetadata', 'readwrite');
  for (const item of items) {
    await tx.store.put(item);
  }
  await tx.done;
}

export async function hasQuestionMetadataForCert(certCode: string): Promise<boolean> {
  if (certCode === CERT_USE_NEW_INDEX_ONLY) {
    await clearQuestionMetadataForCert(certCode);
    return false;
  }
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
    ['questionMetadata', 'userStatsCache', 'examResultsCache', 'questionIndexCache'],
    'readwrite'
  );
  await tx.objectStore('questionMetadata').clear();
  await tx.objectStore('userStatsCache').clear();
  await tx.objectStore('examResultsCache').clear();
  if (tx.objectStoreNames.contains('questionIndexCache')) {
    await tx.objectStore('questionIndexCache').clear();
  }
  await tx.done;
}

// ========== Question Index (Storage index.json 동기화) ==========

const INDEX_STORAGE_PATH_BY_CERT: Record<string, string> = {
  BIGDATA: 'assets/BIGDATA/index.json',
};

/** Firestore 인덱스 문서 경로 (CORS 대안): certifications/{certCode}/public/index */
const INDEX_FIRESTORE_PATH_BY_CERT: Record<string, string> = {
  BIGDATA: 'BIGDATA',
};

/**
 * Firestore에서 index 로드 (Storage CORS 실패 시 폴백)
 */
async function fetchIndexFromFirestore(certCode: string): Promise<{ items: QuestionIndexItem[]; updatedAt: number } | null> {
  const pathCert = INDEX_FIRESTORE_PATH_BY_CERT[certCode];
  if (!pathCert) return null;
  try {
    const ref = doc(db, 'certifications', pathCert, 'public', 'index');
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    const data = snap.data();
    const items = Array.isArray(data?.items) ? data.items as QuestionIndexItem[] : null;
    if (!items || items.length === 0) return null;
    const raw = data?.updatedAt;
    let updatedAt = typeof (raw as { toMillis?: () => number })?.toMillis === 'function'
      ? (raw as { toMillis: () => number }).toMillis()
      : typeof (raw as { _seconds?: number })?._seconds === 'number'
        ? (raw as { _seconds: number })._seconds * 1000
        : typeof raw === 'number'
          ? raw
          : Date.now();
    return { items, updatedAt };
  } catch {
    return null;
  }
}

/**
 * IndexedDB에 저장된 index 캐시 조회
 */
export async function getQuestionIndexFromCache(certCode: string): Promise<QuestionIndexItem[] | null> {
  const db = await getDB();
  if (!db.objectStoreNames.contains('questionIndexCache')) return null;
  const rec = await db.get('questionIndexCache', certCode);
  return rec?.items ?? null;
}

/**
 * Firebase Storage의 index.json 다운로드 후 로컬 버전과 비교해 새 버전일 때만 IndexedDB에 저장.
 * 앱 기동 시 호출 권장.
 * @returns true = 다운로드/갱신함, false = 서버가 최신 아님 또는 실패
 */
export async function syncQuestionIndex(certCode: string): Promise<{ updated: boolean; itemCount: number }> {
  const path = INDEX_STORAGE_PATH_BY_CERT[certCode];
  const idb = await getDB();
  const existing = idb.objectStoreNames.contains('questionIndexCache')
    ? await idb.get('questionIndexCache', certCode)
    : null;

  let items: QuestionIndexItem[] | null = null;
  let serverUpdatedAt = 0;

  if (path) {
    try {
      const storageRef = ref(storage, path);
      const meta = await getMetadata(storageRef);
      serverUpdatedAt = meta.updated ? new Date(meta.updated).getTime() : Date.now();
      if (existing?.serverUpdatedAt != null && existing.serverUpdatedAt >= serverUpdatedAt) {
        return { updated: false, itemCount: existing.items?.length ?? 0 };
      }
      const url = await getDownloadURL(storageRef);
      const res = await fetch(url);
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json)) {
          items = json;
        } else if (json && Array.isArray((json as { items?: QuestionIndexItem[] }).items)) {
          items = (json as { items: QuestionIndexItem[] }).items;
          const rawUpdated = (json as { updatedAt?: number }).updatedAt;
          if (typeof rawUpdated === 'number') serverUpdatedAt = rawUpdated;
        }
      }
    } catch {
      /* Storage 실패 (CORS 등) → Firestore 폴백 */
    }
  }

  if (!items || items.length === 0) {
    const fromFirestore = await fetchIndexFromFirestore(certCode);
    if (fromFirestore && fromFirestore.items.length > 0) {
      items = fromFirestore.items;
      serverUpdatedAt = fromFirestore.updatedAt;
      if (existing?.serverUpdatedAt != null && existing.serverUpdatedAt >= serverUpdatedAt) {
        return { updated: false, itemCount: existing.items?.length ?? 0 };
      }
    }
  }

  if (!items || items.length === 0) {
    return { updated: false, itemCount: existing?.items?.length ?? 0 };
  }

  const record: QuestionIndexCacheRecord = {
    certCode,
    items,
    serverUpdatedAt,
  };
  if (idb.objectStoreNames.contains('questionIndexCache')) {
    await idb.put('questionIndexCache', record);
  }
  return { updated: true, itemCount: items.length };
}
