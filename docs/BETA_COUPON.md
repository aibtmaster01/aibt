# 베타 쿠폰 (beta_coupon.csv → Firestore)

## CSV 형식

프로젝트 루트의 `beta_coupon.csv`:

- **열**: 이름, 전화번호, 쿠폰, 이메일
- **쿠폰**: 나중에 난수로 생성해 채우면 됨.
- 샘플: `김학습,01080219881,123456789,sample@example.com`

## Firestore 반영

앱은 **Firestore `beta_coupons` 컬렉션**으로 쿠폰을 검증합니다. CSV만으로는 동작하지 않으므로, CSV 내용을 Firestore에 넣어야 합니다.

1. Firebase Console → Firestore Database → 컬렉션 `beta_coupons` 생성
2. 각 행마다 **문서 추가**:
   - **문서 ID**: `쿠폰` 열 값 그대로 (예: `123456789`)
   - **필드**:
     - `name` (string): 이름
     - `phone` (string): 전화번호
     - `email` (string): 이메일
     - `used` (boolean): 미사용 시 `false` (기본)

(나중에 스크립트로 CSV → Firestore 일괄 업로드 가능)

## 사용 시 기록

로그인한 사용자가 쿠폰을 사용하면:

- `beta_coupons/{쿠폰코드}` 문서에 `used: true`, `redeemedBy: (사용자 이메일)`, `redeemedAt` 이 기록되고,
- `coupon_redemptions` 컬렉션에 `userId`, `userEmail`, `couponCode`, `createdAt` 이 저장됩니다.

관리자는 Firestore에서 **누가 어떤 쿠폰을 사용했는지** `redeemedBy` / `coupon_redemptions` 로 확인할 수 있습니다.
