/**
 * 쿠폰 검증·적용 (Firestore coupons + coupon_redemptions)
 * - 쿠폰 문서: couponName, expiryDate, certCode, premiumDays, used, redeemedBy, redeemedAt, revoked
 * - 사용 시 로그인 사용자 이메일 기록 + 해당 자격증 유료 기간 부여
 */

import { doc, getDoc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { applyCouponMembership } from './authService';

const COUPONS = 'coupons';
const COUPON_REDEMPTIONS = 'coupon_redemptions';

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
  /** 미사용 false, 사용 후 true */
  used?: boolean;
  /** 사용 시 로그인 사용자 이메일 */
  redeemedBy?: string;
  /** 사용 시각 */
  redeemedAt?: import('firebase/firestore').FieldValue | { toDate?: () => Date };
  /** 폐기 여부. true면 사용 불가 */
  revoked?: boolean;
  /** 문서 생성일 (등록 시 serverTimestamp) */
  createdAt?: import('firebase/firestore').FieldValue | { toDate?: () => Date };
}

/** @deprecated BetaCouponDoc 대신 CouponDoc 사용 */
export type BetaCouponDoc = CouponDoc;

const today = () => new Date().toISOString().slice(0, 10);

/** 쿠폰 코드 유효 여부 확인 (미사용 여부 + 만료기일) */
export async function validateBetaCoupon(code: string): Promise<{ valid: boolean }> {
  const normalized = code.trim();
  if (!normalized) return { valid: false };
  const ref = doc(db, COUPONS, normalized);
  const snap = await getDoc(ref);
  if (!snap.exists()) return { valid: false };
  const data = snap.data() as CouponDoc | undefined;
  if (data?.used === true) return { valid: false };
  if (data?.revoked === true) return { valid: false };
  if (data?.expiryDate && data.expiryDate < today()) return { valid: false };
  return { valid: true };
}

/** 쿠폰 적용: coupons 문서에 used·redeemedBy·redeemedAt 기록, coupon_redemptions 저장, 사용자 유료 기간 부여 */
export async function redeemBetaCoupon(
  code: string,
  userEmail: string,
  userId: string
): Promise<void> {
  const normalized = code.trim();
  if (!normalized || !userEmail || !userId) {
    throw new Error('쿠폰 코드와 로그인 정보가 필요합니다.');
  }

  let certCode = 'BIGDATA';
  let premiumDays = 365;

  await runTransaction(db, async (tx) => {
    const couponRef = doc(db, COUPONS, normalized);
    const couponSnap = await tx.get(couponRef);
    if (!couponSnap.exists()) {
      throw new Error('유효하지 않거나 이미 사용된 쿠폰입니다.');
    }
    const data = couponSnap.data() as CouponDoc | undefined;
    if (data?.used === true) {
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

    tx.update(couponRef, {
      used: true,
      redeemedBy: userEmail,
      redeemedAt: serverTimestamp(),
    });

    const redemptionRef = doc(db, COUPON_REDEMPTIONS, `${userId}_${normalized}_${Date.now()}`);
    tx.set(redemptionRef, {
      userId,
      userEmail,
      couponCode: normalized,
      createdAt: serverTimestamp(),
    });
  });

  await applyCouponMembership(userId, certCode, premiumDays);
}
