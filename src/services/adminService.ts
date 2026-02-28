import {
  collection,
  doc,
  updateDoc,
  getDoc,
  getDocs,
  setDoc,
  serverTimestamp,
  query,
  orderBy,
  limit,
  startAfter,
  documentId,
  onSnapshot,
  type DocumentSnapshot,
} from 'firebase/firestore';
import { sendPasswordResetEmail } from 'firebase/auth';
import { db, auth } from '../firebase';
import { CERTIFICATIONS, EXAM_SCHEDULES, EXAM_SCHEDULE_DATES } from '../constants';
import { User } from '../types';
import type { ExamScheduleItem } from '../types';

export interface AdminUser extends User {
  isBanned?: boolean;
  registeredDevices?: string[];
  adminMemo?: string;
  rawMemberships?: Record<string, MembershipEntry>;
}

export interface MembershipEntry {
  tier: 'PREMIUM' | 'FREE';
  expiry_date?: string;
  start_date?: string;
  target_schedule_id?: string;
}

function membershipsToUserFields(memberships: Record<string, MembershipEntry>) {
  const today = new Date().toISOString().slice(0, 10);
  const subIds: string[] = [];
  const paidCertIds: string[] = [];
  const expiredCertIds: string[] = [];

  for (const [code, entry] of Object.entries(memberships || {})) {
    const cert = CERTIFICATIONS.find((c) => c.code === code);
    if (!cert) continue;
    subIds.push(cert.id);
    if (entry.tier === 'PREMIUM') {
      if (entry.expiry_date && entry.expiry_date < today) {
        expiredCertIds.push(cert.id);
      } else {
        paidCertIds.push(cert.id);
      }
    }
  }

  const subscriptions = subIds
    .map((id) => CERTIFICATIONS.find((c) => c.id === id))
    .filter(Boolean) as import('../types').Certification[];

  return {
    subscriptions,
    paidCertIds,
    expiredCertIds,
    isPremium: paidCertIds.length > 0,
  };
}

function normalizeAdminUserName(docData: Record<string, unknown>): string {
  const familyName = (docData.familyName as string) || '';
  const givenName = (docData.givenName as string) || '';
  const legacyName = (docData.name as string) || '';
  if (familyName && givenName) return familyName + givenName;
  if (legacyName) return '김' + legacyName;
  return '김학습자';
}

function firestoreDocToAdminUser(uid: string, docData: Record<string, unknown>): AdminUser {
  const memberships = docData.memberships as Record<string, MembershipEntry> | undefined;
  const weaknessTrialUsed = docData.weakness_trial_used as Record<string, boolean> | undefined;
  const targetExamDateByCert = docData.target_exam_date_by_cert as Record<string, string> | undefined;
  const createdAt = docData.created_at as string | undefined;
  const isBanned = (docData.isBanned as boolean) ?? false;
  const registeredDevices = (docData.registered_devices as string[]) || [];
  const adminMemo = (docData.admin_memo as string) || '';
  const name = normalizeAdminUserName(docData);
  const familyName = (docData.familyName as string) || '김';
  const givenName = (docData.givenName as string) || name.replace(/^김/, '') || '학습자';

  const baseUser = {
    targetExamDateByCert,
    createdAt,
    weaknessTrialUsedByCert: weaknessTrialUsed,
    isBanned,
    registeredDevices,
    adminMemo,
    rawMemberships: memberships && typeof memberships === 'object' ? memberships : undefined,
  };

  if (memberships && typeof memberships === 'object') {
    const { subscriptions, paidCertIds, expiredCertIds, isPremium } = membershipsToUserFields(memberships);
    return {
      id: uid,
      email: (docData.email as string) || '',
      familyName,
      givenName,
      name,
      isAdmin: (docData.isAdmin as boolean) || false,
      isPremium,
      subscriptions,
      paidCertIds,
      expiredCertIds,
      ...baseUser,
    };
  }

  const subIds = (docData.subscriptionIds as string[]) || [];
  const subscriptions = subIds
    .map((id) => CERTIFICATIONS.find((c) => c.id === id))
    .filter(Boolean) as import('../types').Certification[];

  return {
    id: uid,
    email: (docData.email as string) || '',
    familyName,
    givenName,
    name,
    isAdmin: (docData.isAdmin as boolean) || false,
    isPremium: (docData.isPremium as boolean) || false,
    subscriptions,
    paidCertIds: (docData.paidCertIds as string[]) || [],
    expiredCertIds: (docData.expiredCertIds as string[]) || [],
    ...baseUser,
  };
}

