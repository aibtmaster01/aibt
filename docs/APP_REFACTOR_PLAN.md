# App.tsx Custom Hook 리팩토링 계획

## 진행 현황 (최종)

- **완료**: `useAppNavigation`, `useAppBootstrap` 적용됨. `npm run build` 성공.
- **보류**: `useLoginModal`, `useQuizFlow`, `useFocusTraining`, `useCheckout` — 베타 테스트 안정성 위해 추후 단계적으로 적용 예정.
- **기타**: `AdminBilling.tsx` 일괄등록 시 정규식 파싱 이슈로 `RegExp` 생성자 사용으로 수정함.

## 현황

- **App.tsx**: 약 1,480줄, 50개 이상의 `useState`, 다수의 `useEffect`·핸들러·조건부 렌더가 한 컴포넌트에 집중됨.
- 라우팅, 로그인/모달, 퀴즈·결과·다음회차, 집중학습, 결제·쿠폰, 인증 배너 등이 한곳에 섞여 있어 기능 추가·수정 시 영향 범위 파악이 어렵고 테스트도 힘듦.

## 목표

- **기능별 Custom Hook**으로 로직을 분리해, App.tsx는 **라우트·레이아웃·훅 조합**만 담당하게 함.
- 훅 단위로 책임이 나뉘어 유지보수·기능 추가가 쉬워지고, 필요 시 훅 단위 테스트가 가능해지도록 함.

## 훅 분리 계획

### 1. `useAppNavigation` (라우팅·네비게이션)

**역할**: 현재 경로, 이동 함수, 로그인 필요 처리.

| 포함 | 비고 |
|------|------|
| `route`, `setRoute` | Route 타입 |
| `navigate(path)` | `/login` → 로그인 모달, `/checkout` → 결제 모달 등 분기 |
| `navigateToAuth(mode)` | 로그인/가입 모달 열기 |
| URL 파라미터 반영 | `cert`, `round` 등으로 `selectedCertId`/`selectedRoundId` 갱신은 다른 훅과 연동 |

**의존**: `useAuth().user`, 로그인 모달 열기(setter).  
**반환**: `{ route, navigate, navigateToAuth }` (필요 시 `setRoute` 노출).

- 라우트 가드(로그인 필요 경로 → 모달/대기)는 이 훅 안에서 처리하거나, `navigate` 내부에서 처리.

---

### 2. `useLoginModal` (로그인·가입·인증 UI)

**역할**: 로그인/가입 모달, 인증 대기 배너, 재발송 모달, 로그인/로그아웃 토스트.

| 포함 | 비고 |
|------|------|
| `showLoginModal`, `loginModalIntent`, `loginInitialMode` | 모달 표시·의도·초기 탭 |
| `openLoginModal(intent?)`, `closeLoginModal` | 모달 열기/닫기 |
| `handleAuthSuccess(options)` | 로그인 성공 시 intent별 분기(게스트 이어하기, 결제 이동, 마이페이지 등) |
| `pendingVerificationBanner`, `verificationBannerError` 등 | 이메일 인증 대기 배너 |
| `handleVerificationBannerConfirm`, 인증 메일 재발송 | 배너·재발송 로직 |
| `showResendVerificationModal`, `resendPassword`, `resendLoading`, `resendError` | 인증 메일 재발송 모달 |
| `showLoginToast`, `showLogoutToast` | 토스트 표시 및 자동 숨김 effect |

**의존**: `useAuth`(login, resendVerificationEmail), `navigate`, 퀴즈/결제 쪽 상태(게스트 이어하기, 결제용 cert 등)를 콜백이나 인자로 받기.  
**반환**: 모달/배너/토스트 표시 여부와 핸들러들. (예: `openLoginModal`, `handleAuthSuccess`, 배너·재발송·토스트 관련 state·handler.)

- “로그인 성공 시 어디로 갈지”는 intent와 다른 훅에서 넘긴 setter로 제어.

---

### 3. `useQuizFlow` (퀴즈·결과·다음 회차)

**역할**: 자격/회차 선택, 퀴즈 진입/종료, 결과 저장, 게스트 플로우, 결과 화면 “다음 회차” 플로우.

