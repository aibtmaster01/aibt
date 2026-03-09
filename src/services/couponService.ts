/**
 * 쿠폰 검증·적용 (Firestore coupons + coupon_redemptions)
 * - 쿠폰 문서: couponName, expiryDate, certCode, premiumDays, used, redeemedBy, redeemedAt, revoked, reusable
 * - BETATEST: 배포용 재사용 쿠폰. config/beta.betatestCouponEnabled 로 사용 중지 가능.
 */

import { doc, getDoc, runTransaction, serverTimestamp, updateDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { applyCouponMembership } from './authService';

const COUPONS = 'coupons';
const COUPON_REDEMPTIONS = 'coupon_redemptions';
const CONFIG_BETA = 'config/beta';

/** 배포용 베타테스트 쿠폰 코드 — 여러 사람이 중복 사용 가능, 관리자 화면에서 사용 중지 가능 */
export const BETATEST_COUPON_CODE = 'BETATEST';

/** Firestore coupons 컬렉션 문서 스키마 */
export interface CouponDoc {
  /** 쿠폰 이름 (목록 표시용, 15자 제한) */
  couponName?: string;
  /** 쿠폰 사용 가능 기한 (YYYY-MM-DD). 이날 이후 사용 불가 */
  expiryDate?: string;
  /** 적용 자격증 코드 (예: BIGDATA) */
  certCode?: string;
  /** 유료 기능 부여 일수 */
  premiumDays?: number;
  /** 미사용 false, 사용 후 true (reusable 쿠폰은 갱신하지 않음) */
  used?: boolean;
  /** 사용 시 로그인 사용자 이메일 */
  redeemedBy?: string;
  /** 사용 시각 */
  redeemedAt?: import('firebase/firestore').FieldValue | { toDate?: () => Date };
  /** 폐기 여부. true면 사용 불가 */
  revoked?: boolean;
  /** 문서 생성일 (등록 시 serverTimestamp) */
  createdAt?: import('firebase/firestore').FieldValue | { toDate?: () => Date };
  /** true면 여러 사람이 중복 사용 가능 (BETATEST 등). 사용 중지는 config/beta.betatestCouponEnabled 로 제어 */
  reusable?: boolean;
}

/** @deprecated BetaCouponDoc 대신 CouponDoc 사용 */
export type BetaCouponDoc = CouponDoc;

const today = () => new Date().toISOString().slice(0, 10);

/** config/beta.betatestCouponEnabled — BETATEST 쿠폰 허용 여부. false면 사용 중지(베타테스트 종료). 기본 true */
export async function getBetatestCouponEnabled(): Promise<boolean> {
  const ref = doc(db, CONFIG_BETA.split('/')[0], CONFIG_BETA.split('/')[1]);
  const snap = await getDoc(ref);
  if (!snap.exists()) return true;
  const enabled = snap.data()?.betatestCouponEnabled;
  return enabled !== false;
}

/** 관리자: BETATEST 쿠폰 사용 중지/재개 (config/beta.betatestCouponEnabled). 문서 없으면 생성 */
export async function setBetatestCouponEnabled(enabled: boolean): Promise<void> {
  const [coll, id] = CONFIG_BETA.split('/');
  const ref = doc(db, coll, id);
  await setDoc(ref, { betatestCouponEnabled: enabled }, { merge: true });
}

/** 쿠폰 코드 유효 여부 확인 (미사용 여부 + 만료기일). BETATEST는 재사용 가능, config 사용 중지 시 invalid */
export async function validateBetaCoupon(code: string): Promise<{ valid: boolean }> {
  const normalized = code.trim();
  if (!normalized) return { valid: false };
  const isBetatest = normalized.toUpperCase() === BETATEST_COUPON_CODE;
  if (isBetatest) {
    const enabled = await getBetatestCouponEnabled();
    if (!enabled) return { valid: false };
    const ref = doc(db, COUPONS, BETATEST_COUPON_CODE);
    const snap = await getDoc(ref);
    if (!snap.exists()) return { valid: false };
    const data = snap.data() as CouponDoc | undefined;
    if (data?.revoked === true) return { valid: false };
    if (data?.expiryDate && data.expiryDate < today()) return { valid: false };
    return { valid: true };
  }
  const ref = doc(db, COUPONS, normalized);
  const snap = await getDoc(ref);
  if (!snap.exists()) return { valid: false };
  const data = snap.data() as CouponDoc | undefined;
  if (data?.used === true) return { valid: false };
  if (data?.revoked === true) return { valid: false };
  if (data?.expiryDate && data.expiryDate < today()) return { valid: false };
  return { valid: true };
}

/** 쿠폰 적용: coupons 문서에 used·redeemedBy·redeemedAt 기록(재사용 쿠폰 제외), coupon_redemptions 저장, 사용자 유료 기간 부여 */
export async function redeemBetaCoupon(
  code: string,
  userEmail: string,
  userId: string
): Promise<void> {
  const normalized = code.trim();
  if (!normalized || !userEmail || !userId) {
    throw new Error('쿠폰 코드와 로그인 정보가 필요합니다.');
  }

  const isBetatest = normalized.toUpperCase() === BETATEST_COUPON_CODE;
  if (isBetatest) {
    const enabled = await getBetatestCouponEnabled();
    if (!enabled) throw new Error('베타테스트 쿠폰은 현재 사용이 중지되었습니다.');
  }

  let certCode = 'BIGDATA';
  let premiumDays = 365;

  const couponDocId = isBetatest ? BETATEST_COUPON_CODE : normalized;
  await runTransaction(db, async (tx) => {
    const couponRef = doc(db, COUPONS, couponDocId);
    const couponSnap = await tx.get(couponRef);
    if (!couponSnap.exists()) {
      throw new Error('유효하지 않거나 이미 사용된 쿠폰입니다.');
    }
    const data = couponSnap.data() as CouponDoc | undefined;
    const reusable = isBetatest || data?.reusable === true;
    if (!reusable && data?.used === true) {
      throw new Error('이미 사용된 쿠폰입니다.');
    }
    if (data?.revoked === true) {
      throw new Error('폐기된 쿠폰입니다.');
    }
    if (data?.expiryDate && data.expiryDate < today()) {
      throw new Error('만료된 쿠폰입니다.');
    }
    if (data?.certCode) certCode = data.certCode;
    if (typeof data?.premiumDays === 'number' && data.premiumDays > 0) premiumDays = data.premiumDays;

    if (!reusable) {
      tx.update(couponRef, {
        used: true,
        redeemedBy: userEmail,
        redeemedAt: serverTimestamp(),
      });
    }

    const redemptionRef = doc(db, COUPON_REDEMPTIONS, `${userId}_${couponDocId}_${Date.now()}`);
    tx.set(redemptionRef, {
      userId,
      userEmail,
      couponCode: normalized,
      createdAt: serverTimestamp(),
    });
  });

  await applyCouponMembership(userId, certCode, premiumDays);

  if (isBetatest) {
    await updateDoc(doc(db, 'users', userId), { usedBetatestCoupon: true });
  }
}