export const USERS_PAGE_SIZE = 20;
const EXAM_RESULTS_READ_LIMIT = 500;

/**
 * 관리자: 유저 목록 페이지 단위 조회 (무제한 read 방지)
 * @param startAfterDoc 이전 페이지 마지막 문서. 없으면 첫 페이지
 */
export async function fetchUsersPage(
  pageSize: number = USERS_PAGE_SIZE,
  startAfterDoc?: DocumentSnapshot | null
): Promise<{ users: AdminUser[]; lastDoc: DocumentSnapshot | null; hasMore: boolean }> {
  const usersRef = collection(db, 'users');
  const q = startAfterDoc
    ? query(usersRef, orderBy(documentId()), limit(pageSize + 1), startAfter(startAfterDoc))
    : query(usersRef, orderBy(documentId()), limit(pageSize + 1));
  const snapshot = await getDocs(q);
  const docs = snapshot.docs;
  const hasMore = docs.length > pageSize;
  const pageDocs = hasMore ? docs.slice(0, pageSize) : docs;
  const users: AdminUser[] = [];
  pageDocs.forEach((docSnap) => {
    const data = docSnap.data();
    users.push(firestoreDocToAdminUser(docSnap.id, data || {}));
  });
  const lastDoc = pageDocs.length > 0 ? pageDocs[pageDocs.length - 1] : null;
  return { users, lastDoc, hasMore };
}

/** 실시간 구독 (최대 USERS_PAGE_SIZE명만 읽어 비용 제한). lastDoc은 '다음 페이지' 호출 시 사용 */
export function subscribeToUsers(
  callback: (users: AdminUser[], lastDoc: DocumentSnapshot | null) => void,
  onError?: (err: Error) => void
): () => void {
  const usersRef = collection(db, 'users');
  const q = query(usersRef, orderBy(documentId()), limit(USERS_PAGE_SIZE));
  return onSnapshot(
    q,
    (snapshot) => {
      const users: AdminUser[] = [];
      let last: DocumentSnapshot | null = null;
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        users.push(firestoreDocToAdminUser(docSnap.id, data || {}));
        last = docSnap;
      });
      callback(users, last);
    },
    (err) => {
      console.error('[Admin] subscribeToUsers error:', err);
      onError?.(err);
    }
  );
}

export interface MembershipUpdateInput {
  code: string;
  tier: 'PREMIUM' | 'FREE';
  startDate?: string;
  expiryDate?: string;
  targetScheduleId?: string;
}