| 포함 | 비고 |
|------|------|
| `selectedCertId`, `selectedRoundId`, `quizMode` | 선택된 자격·회차·모드 |
| `preFetchedQuestions`, `quizStartIndex`, `quizResult` | AI 회차 문제, 시작 인덱스, 결과 |
| `handleSelectRound`, `handleSelectAiRound` | 회차 선택 → 퀴즈 진입 |
| `handleQuizFinish` | 결과 저장, 구독 반영, 결과 페이지 이동 |
| `handleViewExamResult` | 마이페이지 오답확인 → 결과 화면 |
| 게스트 20번 제한 | `pendingGuestSession`, `pendingGuestContinue`, `showGuestContinueModal`, `quizStartIndex` |
| `showQuizLoginSuccessModal`, `showSignupSuccessModal` | 퀴즈 내 로그인/가입 성공 모달 |
| 다음 회차 플로우 | `showRetryModeModal`, `showNextRoundPaymentModal`, `showNextRoundModeModal`, `nextRoundInfo`, `showNextRoundPreparing`, 카운트다운·문제 fetch·퀴즈 진입 |

**의존**: `user`, `navigate`, `updateUser`, 서비스(submitQuizResult, ensureUserSubscription, fetchQuestionsForRound 등).  
**반환**: 위 state·핸들러 전체. (Result/Quiz/ExamList에 넘길 props 구성에 사용.)

- “다음 회차” 5초 카운트다운·문제 생성 effect는 이 훅 내부에 유지.

---

### 4. `useFocusTraining` (집중학습: 과목/유형/개념)

**역할**: 과목 강화·취약 유형·취약 개념 클릭 → 모드 선택 모달 → 준비 오버레이 → 퀴즈 진입.

| 포함 | 비고 |
|------|------|
| `pendingFocusTraining` | 대기 중인 집중학습 타입·certId |
| `showSubjectStrengthPreparing`, `showWeakTypePreparing`, `showWeakConceptPreparing` | 3초 준비 오버레이 |
| `showInsufficientDataModal` | 데이터 부족 시 공통 모달 |
| `handleStartSubjectStrengthTraining`, `handleStartWeakTypeFocus`, `handleStartWeakConceptFocus` | 시작 트리거 |
| `handleFocusModeSelect(mode)` | 학습/시험 모드 선택 → fetch + 퀴즈 이동 |

**의존**: `user`, `navigate`, `setSelectedCertId` 등 퀴즈 훅에서 노출하는 setter, examService(fetchSubjectStrengthTraining50 등).  
**반환**: 위 state·핸들러. MyPage에 넘길 props.

---

### 5. `useCheckout` (결제·쿠폰 모달)

**역할**: 결제 모달, 결제 완료 모달, 쿠폰 모달·효과.

| 포함 | 비고 |
|------|------|
| `showCheckoutModal`, `showPaymentSuccessModal`, `paymentSuccessError` | 결제 모달·완료 모달·에러 메시지 |
| `handleCheckoutComplete` | setPaymentComplete, refreshUser, 모달 전환 |
| `showCouponModal`, `showCouponEffect` | 쿠폰 입력 모달·결과 화면 쿠폰 효과 |
| `pendingCheckoutCertId` | 퀴즈에서 “결제 필요” 후 로그인 시 결제로 넘길 cert |

**의존**: `user`, `selectedCertId`, `navigate`, `refreshUser`, setPaymentComplete, FEATURE_COUPON.  
**반환**: 모달 표시 여부, 에러, 핸들러. (Checkout/Result/사이드바 쿠폰 버튼에 전달.)

---

### 6. `useAppBootstrap` (앱 공통 초기화·가드)

**역할**: 앱 전역 설정, 인덱스 동기화, 전역 에러 수집, 라우트별 보정.

| 포함 | 비고 |
|------|------|
| `document.title` 설정 | APP_BRAND 등 |
| `syncQuestionIndex('BIGDATA')` | 앱 기동 시 1회 |
| `window.onerror` / `unhandledrejection` → logClientError | 전역 오류 로깅 |
| `/result` 진입 시 마이페이지 캐시 무효화 | invalidateMyPageCache |
| `/exam-list` 진입 시 selectedCertId 비어 있으면 첫 자격증으로 설정 | fallback cert |
| `/quiz` 진입 시 round/cert 없으면 목록으로 복귀 | 흰 화면 방지 |
| 구글 로그인 리다이렉트 복귀 시 guestContinue intent 복원 | getStoredGoogleRedirectIntent 등 |

**의존**: `route`, `user`, `selectedCertId`, setSelectedCertId 등(가드는 다른 훅 state와 조합).  
**반환**: 필요 시 없음(effect만 실행). 또는 “리다이렉트 복원 중” 같은 플래그만 반환해 App에서 로딩 UI 분기.

---

### 7. (선택) `useCertSelection` (자격·회차 선택 상태)

**역할**: `selectedCertId` / `selectedRoundId`만 관리하고, 퀴즈·결제·집중학습에서 공통으로 사용.

