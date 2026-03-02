import {
  signInWithEmailAndPassword,
  signOut,
  createUserWithEmailAndPassword,
  updateProfile,
  updatePassword,
  deleteUser,
  reauthenticateWithCredential,
  EmailAuthProvider,
  sendEmailVerification,
  signInWithRedirect,
  getRedirectResult,
  GoogleAuthProvider,
  type User as FirebaseAuthUser,
} from 'firebase/auth';
import { doc, getDoc, updateDoc, arrayUnion, setDoc, deleteDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { User } from '../types';
import { CERTIFICATIONS } from '../constants';
import { getDeviceId } from '../utils/deviceId';

const MAX_DEVICES = 3;

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly code: 'UNVERIFIED' | 'DEVICE_LIMIT_EXCEEDED' | 'USER_NOT_FOUND' | 'INVALID_CREDENTIALS' | 'TOO_MANY_REQUESTS' | 'EMAIL_IN_USE' | 'WEAK_PASSWORD' | 'EMAIL_VERIFICATION_SENT' | 'POPUP_CLOSED' | 'GOOGLE_DISABLED'
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

interface MembershipEntry {
  tier: 'PREMIUM' | 'FREE';
  expiry_date?: string;
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

function normalizeNameFields(docData: Record<string, unknown>): { familyName: string; givenName: string; name: string } {
  const familyName = (docData.familyName as string) || '';
  const givenName = (docData.givenName as string) || '';
  const legacyName = (docData.name as string) || '';
  // 신규: familyName + givenName 있음
  if (familyName && givenName) {
    return { familyName, givenName, name: familyName + givenName };
  }
  // 레거시: name만 있음 → 성=김, 이름=기존이름
  if (legacyName) {
    return { familyName: '김', givenName: legacyName, name: '김' + legacyName };
  }
  return { familyName: '김', givenName: '학습자', name: '김학습자' };
}

function firestoreDocToUser(uid: string, docData: Record<string, unknown>): User {
  const memberships = docData.memberships as Record<string, MembershipEntry> | undefined;
  const weaknessTrialUsed = docData.weakness_trial_used as Record<string, boolean> | undefined;
  const targetExamDateByCert = docData.target_exam_date_by_cert as Record<string, string> | undefined;
  const createdAt = docData.created_at as string | undefined;
  const { familyName, givenName, name } = normalizeNameFields(docData);

  const purchasedScheduleIdsByCert =
    (docData.purchasedScheduleIdsByCert as Record<string, string[]>) ??
    (docData.purchased_schedule_ids_by_cert as Record<string, string[]>) ??
    undefined;

  const baseUser = {
    familyName,
    givenName,
    name,
    targetExamDateByCert,
    createdAt,
    weaknessTrialUsedByCert: weaknessTrialUsed,
    purchasedScheduleIdsByCert,
  };

  const isVerified = (docData.is_verified as boolean) !== false;

  if (memberships && typeof memberships === 'object') {
    const { subscriptions, paidCertIds, expiredCertIds, isPremium } = membershipsToUserFields(memberships);
    return {
      id: uid,
      email: (docData.email as string) || '',
      isAdmin: (docData.isAdmin as boolean) || false,
      isPremium,
      subscriptions,
      paidCertIds,
      expiredCertIds,
      is_verified: isVerified,
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
    isAdmin: (docData.isAdmin as boolean) || false,
    isPremium: (docData.isPremium as boolean) || false,
    subscriptions,
    paidCertIds: (docData.paidCertIds as string[]) || [],
    expiredCertIds: (docData.expiredCertIds as string[]) || [],
    is_verified: isVerified,
    ...baseUser,
  };
}

export async function loginWithEmailPassword(email: string, password: string): Promise<User> {
  let uid: string;
  try {
    const credential = await signInWithEmailAndPassword(auth, email, password);
    uid = credential.user.uid;
    // 이메일 미인증이어도 로그인 허용 — 인증 메일이 안 오는 경우가 있어, 앱 안에서 재발송·안내 가능하도록
  } catch (err: unknown) {
    if (err instanceof AuthError) throw err;
    const code = (err as { code?: string })?.code;
    if (code === 'auth/invalid-credential' || code === 'auth/user-not-found' || code === 'auth/wrong-password') {
      throw new AuthError('이메일 또는 비밀번호가 올바르지 않습니다.', 'INVALID_CREDENTIALS');
    }
    if (code === 'auth/too-many-requests') {
      throw new AuthError('너무 많은 시도가 있었습니다. 잠시 후 다시 시도해주세요.', 'TOO_MANY_REQUESTS');
    }
    throw err;
  }

  const userRef = doc(db, 'users', uid);
  const userSnap = await getDoc(userRef);

  if (!userSnap.exists()) {
    await signOut(auth);
    throw new AuthError('사용자 정보를 찾을 수 없습니다. 관리자에게 문의하세요.', 'USER_NOT_FOUND');
  }

  const data = userSnap.data();
  const firebaseUser = auth.currentUser;
  if (firebaseUser?.emailVerified && data.is_verified === false) {
    await updateDoc(userRef, { is_verified: true });
    data.is_verified = true;
  }
  if (data.isBanned === true) {
    await signOut(auth);
    throw new AuthError('이용이 정지된 계정입니다. 관리자에게 문의하세요.', 'USER_NOT_FOUND');
  }
  const deviceId = getDeviceId();
  const registeredDevices = (data.registered_devices as string[]) || [];

  if (registeredDevices.includes(deviceId)) {
    await migrateUserNamesIfNeeded(userRef, data);
    const fresh = (await getDoc(userRef)).data() ?? data;
    return firestoreDocToUser(uid, fresh);
  }
  if (registeredDevices.length >= MAX_DEVICES) {
    await signOut(auth);
    throw new AuthError('등록 가능한 기기 수(3대)를 초과했습니다. 기존 기기에서 로그아웃 후 다시 시도하세요.', 'DEVICE_LIMIT_EXCEEDED');
  }

  await updateDoc(userRef, { registered_devices: arrayUnion(deviceId) });
  await migrateUserNamesIfNeeded(userRef, data);
  const fresh = (await getDoc(userRef)).data() ?? { ...data, registered_devices: [...registeredDevices, deviceId] };
  return firestoreDocToUser(uid, fresh);
}

/** 이메일 인증 메일 재발송 (로그인 후 발송이므로 현재 비밀번호 필요). 메일 제목/본문은 Firebase Console 템플릿에서 설정. */
export async function resendVerificationEmail(email: string, password: string): Promise<void> {
  let credential: { user: FirebaseAuthUser };
  try {
    credential = await signInWithEmailAndPassword(auth, email, password);
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === 'auth/too-many-requests') {
      throw new AuthError(
        '요청이 너무 많습니다. 잠시 후(몇 분 뒤) 다시 시도해주세요.',
        'TOO_MANY_REQUESTS'
      );
    }
    throw err;
  }
  if (credential.user.emailVerified) {
    await signOut(auth);
    throw new AuthError('이미 인증된 이메일입니다. 로그인해주세요.', 'INVALID_CREDENTIALS');
  }
  try {
    await sendEmailVerification(credential.user);
  } catch (err: unknown) {
    await signOut(auth);
    const code = (err as { code?: string })?.code;
    if (code === 'auth/too-many-requests') {
      throw new AuthError(
        '요청이 너무 많습니다. 잠시 후(몇 분 뒤) 다시 시도해주세요.',
        'TOO_MANY_REQUESTS'
      );
    }
    throw err;
  }
  await signOut(auth);
}

/** Google 로그인 후 Firestore 사용자 조회/생성 (팝업/리다이렉트 공통) */
async function completeGoogleSignIn(fbUser: FirebaseAuthUser): Promise<User> {
  const uid = fbUser.uid;
  const email = fbUser.email ?? '';
  const displayName = (fbUser.displayName ?? '').trim() || email.split('@')[0];
  const parts = displayName.split(/\s+/);
  const familyName = parts.length > 1 ? parts[0] : '김';
  const givenName = parts.length > 1 ? parts.slice(1).join(' ') : displayName || '학습자';

  const userRef = doc(db, 'users', uid);
  const userSnap = await getDoc(userRef);

  if (userSnap.exists()) {
    const data = userSnap.data();
    if (data.isBanned === true) {
      await signOut(auth);
      throw new AuthError('이용이 정지된 계정입니다. 관리자에게 문의하세요.', 'USER_NOT_FOUND');
    }
    await migrateUserNamesIfNeeded(userRef, data);
    const deviceId = getDeviceId();
    const registeredDevices = (data.registered_devices as string[]) || [];
    if (!registeredDevices.includes(deviceId)) {
      if (registeredDevices.length >= MAX_DEVICES) {
        await signOut(auth);
        throw new AuthError('등록 가능한 기기 수(3대)를 초과했습니다. 기존 기기에서 로그아웃 후 다시 시도하세요.', 'DEVICE_LIMIT_EXCEEDED');
      }
      await updateDoc(userRef, { registered_devices: arrayUnion(deviceId) });
    }
    const fresh = (await getDoc(userRef)).data() ?? data;
    return firestoreDocToUser(uid, fresh);
  }

  const now = new Date().toISOString();
  const deviceId = getDeviceId();
  await setDoc(userRef, {
    email,
    familyName,
    givenName,
    name: familyName + givenName,
    isAdmin: false,
    is_verified: true,
    registered_devices: [deviceId],
    memberships: {},
    created_at: now,
  });
  const data = (await getDoc(userRef)).data() ?? {};
  return firestoreDocToUser(uid, data);
}

/** Google 로그인: 리다이렉트 방식 (COOP/팝업 차단 환경에서 안정 동작). 호출 시 곧바로 페이지가 이동합니다. */
export async function loginWithGoogle(): Promise<void> {
  const provider = new GoogleAuthProvider();
  await signInWithRedirect(auth, provider);
}

/** 리다이렉트 복귀 시 한 번만 호출. Google 로그인 결과가 있으면 User 반환, 없으면 null. */
export async function getGoogleRedirectUser(): Promise<User | null> {
  try {
    const result = await getRedirectResult(auth);
    if (!result?.user) return null;
    return completeGoogleSignIn(result.user);
  } catch (err: unknown) {
    if (err instanceof AuthError) throw err;
    const code = (err as { code?: string })?.code;
    if (code === 'auth/operation-not-allowed') {
      throw new AuthError('Google 로그인이 비활성화되어 있습니다.', 'GOOGLE_DISABLED');
    }
    throw err;
  }
}

export async function logoutUser(): Promise<void> {
  await signOut(auth);
}

export async function registerWithEmailAndPassword(
  email: string,
  password: string,
  familyName: string,
  givenName: string
): Promise<User> {
  let uid: string;
  try {
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    uid = credential.user.uid;
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === 'auth/email-already-in-use') {
      throw new AuthError('이미 사용 중인 이메일입니다.', 'EMAIL_IN_USE');
    }
    if (code === 'auth/weak-password') {
      throw new AuthError('비밀번호는 6자 이상이어야 합니다.', 'WEAK_PASSWORD');
    }
    throw err;
  }

  const userRef = doc(db, 'users', uid);
  const now = new Date().toISOString();
  const f = (familyName || '').trim() || '김';
  const g = (givenName || '').trim() || email.split('@')[0];

  try {
    await setDoc(userRef, {
      email,
      familyName: f,
      givenName: g,
      name: f + g,
      isAdmin: false,
      is_verified: false,
      registered_devices: [],
      memberships: {},
      created_at: now,
    });
  } catch (setDocErr) {
    await signOut(auth);
    const msg = setDocErr instanceof Error ? setDocErr.message : '회원 정보 저장에 실패했습니다.';
    if (typeof (setDocErr as { code?: string })?.code === 'string') {
      throw new AuthError(msg, 'INVALID_CREDENTIALS');
    }
    throw new AuthError('회원 정보 저장에 실패했습니다. 잠시 후 다시 시도해주세요.', 'INVALID_CREDENTIALS');
  }

  const firebaseUser = auth.currentUser;
  if (firebaseUser) {
    try {
      // 인증 메일 제목/본문은 Firebase Console → Authentication → Templates 에서 설정.
      // 한국어·합격/인증 문구 권장: docs/FIREBASE_EMAIL_VERIFICATION_TEMPLATE.md
      await sendEmailVerification(firebaseUser);
    } catch (mailErr) {
      await signOut(auth);
      throw new AuthError(
        '가입은 완료되었으나 인증 메일 발송에 실패했습니다. 로그인 후 "인증 메일 재발송"을 이용해주세요.',
        'EMAIL_VERIFICATION_SENT'
      );
    }
  }
  await signOut(auth);
  throw new AuthError('인증 메일을 보냈습니다. 메일을 확인한 뒤 로그인해주세요.', 'EMAIL_VERIFICATION_SENT');
}

/** 레거시 유저: name만 있으면 familyName=김, givenName=name으로 Firestore 마이그레이션 */
async function migrateUserNamesIfNeeded(userRef: ReturnType<typeof doc>, data: Record<string, unknown>): Promise<void> {
  const hasNew = (data.familyName as string) && (data.givenName as string);
  if (hasNew) return;
  const legacyName = (data.name as string) || '';
  if (!legacyName) return;
  const familyName = '김';
  const givenName = legacyName;
  await updateDoc(userRef, { familyName, givenName });
}

export async function getSessionForCurrentAuth(uid: string): Promise<User | null> {
  const userRef = doc(db, 'users', uid);
  const userSnap = await getDoc(userRef);

  if (!userSnap.exists()) return null;

  const data = userSnap.data();
  if (data.isBanned === true) return null;
  // is_verified === false여도 세션 유지 (미인증 사용자도 앱 이용 가능, 상단에서 인증 안내)

  const deviceId = getDeviceId();
  const registeredDevices = (data.registered_devices as string[]) || [];

  if (registeredDevices.includes(deviceId)) {
    await migrateUserNamesIfNeeded(userRef, data);
    const fresh = (await getDoc(userRef)).data() ?? data;
    return firestoreDocToUser(uid, fresh);
  }
  if (registeredDevices.length >= MAX_DEVICES) return null;

  await updateDoc(userRef, { registered_devices: arrayUnion(deviceId) });
  await migrateUserNamesIfNeeded(userRef, data);
  const fresh = (await getDoc(userRef)).data() ?? { ...data, registered_devices: [...registeredDevices, deviceId] };
  return firestoreDocToUser(uid, fresh);
}

/** 현재 비밀번호로 재인증 (비밀번호 변경/회원탈퇴 전 필요) */
export async function reauthenticate(currentPassword: string): Promise<void> {
  const u = auth.currentUser;
  if (!u?.email) throw new AuthError('로그인이 필요합니다.', 'INVALID_CREDENTIALS');
  const trimmed = (currentPassword ?? '').trim();
  const credential = EmailAuthProvider.credential(u.email, trimmed);
  try {
    await reauthenticateWithCredential(u, credential);
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === 'auth/invalid-credential' || code === 'auth/user-not-found' || code === 'auth/wrong-password') {
      throw new AuthError('비밀번호가 올바르지 않습니다.', 'INVALID_CREDENTIALS');
    }
    if (code === 'auth/too-many-requests') {
      throw new AuthError('너무 많은 시도가 있었습니다. 잠시 후 다시 시도해주세요.', 'TOO_MANY_REQUESTS');
    }
    throw err;
  }
}

