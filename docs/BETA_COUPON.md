# 쿠폰 정책 (Firestore `coupons` 컬렉션)

**기존 `beta_coupons` 컬렉션은 폐기합니다.** 새 컬렉션 `coupons`를 사용합니다.

## 컬렉션 전환

1. **beta_coupons 데이터 삭제** (선택):  
   `cd backend && python scripts/delete_beta_coupons_collection.py`  
   → `beta_coupons` 문서를 모두 삭제합니다.
2. **규칙 배포**: `firebase deploy --only firestore:rules`  
   → 규칙에 `coupons`만 허용되어 있으므로, 앱/어드민은 `coupons`만 사용합니다.

## 적용 정책

- **1회용**: 쿠폰 코드당 한 번만 사용 가능. 사용 시 `used: true`, `redeemedBy`(로그인 사용자 이메일), `redeemedAt` 기록.
- **쿠폰 만료기일 (`expiryDate`)**: 이 날짜 이후에는 쿠폰 사용 불가.
- **자격증 (`certCode`)**: 쿠폰 적용 시 유료 권한을 부여할 자격증(예: BIGDATA). 없으면 기본 BIGDATA.
- **유료기능 기간 (`premiumDays`)**: 쿠폰 사용 시 해당 자격증에 대해 멤버십을 부여하는 **일 수**. 없으면 기본 365일.
- **상태**: 미사용 / 사용중 / 만료(만료일 경과 시 사용 불가) / 폐기(관리자 폐기).

## Firestore 문서 구조 (`coupons/{쿠폰코드}`)

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `couponName` | string | 선택 | 쿠폰 이름 (목록 표시용, 15자 제한) |
| `expiryDate` | string (YYYY-MM-DD) | 권장 | 쿠폰 사용 가능 기한. 이날 이후 사용 불가 |
| `certCode` | string | 권장 | 적용 자격증 코드 (예: BIGDATA) |
| `premiumDays` | number | 권장 | 유료 기능 부여 일수 |
| `used` | boolean | O | 미사용 시 false, 사용 후 true |
| `redeemedBy` | string | - | 사용 시 로그인 사용자 이메일 |
| `redeemedAt` | timestamp | - | 사용 시각 |
| `revoked` | boolean | - | true면 폐기(사용 불가) |

## 어드민에서 확인·등록

- **결제 관리 (쿠폰 등록)**: `/admin/billing`
- **목록**: No., 쿠폰코드, 쿠폰 이름, 만료기일, 자격증, 유료기능(일), **상태**(미사용/사용중/만료/폐기됨), 사용자(이메일), 복사, 폐기.
- **조회**: 좌측에서 쿠폰 코드/쿠폰 이름/사용자로 검색, "만료된 쿠폰 포함" 체크 가능.
- **신규 쿠폰 등록**: 쿠폰 코드, 쿠폰 이름, 만료기일, 자격증, 유료기능 기간(일) 입력 후 등록.

## 사용 시 기록

- `coupons/{코드}`: `used: true`, `redeemedBy`, `redeemedAt` 갱신.
- `coupon_redemptions`: `userId`, `userEmail`, `couponCode`, `createdAt` 저장.
- 사용자 `users/{uid}.memberships`: 해당 `certCode`에 대해 `tier: 'PREMIUM'`, `start_date`, `expiry_date`(오늘 + premiumDays) 설정.

## CSV → Firestore 업로드

`backend/scripts/upload_coupons.py`  
- CSV 경로: 프로젝트 루트 `beta_coupon.csv`  
- 열: 이름, 전화번호, **쿠폰**(필수), 이메일. 선택: 쿠폰이름, 만료기일, 자격증, 유료기간(일)  
- `coupons` 컬렉션에 문서 생성/업데이트. 신규 쿠폰은 어드민 > 결제 관리 > 신규 쿠폰 등록으로도 등록 가능.
