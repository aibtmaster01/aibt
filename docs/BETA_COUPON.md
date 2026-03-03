# 베타 쿠폰 (beta_coupon.csv → Firestore)

## 적용 정책

- **1회용**: 쿠폰 코드당 한 번만 사용 가능. 사용 시 `used: true`로 표시되어 재사용 불가.
- **실제 사용자 기록**: CSV의 이름·전화번호·이메일은 **관리용(수급자 목록)**이며, 실제 "누가 쿠폰을 썼는지"는 **로그인한 사용자의 이메일**로 기록됩니다.
  - `beta_coupons/{코드}` 문서에 `redeemedBy: (로그인한 사용자 이메일)` 저장
  - `coupon_redemptions` 컬렉션에 `userEmail`, `userId`, `couponCode`, `createdAt` 저장
- CSV의 이름·전화번호가 실제 사용자 정보와 달라도 무관합니다.

## CSV 형식

프로젝트 루트의 `beta_coupon.csv`:

- **열**: 이름, 전화번호, 쿠폰, 이메일
- **쿠폰**: 나중에 난수로 생성해 채우면 됨.
- 샘플: `김학습,01080219881,123456789,sample@example.com`

## Firestore 반영

앱은 **Firestore `beta_coupons` 컬렉션**으로 쿠폰을 검증합니다. CSV만으로는 동작하지 않으므로, CSV 내용을 Firestore에 넣어야 합니다.

1. Firebase Console → **앱이 사용하는 프로젝트**(예: aibt-99bc6) → Firestore Database → 컬렉션 `beta_coupons` 생성
2. 각 행마다 **문서 추가**:
   - **문서 ID**: `쿠폰` 열 값 그대로 (예: `123456789`)
   - **필드**:
     - `name` (string): 이름
     - `phone` (string): 전화번호
     - `email` (string): 이메일
     - `used` (boolean): 미사용 시 `false` (기본)

**CSV → Firestore 일괄 반영 (스크립트)**  
프로젝트 루트의 `beta_coupon.csv`를 수정한 뒤, 아래 스크립트로 Firestore에 올릴 수 있습니다.

```bash
cd backend && python scripts/upload_beta_coupons.py
```

- Firebase 서비스 계정 키가 필요합니다. (Firebase Console → 프로젝트 설정 → 서비스 계정 → 새 비공개 키 생성 → `backend/serviceAccountKey.json` 등에 저장 후 `export GOOGLE_APPLICATION_CREDENTIALS=경로` 또는 해당 경로에 두기)
- 이미 사용된 쿠폰(used: true) 문서는 덮어쓰지 않고 건너뜁니다.

## 사용 시 기록

로그인한 사용자가 쿠폰을 사용하면:

- `beta_coupons/{쿠폰코드}` 문서에 `used: true`, `redeemedBy: (로그인한 사용자 이메일)`, `redeemedAt` 이 기록되고,
- `coupon_redemptions` 컬렉션에 `userId`, `userEmail`, `couponCode`, `createdAt` 이 저장됩니다.

관리자는 Firestore에서 **누가 어떤 쿠폰을 사용했는지** `redeemedBy` / `coupon_redemptions` 로 확인할 수 있습니다.

## 오류 시 확인

- **"쿠폰 적용 중 오류"**: 화면에 구체적인 에러 메시지가 나오면 그대로 확인. 흔한 원인:
  - **권한 오류**: Firestore 규칙이 **앱이 연결된 프로젝트**(예: aibt-99bc6)에 배포되어 있어야 함.  
    `firebase use aibt-99bc6` 후 `firebase deploy --only firestore:rules`
  - **문서 없음**: 해당 쿠폰 코드를 문서 ID로 가진 `beta_coupons` 문서가 Firestore에 있어야 함.