/** 이름 변경 (Auth displayName + Firestore users 문서) - 성/이름 분리 저장 */
export async function updateDisplayName(uid: string, familyName: string, givenName: string): Promise<void> {
  const u = auth.currentUser;
  if (!u || u.uid !== uid) throw new AuthError('로그인이 필요합니다.', 'INVALID_CREDENTIALS');
  const f = (familyName || '').trim() || '김';
  const g = (givenName || '').trim() || '학습자';
  const fullName = f + g;
  await updateProfile(u, { displayName: fullName });
  const userRef = doc(db, 'users', uid);
  await updateDoc(userRef, { familyName: f, givenName: g, name: fullName });
}

/** 비밀번호 변경 (재인증 필요) */
export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await reauthenticate(currentPassword);
  const u = auth.currentUser;
  if (!u) throw new AuthError('로그인이 필요합니다.', 'INVALID_CREDENTIALS');
  await updatePassword(u, newPassword);
}

/** 회원 탈퇴: 재인증 후 Auth 삭제 + Firestore users 문서 삭제 */
export async function deleteAccount(currentPassword: string): Promise<void> {
  await reauthenticate((currentPassword ?? '').trim());
  const u = auth.currentUser;
  if (!u) throw new AuthError('로그인이 필요합니다.', 'INVALID_CREDENTIALS');
  const uid = u.uid;
  await deleteDoc(doc(db, 'users', uid));
  await deleteUser(u);
}

