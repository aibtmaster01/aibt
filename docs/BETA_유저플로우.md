# 베타 테스트 유저 플로우

> 베타 환경(AiBT, 쿠폰 활성화)에서 **진입 → 로그인 → 쿠폰/OT → 맞춤형 모의고사 풀기**까지의 흐름.  
> 다른 AI 에이전트가 "어디서 분기하고, 어떤 컴포넌트가 무슨 역할을 하는지" 파악할 수 있도록 구현 기준으로 서술합니다.

---

## 1. 베타 판별

- **조건**: `isBeta = FEATURE_COUPON || APP_BRAND === 'AiBT'`
- **설정**: `src/config/brand.ts`에서 `import.meta.env.VITE_APP_BRAND`, `VITE_FEATURE_COUPON` 읽음.  
  베타 빌드는 `.env.beta` 또는 `vite build --mode beta`로 위 값이 AiBT/true가 되도록 설정.

---

## 2. 진입 (비로그인)

| 단계 | 화면/동작 | 구현 위치·설명 |
|------|-----------|----------------|
| `/` 접속 | 랜딩이지만 **본문(EmptyState) 미노출** | `App.tsx`: `isLanding = (route === '/' && !user)`. 베타+비로그인일 때 `renderContent()`의 EmptyState는 호출되지 않음. |
| "로그인 후 이용해 주세요" 문구만 표시 | 회색 배경 + 중앙 텍스트 | `App.tsx` 렌더: `isBeta && !user`이면 해당 문구만 있는 div 노출. |
| 로그인 모달 자동 오픈 | 닫기 불가(persistent) | `useEffect`: `!authLoading && isBeta && !user` → `setShowLoginModal(true)`, `setLoginModalIntent('standalone')`. `LoginModal`에 `persistent={true}` 전달. |

---

## 3. 로그인

| 단계 | 화면/동작 | 구현 위치·설명 |
|------|-----------|----------------|
| 구글 로그인만 노출 | 이메일/비밀번호 폼 숨김 | `LoginModal.tsx`: `IS_BETA_GOOGLE_ONLY`(FEATURE_COUPON \|\| APP_BRAND===AiBT)이면 로그인 탭에서 구글 버튼만 표시. |
| 구글 로그인 성공 | Firestore 사용자 문서 생성/조회 후 `appUser` 반환 | `authService.loginWithGoogle`, `LoginModal.handleGoogleLogin`. |
| **쿠폰 등록 여부 확인** | `hasCoupon = appUser.isPremium \|\| (appUser.paidCertIds?.length > 0)` | `LoginModal.tsx` 내: 이미 쿠폰 있으면 **쿠폰 입력 단계를 건너뛰고** `onAuthSuccess()` 호출 → 모달 닫힘. |
| 쿠폰 없음 | "쿠폰 입력" 단계로 전환(회원가입 모달 디자인과 동일 레이아웃) | `setBetaPostLoginCouponStep(true)`, 쿠폰 코드 입력 필드·확인 버튼 표시. |
| 쿠폰 입력 후 확인 | `couponService.redeemBetaCoupon` → Firestore memberships 반영 → `refreshUser` → `onAuthSuccess` | `LoginModal.handleBetaCouponConfirm`. |

---

## 4. 로그인 직후 ~ 쿠폰/OT

| 단계 | 화면/동작 | 구현 위치·설명 |
|------|-----------|----------------|
| 일반 로그인 성공(standalone) | `handleLoginModalAuthSuccess`에서 `setRoute('/mypage')` | `App.tsx`. 쿠폰 이미 있던 재로그인도 여기서 처리. |
| **쿠폰 없으면 OT 강제** | `!hasCoupon && showOrientationPopup === null` → `setShowOrientationPopup('forced')` | `App.tsx`의 `useEffect` (authLoading·user·isBeta·hasCoupon 의존). |
| 오리엔테이션 팝업 | 5페이지 슬라이드. 5페이지: 쿠폰 입력 또는(이미 쿠폰 있으면) 닫기만 | `OrientationPopup.tsx`: `forced`일 때 닫기 버튼 없음. 5페이지에서 쿠폰 등록 시 `onCouponRegistered` → `refreshUser()` + `setShowOrientationPopup(null)` + `navigate('/exam-list')`. |
| 구글 리다이렉트 복귀 | 쿠폰 있으면 아무 팝업 없음. 없으면 **OT만** 띄움(로그인 모달은 띄우지 않음) | `App.tsx`: `sessionStorage.getItem('finset_google_redirect_pending')` 확인 후, isPremium 아니면 `setShowOrientationPopup('forced')`만 수행. |

---

## 5. 메인(마이페이지) ~ 시험 목록

