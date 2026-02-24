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
    if (!data.email) return;
    users.push(firestoreDocToAdminUser(docSnap.id, data));
  });
  const lastDoc = pageDocs.length > 0 ? pageDocs[pageDocs.length - 1] : null;
  return { users, lastDoc, hasMore };
}

/** 실시간 구독 (최대 USERS_PAGE_SIZE명만 읽어 비용 제한). lastDoc은 '다음 페이지' 호출 시 사용 */
export function subscribeToUsers(
  callback: (users: AdminUser[], lastDoc: DocumentSnapshot | null) => void
): () => void {
  const usersRef = collection(db, 'users');
  const q = query(usersRef, orderBy(documentId()), limit(USERS_PAGE_SIZE));
  return onSnapshot(q, (snapshot) => {
    const users: AdminUser[] = [];
    let last: DocumentSnapshot | null = null;
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      if (!data?.email) return;
      users.push(firestoreDocToAdminUser(docSnap.id, data));
      last = docSnap;
    });
    callback(users, last);
  });
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

export { EXAM_SCHEDULES, EXAM_SCHEDULE_DATES };