export async function updateUserMemberships(
  uid: string,
  updates: MembershipUpdateInput[]
): Promise<void> {
  const userRef = doc(db, 'users', uid);
  const snap = await getDoc(userRef);
  if (!snap.exists()) throw new Error('사용자를 찾을 수 없습니다.');

  const data = snap.data();
  const existing = (data.memberships as Record<string, MembershipEntry>) || {};
  const targetExamDateByCert = (data.target_exam_date_by_cert as Record<string, string>) || {};

  const nextMemberships: Record<string, MembershipEntry> = { ...existing };
  const nextTargetExam: Record<string, string> = { ...targetExamDateByCert };

  for (const u of updates) {
    const cert = CERTIFICATIONS.find((c) => c.code === u.code);
    if (!cert) continue;
    nextMemberships[u.code] = {
      tier: u.tier,
      expiry_date: u.expiryDate || undefined,
      start_date: u.startDate || undefined,
      target_schedule_id: u.targetScheduleId || undefined,
    };
    if (u.targetScheduleId && EXAM_SCHEDULE_DATES[u.targetScheduleId]) {
      nextTargetExam[cert.id] = EXAM_SCHEDULE_DATES[u.targetScheduleId];
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const isPremium = Object.values(nextMemberships).some(
    (e) => e.tier === 'PREMIUM' && (!e.expiry_date || e.expiry_date >= today)
  );

  await updateDoc(userRef, {
    memberships: nextMemberships,
    isPremium,
    target_exam_date_by_cert: nextTargetExam,
  });
}

export async function updateUserBanned(uid: string, isBanned: boolean): Promise<void> {
  const userRef = doc(db, 'users', uid);
  await updateDoc(userRef, { isBanned });
}

export async function sendPasswordResetToUser(email: string): Promise<void> {
  await sendPasswordResetEmail(auth, email);
}

export async function clearUserDevices(uid: string): Promise<void> {
  const userRef = doc(db, 'users', uid);
  await updateDoc(userRef, { registered_devices: [] });
}

export async function updateUserAdminMemo(uid: string, memo: string): Promise<void> {
  const userRef = doc(db, 'users', uid);
  await updateDoc(userRef, { admin_memo: memo });
}

/**
 * 회원이 푼 총 문제 수 (exam_results의 totalQuestions 합계)
 * 퀴즈 완료 시 gradingService.submitQuizResult로 저장된 데이터 기준
 */
/** 오늘 날짜 (YYYY-MM-DD) 기준 당일 방문자 수 (유저별 1회) */
export async function fetchTodayVisitorCount(date: string): Promise<number> {
  const ref = collection(db, 'daily_visits', date, 'users');
  try {
    const snapshot = await getDocs(ref);
    return snapshot.size;
  } catch {
    return 0;
  }
}

/** 기간 내 일별 방문자 수 (startDate ~ endDate, YYYY-MM-DD) */
export async function fetchVisitorCountsForRange(
  startDate: string,
  endDate: string
): Promise<{ date: string; count: number }[]> {
  const result: { date: string; count: number }[] = [];
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (start > end) return result;
  const d = new Date(start);
  while (d <= end) {
    const dateStr = d.toISOString().slice(0, 10);
    const count = await fetchTodayVisitorCount(dateStr);
    result.push({ date: dateStr, count });
    d.setDate(d.getDate() + 1);
  }
  return result;
}

/** 오류 로그 문서 타입 (client_errors / error_logs 등에 저장된 항목) */
export interface ErrorLogEntry {
  id: string;
  message: string;
  stack?: string;
  userId?: string;
  userEmail?: string;
  url?: string;
  context?: string;
  timestamp: string; // ISO
}

/** Firestore error_logs 컬렉션에서 최근 오류 목록 조회 (관리자용) */
export async function fetchErrorLogs(limitCount: number = 100): Promise<ErrorLogEntry[]> {
  const ref = collection(db, 'error_logs');
  const q = query(ref, orderBy('timestamp', 'desc'), limit(limitCount));
  try {
    const snapshot = await getDocs(q);
    return snapshot.docs.map((docSnap) => {
      const d = docSnap.data();
      const ts = d.timestamp;
      return {
        id: docSnap.id,
        message: (d.message as string) || '',
        stack: d.stack as string | undefined,
        userId: d.userId as string | undefined,
        userEmail: d.userEmail as string | undefined,
        url: d.url as string | undefined,
        context: d.context as string | undefined,
        timestamp: ts?.toDate?.()?.toISOString?.() ?? (typeof ts === 'string' ? ts : ''),
      };
    });
  } catch {
    return [];
  }
}

/** 로그인 유저가 앱 방문 시 호출 - daily_visits/{date}/users/{uid} 에 merge 저장 (당일 1인 1회 집계) */
export async function recordVisit(uid: string): Promise<void> {
  const date = new Date().toISOString().slice(0, 10);
  const ref = doc(db, 'daily_visits', date, 'users', uid);
  try {
    await setDoc(ref, { at: serverTimestamp() }, { merge: true });
  } catch {
    // ignore
  }
}

export async function fetchUserQuestionCount(uid: string): Promise<number> {
  const examRef = collection(db, 'users', uid, 'exam_results');
  const q = query(examRef, orderBy('submittedAt', 'desc'), limit(EXAM_RESULTS_READ_LIMIT));
  let snapshot;
  try {
    snapshot = await getDocs(q);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const code = err && typeof err === 'object' && 'code' in err ? (err as { code?: string }).code : undefined;
    console.error(`[adminService] fetchUserQuestionCount 실패 (uid: ${uid}):`, {
      message,
      code,
      path: `users/${uid}/exam_results`,
      fullError: err,
    });
    return 0;
  }
  let total = 0;
  let docCount = 0;
  let missingTotalQuestions = 0;
  snapshot.forEach((docSnap) => {
    docCount++;
    const data = docSnap.data() as { totalQuestions?: number; certCode?: string; roundId?: string | null; answers?: unknown[] };
    const qCount = data?.totalQuestions ?? 0;
    if (qCount === 0 && data?.totalQuestions === undefined) {
      missingTotalQuestions++;
      console.warn(`[adminService] exam_results 문서에 totalQuestions 필드 없음: ${docSnap.id}`, {
        certCode: data?.certCode,
        roundId: data?.roundId,
        hasAnswers: Array.isArray(data?.answers),
      });
    }
    total += qCount;
  });
  if (docCount > 0 && missingTotalQuestions > 0) {
    console.warn(`[adminService] fetchUserQuestionCount: 총 ${docCount}개 문서 중 ${missingTotalQuestions}개에 totalQuestions 필드 없음 (uid: ${uid})`);
  }
  return total;
}

/** BIGDATA 자격증 시험회차/시험일/결과발표일 업로드 (certification_info.config에 merge) */
const BIGDATA_EXAM_SCHEDULES = [
  { year: 2026, round: 12, type: '필기', examDate: '2026-04-04', resultAnnouncementDate: '2026-04-24' },
  { year: 2026, round: 13, type: '필기', examDate: '2026-09-05', resultAnnouncementDate: '2026-09-23' },
];

export async function uploadBIGDATAExamSchedules(): Promise<void> {
  const ref = doc(db, 'certifications', 'BIGDATA', 'certification_info', 'config');
  await setDoc(ref, { exam_schedules: BIGDATA_EXAM_SCHEDULES }, { merge: true });
}

/**
 * 자격증별 시험일정을 Firestore certification_info/config에 저장 (merge).
 * 경로: certifications/{certCode}/certification_info/config, 필드: exam_schedules
 */
export async function saveCertExamSchedules(
  certCode: string,
  schedules: ExamScheduleItem[]
): Promise<void> {
  const ref = doc(db, 'certifications', certCode, 'certification_info', 'config');
  await setDoc(ref, { exam_schedules: schedules }, { merge: true });
}

/**
 * 자격증 config 문서에서 exam_schedules만 조회 (자격증 관리 화면용).
 * getCertificationInfo는 pass_criteria/subjects가 없으면 null을 반환하므로,
 * 저장 후 config에 exam_schedules만 있어도 여기서 읽어와야 새로고침 시 반영됨.
 */
export async function fetchExamSchedulesFromConfig(certCode: string): Promise<ExamScheduleItem[] | null> {
  const ref = doc(db, 'certifications', certCode, 'certification_info', 'config');
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  const data = snap.data();
  const list = data?.exam_schedules;
  return Array.isArray(list) ? (list as ExamScheduleItem[]) : null;
}

const CERT_CODES_FOR_COUNTS = ['BIGDATA', 'SQLD', 'ADSP'] as const;
const todayForCounts = () => new Date().toISOString().slice(0, 10);

/**
 * 자격증별 현재 학습중인 학습자 수(활성화된 학습자), 결제중인 학습자 수(만료 제외), 졸업한 학습자 수(만료) 집계.
 * 전체 회원을 페이지 단위로 읽어 집계합니다.
 */
export async function fetchCertLearnerCounts(): Promise<
  Record<string, { learning: number; paying: number; graduated: number }>
> {
  const counts: Record<string, { learning: number; paying: number; graduated: number }> = {
    BIGDATA: { learning: 0, paying: 0, graduated: 0 },
    SQLD: { learning: 0, paying: 0, graduated: 0 },
    ADSP: { learning: 0, paying: 0, graduated: 0 },
  };
  const today = todayForCounts();
  let lastDoc: DocumentSnapshot | null = null;

  for (;;) {
    const { users, lastDoc: nextLast, hasMore } = await fetchUsersPage(USERS_PAGE_SIZE, lastDoc);
    lastDoc = nextLast;

    for (const u of users) {
      for (const code of CERT_CODES_FOR_COUNTS) {
        const cert = CERTIFICATIONS.find((c) => c.code === code);
        if (!cert) continue;
        const certId = cert.id;

        const hasSubscription = u.subscriptions?.some((s) => s.id === certId);
        const paid = u.paidCertIds?.includes(certId) ?? false;
        const expired = u.expiredCertIds?.includes(certId) ?? false;
        const raw = u.rawMemberships?.[code];
        const rawPremium = raw?.tier === 'PREMIUM';
        const rawExpired = raw?.expiry_date ? raw.expiry_date < today : false;

        const isPaying = raw
          ? rawPremium && !rawExpired
          : paid && !expired;
        const isGraduated = raw
          ? rawPremium && rawExpired
          : expired;
        const isLearning = hasSubscription || isPaying;

        if (isLearning) counts[code].learning += 1;
        if (isPaying) counts[code].paying += 1;
        if (isGraduated) counts[code].graduated += 1;
      }
    }

    if (!hasMore || !lastDoc) break;
  }

  return counts;
}

export { EXAM_SCHEDULES, EXAM_SCHEDULE_DATES };