| 단계 | 화면/동작 | 구현 위치·설명 |
|------|-----------|----------------|
| `/` 또는 `/mypage` | 로그인+쿠폰 있으면 **MyPage**(대시보드) | `App.renderContent`: route·user에 따라 MyPage 또는 Admin 등. |
| "학습 시작하기" 등 | `onSelectExamFromMyPage(certId)` → `setSelectedCertId`, `navigate('/exam-list')` | `App.tsx` 핸들러, `MyPage`에서 버튼 클릭 시 호출. |
| `/exam-list` | **ExamList**: 1~3회차(고정) + 4회차~(맞춤형) 회차 카드 목록 | `ExamList.tsx`: 자격증별 `EXAM_ROUNDS` 기반 목록, 잠금/완료 상태 표시. |

---

## 6. 맞춤형(4회차+) 모의고사 풀기

| 단계 | 화면/동작 | 구현 위치·설명 |
|------|-----------|----------------|
| 4회차 이상 회차 카드 클릭 | 모드 선택 모달(학습/실전) | `ExamList.handleRoundClick` → `setShowModeModal(true)`. |
| 모드 선택 후 | 1·2·3회차: 바로 `onSelectRound` → `/quiz`. **4회차 이상**: 5초 준비 오버레이 시작 | `ExamList.handleModeSelect`: roundNum >= 4이면 `setShowPreparingOverlay(true)`, `getExamService().then(m => m.getQuestionsForRound(...))` 호출. |
| 5초 오버레이 | "모의고사 큐레이션 중…" 문구. 맞춤형이면 stats 기반 안내 문구 | `ExamList` 내 준비 오버레이 UI. `getQuestionsForRound`는 내부에서 **라운드 99 풀** + `aiRoundCurationService`로 80문항 선정. |
| 준비 완료 | "맞춤형 모의고사가 준비되었습니다" → `onSelectAiRound(roundId, qs, mode)` → `setPreFetchedQuestions(qs)`, `navigate('/quiz')` | `App.handleSelectAiRound`, `ExamList`에서 카운트다운 종료 후 호출. |
| `/quiz` | **Quiz** 컴포넌트: `preFetchedQuestions`로 80문항 풀기(학습/실전 모드에 따라 문항별 해설 또는 일괄 채점) | `Quiz.tsx`: roundId·certId·preFetchedQuestions·mode 받아 퀴즈 UI·제출 처리. |

---

## 7. 관련 파일 요약 (다른 에이전트용)

| 파일 | 역할 |
|------|------|
| `src/App.tsx` | 라우팅, `isBeta`·`hasCoupon` 분기, 비로그인 시 로그인 모달 강제, 로그인 후 쿠폰 없으면 OT 강제(`setShowOrientationPopup('forced')`), 구글 리다이렉트 복귀 시 OT만 노출, `handleLoginModalAuthSuccess`·`handleSelectAiRound` 등. |
| `src/components/LoginModal.tsx` | 베타 시 구글 전용 UI, 로그인 성공 시 쿠폰 등록 여부 확인 후 쿠폰 입력 단계 스킵 또는 표시, `handleBetaCouponConfirm`에서 `redeemBetaCoupon`·`refreshUser` 후 `onAuthSuccess`. |
| `src/components/OrientationPopup.tsx` | 5페이지 슬라이드( AiBT 소개·학습/실전 모드·맞춤형·대시보드·쿠폰). `forced`일 때 닫기 불가. 5페이지 쿠폰 등록 시 `onCouponRegistered` 호출. |
| `src/config/brand.ts` | `APP_BRAND`, `FEATURE_COUPON` 정의(환경변수 기반). 베타 여부 판단의 근거. |
| `src/services/couponService.ts` | `redeemBetaCoupon`, `validateBetaCoupon`. Firestore `coupons`·`users/{uid}.memberships` 갱신. |
| `src/contexts/AuthContext.tsx` | 로그인 상태·`user` 제공. 로그인/로그아웃 후 `user` 갱신되면 App의 useEffect에서 OT·모달 분기. |
| `src/pages/ExamList.tsx` | 회차 목록 표시, 4회차 이상 선택 시 모드 선택 → 5초 오버레이 → `getExamService().then(m => m.getQuestionsForRound(...))` → `onSelectAiRound`. |
| `src/services/examServiceLoader.ts` | `getExamService()`: `examService` 동적 import. 번들 초기화 순서 이슈 회피. |
| `src/services/examService.ts` | `getQuestionsForRound`: round >= 4일 때 `aiRoundCurationService` 동적 로드 후 맞춤형 80문항 생성. |
| `src/services/aiRoundCurationService.ts` | 라운드 99 풀에서 4과목×20문항 선정(1구역+2구역, stats 기반). |

이 문서만으로도 베타 플로우와 "어느 파일이 어떤 결정을 내리는지"를 다른 에이전트가 추적할 수 있도록 구성했습니다.
