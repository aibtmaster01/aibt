/**
 * 베타 쿠폰 검증·적용 (Firestore beta_coupons + coupon_redemptions)
 * - beta_coupon.csv를 Firestore beta_coupons 컬렉션에 업로드해 사용 (문서 ID = 쿠폰 코드)
 * - 사용 시 로그인한 사용자 이메일을 coupon_redemptions 및 beta_coupons.redeemedBy에 기록
 */

import { doc, getDoc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';

const BETA_COUPONS = 'beta_coupons';
const COUPON_REDEMPTIONS = 'coupon_redemptions';

export interface BetaCouponDoc {
  name?: string;
  phone?: string;
  email?: string;
  used?: boolean;
  redeemedBy?: string;
  redeemedAt?: import('firebase/firestore').FieldValue;
}

/** 쿠폰 코드 유효 여부 확인 (미사용 여부 포함) */
export async function validateBetaCoupon(code: string): Promise<{ valid: boolean }> {
  const normalized = code.trim();
  if (!normalized) return { valid: false };
  const ref = doc(db, BETA_COUPONS, normalized);
  const snap = await getDoc(ref);
  if (!snap.exists()) return { valid: false };
  const data = snap.data() as BetaCouponDoc | undefined;
  if (data?.used === true) return { valid: false };
  return { valid: true };
}

/** 쿠폰 적용: beta_coupons 문서에 used·redeemedBy·redeemedAt 기록, coupon_redemptions에 사용 이력 저장 */
export async function redeemBetaCoupon(
  code: string,
  userEmail: string,
  userId: string
): Promise<void> {
  const normalized = code.trim();
  if (!normalized || !userEmail || !userId) {
    throw new Error('쿠폰 코드와 로그인 정보가 필요합니다.');
  }

  await runTransaction(db, async (tx) => {
    const couponRef = doc(db, BETA_COUPONS, normalized);
    const couponSnap = await tx.get(couponRef);
    if (!couponSnap.exists()) {
      throw new Error('유효하지 않거나 이미 사용된 쿠폰입니다.');
    }
    const data = couponSnap.data() as BetaCouponDoc | undefined;
    if (data?.used === true) {
      throw new Error('이미 사용된 쿠폰입니다.');
    }

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
}