- `useQuizFlow`가 이미 cert/round를 많이 다루므로, 1단계에서는 `useQuizFlow` 안에 두고, 나중에 “자격 선택만 공유”할 필요가 생기면 `useCertSelection`으로 분리해도 됨.

---

## 훅 간 의존 관계

```
useAppNavigation     ← useAuth (user)
       ↑
useLoginModal        ← useAuth, navigate (from Navigation)
       ↑
useQuizFlow          ← user, navigate, updateUser
       ↑
useFocusTraining     ← user, navigate, setSelectedCertId / setPreFetchedQuestions 등 (QuizFlow에서 노출)
       ↑
useCheckout          ← user, selectedCertId, navigate, refreshUser
       ↑
useAppBootstrap      ← route, user, selectedCertId (읽기), setSelectedCertId 등 (쓰기는 훅 내부 또는 인자로)
```

- **실제 구현 시**: `navigate`를 훅 인자로 넘기거나, Navigation 훅을 먼저 만들고 그 반환값을 다른 훅에 넘기는 방식으로 진행.

---

## 추천 작업 순서

1. **`useAppNavigation`**  
   - `route`, `setRoute`, `navigate`, `navigateToAuth` 추출.  
   - App에서는 이 훅만 쓰고, 기존 상태/핸들러는 아직 App에 두고 `navigate`만 훅에서 가져와 사용하도록 치환.

2. **`useLoginModal`**  
   - 로그인 모달·인증 배너·재발송·토스트 state/effect/핸들러 이동.  
   - `handleAuthSuccess`에서 호출하는 `navigate`, setShowCheckoutModal 등은 App에서 넘기거나 훅 인자로 받기.

3. **`useQuizFlow`**  
   - 가장 큼. selectedCertId/selectedRoundId/quizMode, 퀴즈·결과·게스트·다음회차 관련 전부 이동.  
   - `handleQuizFinish`, `handleSelectRound`, `handleSelectAiRound`, `handleViewExamResult` 등 반환.  
   - App의 `renderContent`는 이 훅이 반환한 값들로 기존처럼 전달만 하면 됨.

4. **`useFocusTraining`**  
   - 집중학습 3종 state·핸들러 이동.  
   - 퀴즈 진입은 `navigate` + 퀴즈 훅에서 노출한 setter(예: setSelectedCertId, setPreFetchedQuestions) 호출로 연동.

5. **`useCheckout`**  
   - 결제·쿠폰 모달 state와 `handleCheckoutComplete` 이동.  
   - `selectedCertId`는 훅 인자로 받거나, 퀴즈 훅과 공유할 수 있는 작은 context로 받기.

6. **`useAppBootstrap`**  
   - document.title, syncQuestionIndex, 전역 에러, 라우트 가드·리다이렉트 복원 effect 이동.  
   - “구글 리다이렉트 복원 중” 플래그만 반환해 App에서 로딩 분기.

7. **App.tsx 정리**  
   - 위 훅들을 조합해 `renderContent()`와 모달/레이아웃만 남김.  
   - 가능하면 “어떤 훅이 어떤 UI를 담당하는지”가 한눈에 보이도록 훅 호출 순서와 주석 정리.

---

## 디렉터리 구조 제안

```
src/
  hooks/
    useAppNavigation.ts   # 라우팅
    useLoginModal.ts      # 로그인·인증 UI
    useQuizFlow.ts        # 퀴즈·결과·다음회차
    useFocusTraining.ts   # 집중학습
    useCheckout.ts        # 결제·쿠폰
    useAppBootstrap.ts    # 앱 초기화·가드
```

- 각 훅 파일 상단에 “담당 기능·의존·반환 요약” 주석을 두면 이후 유지보수에 유리함.

---

## 주의사항

- **훅 간 순환 의존 금지**: A 훅이 B를 쓰고 B가 A를 쓰면 안 됨. `navigate`는 Navigation 훅에서만 만들고 나머지는 인자로 받기.
- **기존 동작 유지**: 한 번에 한 훅만 분리하고, 분리 후 라우트·모달·퀴즈·결제 플로우를 한 번씩 수동으로 확인.
- **타입**: Route, LoginModalIntent 등은 기존처럼 `src/` 타입 정의를 재사용하고, 훅 반환 타입은 `interface`로 명시하면 IDE·리팩터링에 유리함.
- **테스트**: 훅 분리 후 `useQuizFlow` 등 복잡한 훅부터 React Testing Library + renderHook으로 “navigate 호출 시 route 변경” 등만이라도 검증하면 리팩터링 안정성이 커짐.

이 순서대로 진행하면 App.tsx는 “훅 조합 + 라우트별 렌더 + 공통 모달/레이아웃”만 남기고, 로직은 전부 훅으로 옮길 수 있습니다.
