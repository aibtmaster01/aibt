/**
 * Firestore users 컬렉션에 테스트 계정 7개를 setDoc으로 생성(덮어쓰기)하는 시딩 유틸리티.
 * 학습 이력(history 등)은 넣지 않고, 계정 정보와 구독 상태만 초기화합니다.
 */

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';

const SEED_PASSWORD = 'asd123';
const EXPIRY_2026_04_08 = '2026-04-08';

function getToday(): string {
  return new Date().toISOString().slice(0, 10);
}

interface SeedUserDef {
  email: string;
  name: string;
  isAdmin: boolean;
  isPremium: boolean;
  memberships: Record<string, { tier: 'PREMIUM' | 'FREE'; expiry_date?: string }>;
}

const SEED_USERS: SeedUserDef[] = [
  // A. 무료 회원 3명 - 미결제/미학습
  { email: 'free_user1@aaa.com', name: '무료_테스터1', isAdmin: false, isPremium: false, memberships: {} },
  { email: 'free_user2@aaa.com', name: '무료_테스터2', isAdmin: false, isPremium: false, memberships: {} },
  { email: 'free_user3@aaa.com', name: '무료_테스터3', isAdmin: false, isPremium: false, memberships: {} },
  // B. 유료 회원 3명 - 시즌권 보유자 (BIGDATA만, SQLD/ADsP 제외)
  {
    email: 'paid_user1@aaa.com',
    name: '유료_테스터1',
    isAdmin: false,
    isPremium: true,
    memberships: { BIGDATA: { tier: 'PREMIUM', expiry_date: EXPIRY_2026_04_08 } },
  },
  {
    email: 'paid_user2@aaa.com',
    name: '유료_테스터2',
    isAdmin: false,
    isPremium: true,
    memberships: { BIGDATA: { tier: 'PREMIUM', expiry_date: EXPIRY_2026_04_08 } },
  },
  {
    email: 'paid_user3@aaa.com',
    name: '유료_테스터3',
    isAdmin: false,
    isPremium: true,
    memberships: { BIGDATA: { tier: 'PREMIUM', expiry_date: EXPIRY_2026_04_08 } },
  },
  // C. 관리자 1명
  {
    email: 'admin@aaa.com',
    name: '관리자',
    isAdmin: true,
    isPremium: true,
    memberships: { BIGDATA: { tier: 'PREMIUM', expiry_date: EXPIRY_2026_04_08 } },
  },
];

async function getOrCreateUid(email: string, name: string): Promise<string> {
  try {
    const credential = await createUserWithEmailAndPassword(auth, email, SEED_PASSWORD);
    return credential.user.uid;
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === 'auth/email-already-in-use') {
      const credential = await signInWithEmailAndPassword(auth, email, SEED_PASSWORD);
      return credential.user.uid;
    }
    throw err;
  }
}

export async function seedTestUsers(): Promise<void> {
  const createdAt = new Date().toISOString();

  for (const def of SEED_USERS) {
    const uid = await getOrCreateUid(def.email, def.name);

    const userDoc = {
      email: def.email,
      familyName: '김',
      givenName: def.name,
      name: '김' + def.name,
      isAdmin: def.isAdmin,
      is_verified: true,
      registered_devices: [],
      memberships: def.memberships,
      created_at: createdAt,
      history: [],
      user_problem_type_stats: {},
    };

    await setDoc(doc(db, 'users', uid), userDoc, { merge: false });
  }

  await signOut(auth);
}
