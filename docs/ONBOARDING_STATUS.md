# 온보딩 상태 (onboarding_status / onboardingStatus)

Firestore `users/{uid}` 필드 `onboarding_status`와 앱 `User.onboardingStatus`로 로그인 후 플로우를 제어합니다.

## 값 정의

| 값 | 의미 | 로그인 후 동작 (베타) |
|----|------|------------------------|
| **0** | 방금 가입한 신규 유저 | 회원가입 완료 모달 → 확인 시 **난이도 선택 → 오티 슬라이드 → 쿠폰 입력** |
| **1** | 기존 가입자, 쿠폰 인증됨, 레벨 미선택 | (제출 이력 있으면 업데이트 모달) → **난이도 선택 + 응원 문구** (쿠폰 입력 없음) |
| **2** | 레벨 선택 완료(쿠폰 인증됨) | (제출 이력 있으면 업데이트 모달) → **대시보드(마이페이지)** |

- 필드가 **없는 기존 유저**: `prep_level`이 있으면 **2**, 없으면 **1**로 간주 (firestoreDocToUser).

## 설정 시점

1. **0**: 구글 신규 가입 시 `completeGoogleSignIn` 내 `setDoc`에서 `onboarding_status: 0` 저장.
2. **2**: 오리엔테이션에서 **난이도 선택** 시 `updateUserPrepLevel()` 호출 시 `prep_level`과 함께 `onboarding_status: 2` 저장.
3. **1**: 위 두 경우가 아닌 모든 기존 유저. (레거시 문서는 필드 없음 → 1로 매핑.)

## 쿠폰 적용 시

- 쿠폰 적용(redeem) 시에는 `onboarding_status`를 바꾸지 않음.
- **0** 유저: 오티에서 레벨 선택 → (이미 이 시점에 `updateUserPrepLevel`로 2로 갱신) → 쿠폰 입력.
- **1** 유저: 이미 쿠폰 있음 → 오티에서 난이도만 선택하면 `updateUserPrepLevel`로 2로 갱신.

## 제거된 방식

- `_sessionIsNewUser` (세션 전용, Firestore 미저장): 제거. `onboardingStatus === 0`으로 대체.
- `isNewUser` / `hasCoupon` / `prepLevel` 조합으로 분기하던 로직: `onboardingStatus` + `hasCoupon`으로 통일.
