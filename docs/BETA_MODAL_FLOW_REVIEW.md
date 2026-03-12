# 베타 모달 플로우 (onboardingStatus 기반)

Firestore `onboarding_status`(앱 `User.onboardingStatus`)로 분기. 자세한 정의는 `docs/ONBOARDING_STATUS.md` 참고.

## 1. onboardingStatus === 0 (신규 가입)

1. 구글 로그인 → `completeGoogleSignIn`에서 문서 없음 → setDoc 시 `onboarding_status: 0` 저장.
2. LoginModal → `onAuthSuccess({ onboardingStatus: 0 })` 또는 effect에서 `user.onboardingStatus === 0` 감지.
3. **회원 가입 완료** 모달 표시 → 확인 → `setShowOrientationPopup('forced')`.
4. OrientationPopupBeta: **레벨 선택** → 오티 슬라이드 → **쿠폰 입력**.

**결론: 신규 → 회원가입 완료 모달 → 레벨 선택 → 오티 → 쿠폰 입력.** ✅

## 2. onboardingStatus === 1 && hasCoupon (기존, 쿠폰 인증됨, 레벨 미선택)

1. 로그인 → `onAuthSuccess({ onboardingStatus: 1, hasCoupon: true })`.
2. 제출 이력 있으면 업데이트 모달 → "새로운 진단 시작하기" 시 `setShowOrientationPopup('fromUpdate')`.
3. 제출 이력 없으면 바로 `setShowOrientationPopup('fromUpdate')`.
4. 오티: **난이도 선택** → 응원 문구만 (쿠폰 입력 없음). 레벨 선택 시 `updateUserPrepLevel` → `onboarding_status: 2` 저장.

**결론: 쿠폰 있지만 레벨 전 기존 유저 → (업데이트 모달) → 난이도 선택 + 응원.** ✅

## 3. onboardingStatus === 2 (레벨 선택 완료, 쿠폰 인증됨)

1. 로그인 → `onAuthSuccess({ onboardingStatus: 2, hasCoupon: true })`.
2. 제출 이력 있으면 업데이트 모달 → 대시보드.
3. 제출 이력 없으면 `setRoute('/mypage')` → 대시보드.

**결론: 레벨 선택한 유저 → (업데이트 모달) → 대시보드.** ✅