/**
 * 퀴즈 참여 시 해당 자격증을 구독 목록에 추가 (Firestore 반영)
 * - 마이페이지에서 학습 이력이 있는 자격증을 보여주기 위함
 * - memberships 구조면 해당 코드에 FREE 추가, 아니면 subscriptionIds에 arrayUnion
 */
export async function ensureUserSubscription(uid: string, certId: string): Promise<void> {
  const cert = CERTIFICATIONS.find((c) => c.id === certId);
  if (!cert) return;
  const userRef = doc(db, 'users', uid);
  const snap = await getDoc(userRef);
  if (!snap.exists()) return;
  const data = snap.data();
  const memberships = data.memberships as Record<string, { tier: string }> | undefined;
  if (memberships && typeof memberships === 'object') {
    const certCode = cert.code;
    if (!memberships[certCode]) {
      await updateDoc(userRef, { [`memberships.${certCode}`]: { tier: 'FREE' } });
    }
  } else {
    const subIds = (data.subscriptionIds as string[]) || [];
    if (!subIds.includes(certId)) {
      await updateDoc(userRef, { subscriptionIds: arrayUnion(certId) });
    }
  }
}

/**
 * 결제 완료 시 Firestore에 유료 상태 저장 (memberships만 사용)
 * - memberships[certCode].tier = 'PREMIUM' 으로 갱신
 * - 유료 기능(3회차 이상, 유형/개념별 풀기 등)은 memberships의 tier만 보고 판단
 */
export async function setPaymentComplete(uid: string, certId: string): Promise<void> {
  const cert = CERTIFICATIONS.find((c) => c.id === certId);
  if (!cert) throw new Error(`자격증을 찾을 수 없습니다: ${certId}`);
  const userRef = doc(db, 'users', uid);
  const snap = await getDoc(userRef);
  if (!snap.exists()) throw new Error('사용자 문서가 없습니다.');
  const data = snap.data();
  const memberships = (data.memberships as Record<string, MembershipEntry>) || {};

  const nextMemberships = { ...memberships, [cert.code]: { tier: 'PREMIUM' as const } };

  await updateDoc(userRef, { memberships: nextMemberships });
}
