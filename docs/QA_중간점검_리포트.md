# QA 중간 점검 리포트

**기준일**: 2025-02-15  
**역할**: 수석 QA 관점 전체 점검

---

## 1. 수정 완료 사항 (이번 점검에서 반영)

| 구분 | 파일 | 내용 |
|------|------|------|
| 버그 | `src/pages/Checkout.tsx` | `certId`로 자격증 조회 시 `c.code`가 아닌 `c.id`로 비교하도록 수정 (App에서 `selectedCertId`는 `'c1'` 등 id 전달) |
| 코드스타일 | `src/contexts/AuthContext.tsx` | import 경로에서 `authService.ts` → `authService` 로 수정 (확장자 제거) |
| 문서화 | `src/pages/ExamList.tsx` | `showStaticModal` 블록 상단에 `[목데이터]` 주석 추가 |

---

## 2. 게스트 / 무료 / 유료 기능 정책 정리

### 2.1 접근 제어 (examService.checkExamAccess)

| 구분 | Round 1 | Round 2 | Round 3+ |
|------|---------|---------|----------|
| **게스트** | ✅ 허용 (20문제 후 로그인 유도) | ❌ 로그인 유도 | ❌ 로그인 유도 |
| **무료(구독 O)** | ✅ | ✅ | ❌ 결제 유도 |
| **유료(결제 O, 미만료)** | ✅ | ✅ | ✅ |
| **만료** | ❌ 오답노트만 가능 등 안내 | ❌ | ❌ |

- 게스트 Round 1: `getQuestionsForRound` 호출 전/후 별도로 Quiz 내부에서 20번 제한 + `onGuestLimitReached` 처리.
- ExamList: `getLockState`에서 게스트는 `n >= 2` 잠금, 무료는 `n >= 3` 잠금 → **정책과 일치**.

### 2.2 해설/오답 가이드 (examService.maskQuestionData, Quiz UI)

| 구분 | explanation | wrongFeedback |
|------|-------------|----------------|
| **프리미엄** | 실제 노출 | 실제 노출 |
| **게스트/무료** | 실제 노출 | 삭제 후 UI에서 플레이스홀더: "이용권 구매 후 오답인 이유 확인하기" (dim + 왕관), 클릭 시 게스트=로그인→결제, 무료=결제 |

- `maskQuestionData`: Guest/Free 공통으로 `wrongFeedback`만 삭제, `explanation`은 유지.

### 2.3 기타 플로우

- **게스트 20번 후**: 저장 후 로그인 → 회원가입 시 "회원가입 완료! 이어서 모의고사를 진행해주세요" 팝업 → 21번부터 이어하기 (startIndex=20, localStorage 복원).
- **로그인 화면 뒤로가기**: `pendingGuestContinue` 또는 `pendingCheckoutCertId` 있으면 `/quiz`로 복귀.
- **회원가입 성공**: "회원 가입 완료" / "지금 바로 학습을 시작해보세요" / 확인 → 마이페이지.

---

## 3. 목데이터 / 목파일

| 위치 | 용도 | 비고 |
|------|------|------|
| **`src/constants.ts`** | `MOCK_USERS_DB`, `MOCK_USER`, `MOCK_QUESTIONS` | 실제 로그인/문제 로딩은 Firebase·examService 사용. 상수는 **문서/테스트 참고용** (docs/목업_회원_목록.md 참조). |
| **`src/services/quizService.ts`** | `getQuestions()` 내부에서 Firestore 없을 때 `MOCK_QUESTIONS` 폴백 | **현재 미사용**. Quiz는 `examService.getQuestionsForRound`만 사용. 필요 시 제거 또는 examService 폴백으로 통합 검토. |
| **`src/pages/ExamList.tsx`** | `showStaticModal` (만료 시 "제 1회차 진단평가 결과" 모달) | **목데이터**. 65점, 문항 예시 등 하드코딩. 실제 exam_results 연동 시 교체 필요. 주석 추가됨. |
| **`src/pages/Home.tsx`** | `TESTIMONIALS`, `FAQS` | 랜딩용 고정 콘텐츠. 목데이터로 두어도 무방. |

---

## 4. 추후 구현 / 미구현

| 구분 | 파일/기능 | 내용 |
|------|-----------|------|
| 결제 | `src/pages/Checkout.tsx` | `handlePayment`가 2초 후 `onComplete()`만 호출. **실제 결제 API/PG 미연동**. |
| 시딩 | `src/utils/seedTestUsers.ts` | Firestore 테스트 계정 7개 생성. 로그인 화면 "DB 초기화(Clean)"에서 호출. **개발/테스트 전용**. |
| 관리자 | `src/services/adminService.ts` | Firestore 기반 관리자 기능. 실제 사용 여부는 Admin 페이지와 함께 확인 필요. |
| AI 모의고사 | `examService.generateAiMockExam`, `aiRoundCurationService` | Round 4+ / 약점 공략 등에서 사용. 함수명은 "Mock"이지만 실제 맞춤형 시험 생성 로직으로 이해됨. |
| Result | `src/pages/Result.tsx` | `showCouponEffect` 시 confetti 로직 주석: "Logic for confetti would go here". 선택적 개선. |

---

## 5. 얼라인 / 일관성

- **문구**
  - ExamList 무료 잠금: "2회차까지 무료로 이용 가능합니다. 3회차부터는 결제 후 이용해 주세요." → 정책과 일치.
  - 대시보드 카드: "프리미엄 잠금 해제", "결제 후 이용 가능" → 동일 톤 유지.
- **타입**
  - `AuthContext` → `authService` import 수정으로 번들/타입 일관성 유지.
  - Checkout `certId`는 App에서 자격증 **id** (`'c1'` 등)로 전달되므로, 상수 조회 시 `c.id === certId` 사용하도록 수정 완료.

---

## 6. 의존성 / 사용처 요약

- **문제 로딩**: `Quiz` → `examService.getQuestionsForRound` / `getQuestionsForWeaknessRound` 만 사용. `quizService.getQuestions` 는 **어디에서도 import되지 않음**.
- **인증**: `AuthContext` → `authService` (Firebase Auth + Firestore `users/{uid}`). `MOCK_USERS_DB`는 로그인 플로우에 사용되지 않음.
- **자격증 목록**: `constants.CERTIFICATIONS`, `EXAM_ROUNDS`, `CERT_IDS_WITH_QUESTIONS` 사용. `CERT_IDS_WITH_QUESTIONS`는 현재 `['c1']`만 포함.

---

## 7. 권장 후속 작업

1. **quizService.ts**: 사용처 없으면 삭제하거나, examService의 Firestore 실패 시 폴백으로만 사용하도록 정리.
2. **Checkout**: PG/결제 연동 시 `handlePayment` 내부를 실제 결제 플로우로 교체.
3. **ExamList showStaticModal**: 만료 회원용 “진단평가 결과 보기”를 실제 `exam_results` 데이터로 연동 후 목데이터 제거.
4. **Result confetti**: 원할 경우 `showCouponEffect` 시 confetti 애니메이션 구현.

이상으로 중간 점검을 마칩니다.
