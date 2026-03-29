# 정보 구조 (IA) — 화면별

코드 기준으로 정리했습니다. 주요 근거: `src/hooks/useAppNavigation.ts`, `src/App.tsx`, `src/components/DashboardSidebar.tsx`, `src/pages/*.tsx`.  
브랜드·빌드 플래그(`config/brand`, `useBetaCertifications`, `isBeta`, `FEATURE_COUPON` 등)에 따라 문구·플로우·컴포넌트 분기가 달라질 수 있습니다.

**기능 ID 규칙**: 본 문서에서만 쓰는 참조용 식별자입니다. `{영역}-{순번}` 형식이며, 스펙·티켓·QA 시나리오에 인용할 때 사용할 수 있습니다. 코드 상 상수와 1:1 매핑은 아닙니다.

---

## 0. URL·준URL별 목적 및 기능 ID

### 0.1 전역 · 셸 (특정 `Route`에 묶이지 않음)

| 구분 | 목적 |
|------|------|
| **모바일 게이트** | PC 미만 뷰포트에서 서비스 대신 이용 안내만 노출 |
| **LNB** | 브랜드 홈 이동, 자격증·대시보드·관리 메뉴, 프로필, (조건부) OT, 로그인 |
| **미인증 배너** | 로그인했으나 이메일 미인증 시 상단 경고·재발송 진입 |
| **앱 전역 모달** | 로그인, 오리엔테이션, 결제, 결과 연동 재시도·다음 회차, 검증 배너 등 |

| ID | 기능 |
|----|------|
| `glo-001` | 모바일 전용 “PC에서 이용” 안내 화면 |
| `glo-002` | 로그인 + 미인증 시 `main` 상단 인증 유도 배너 |
| `glo-003` | 인증 메일 재발송 모달 |
| `glo-004` | 가입 직후 이메일 인증 대기 배너(`pendingVerificationBanner`) |
| `lnb-001` | 로고 클릭 — 로그인 시 `/`, 비로그인 시 `/exam-list` |
| `lnb-002` | 프로필 메뉴 — 계정설정, 로그아웃 확인 |
| `lnb-003` | 자격증 목록 팝업 — `/mypage?cert=` (비관리자만) |
| `lnb-004` | 대시보드 아이콘 — `/mypage` |
| `lnb-005` | 관리자: 회원·자격증·문제·쿠폰 메뉴 진입 |
| `lnb-006` | 핵심 기능 가이드(OT) — 베타·쿠폰 보유 시 |
| `lnb-007` | 비로그인 로그인 아이콘 — `/login` 모달 |
| `mod-001` | 로그인 모달 (`LoginModal`, intent 분기) |
| `mod-002` | 오리엔테이션 / 오리엔테이션 베타 (`OrientationPopup*`) |
| `mod-003` | 결제 모달 + `Checkout` |
| `mod-004` | 결제 완료·가입 완료·퀴즈 내 로그인 성공 등 피드백 모달 |
| `mod-005` | 결과 화면 연동 — 재시도 모드·다음 회차 모드/결제·맞춤형 준비 오버레이 |
| `mod-006` | 약점/강화 학습 데이터 부족 안내 모달 |
| `mod-007` | 클로즈드 베타 종료 안내 팝업 |
| `mod-008` | 게스트 이어하기 완료 안내(레거시) |

---

### 0.2 `/login` (가상 — `Route` 아님, 모달만)

| 항목 | 내용 |
|------|------|
| **목적** | 사용자 인증(구글·이메일 등) 및 시나리오별 후속 화면 분기 |
| **진입** | `navigate('/login')`, LNB 로그인 버튼, 각 화면의 로그인 CTA |

| ID | 기능 |
|----|------|
| `log-001` | 구글 로그인 |
| `log-002` | 이메일 로그인 / 회원가입 |
| `log-003` | `LoginModalIntent` 처리 — `standalone`, `guestContinue`, `checkout`, `guestQuizLogin` |
| `log-004` | 베타 신규 플로우 내 오픈 베타 안내·쿠폰 단계(플래그·상태 연동) |

---

### 0.3 `/checkout` (가상 — `Route` 아님, 모달만)

| 항목 | 내용 |
|------|------|
| **목적** | 열공(유료) 패키지 주문 정보 확인 및 완료 처리(오픈 베타 시 무료 완료 등) |
| **진입** | `navigate('/checkout')`, 만료 배너·결제 CTA·퀴즈 내 결제 요청 등 |

| ID | 기능 |
|----|------|
| `chk-001` | 주문 상품(과목·패키지) 요약 표시 |
| `chk-002` | 오픈 베타/혜택 문구 및 완료 액션 |
| `chk-003` | 완료 시 앱 상태 갱신(모달 닫기·프리미엄 반영 등) |
| `chk-004` | 모달 닫기(뒤로) |

---

### 0.4 `/` (홈)

| 항목 | 내용 |
|------|------|
| **목적** | 로그인 사용자의 **기본 랜딩**(대시보드). 관리자는 **운영 대시보드** 진입. |
| **비고** | 비로그인이면 곧 `/exam-list`로 리다이렉트되어 본 URL에 머무르지 않음. |

| ID | 기능 |
|----|------|
| `home-001` | (일반) `MyPage` / `MyPageBeta` 대시보드 본문 |
| `home-002` | (관리자) `Admin` — `initialMenu="dashboard"` |

*(대시보드 위젯·모달 상세 ID는 `dash-*`와 통합. `/mypage`와 동일 컴포넌트이면 같은 ID를 공유.)*

---

### 0.5 `/mypage`

| 항목 | 내용 |
|------|------|
| **목적** | **학습 대시보드** — 현황·분석·기록·모의고사/강화 학습 진입. URL `?cert=` 로 과목 고정. |
| **비고** | 관리자는 동일 경로에서도 `Admin` 대시보드로 대체될 수 있음. |

| ID | 기능 |
|----|------|
| `dash-001` | 헤더 — 자격증·시험일·D-day·일정 선택·자격증 추가 진입 |
| `dash-002` | 시험일 경과 배너(합격/불합격 설문 연동) |
| `dash-003` | 구독 만료 배너 및 결제 유도 |
| `dash-004` | 데이터 보존/안내 카드(해당 시) |
| `dash-005` | 예측 합격률 또는 실력진단 진행 카드(베타 레이아웃) |
| `dash-006` | 학습 시작하기 → `/exam-list` |
| `dash-007` | 과목별 안전도 분석 + 과목 강화 학습 CTA |
| `dash-008` | 취약 개념 분석 + 취약 개념 집중 학습 CTA |
| `dash-009` | 유형별 분석 + 취약 유형 집중 학습 CTA |
| `dash-010` | 큐레이션 준비 중 전체 화면 오버레이 |
| `dash-011` | 나의 학습 기록(목록·페이지네이션) |
| `dash-012` | 응시 결과 상세 보기(결과 라우트 연동) |
| `dash-013` | 자격증 추가 모달 |
| `dash-014` | 합격/불합격 설문 모달 |
| `dash-015` | 유료 전용 기능 잠금 모달 |
| `dash-016` | 학습 이력 없음 안내(조건부) |
| `mypage-001` | (관리자) `Admin` — `initialMenu="dashboard"` 로 진입한 경우와 동일 뷰 |

---

### 0.6 `/account-settings`

| 항목 | 내용 |
|------|------|
| **목적** | **계정·보안·(선택) 쿠폰·탈퇴** 관리 |

| ID | 기능 |
|----|------|
| `acc-001` | 표시 이름(성·이름) 저장 |
| `acc-002` | 비밀번호 변경 |
| `acc-003` | 쿠폰 코드 입력(`FEATURE_COUPON`) |
| `acc-004` | 회원 탈퇴 플로우 |
| `acc-005` | 뒤로가기 → `/mypage` |

---

### 0.7 `/exam-list`

| 항목 | 내용 |
|------|------|
| **목적** | **모의고사 회차 선택** — 고정·맞춤형 회차 진입, 잠금·로그인·결제 정책 반영 |
| **쿼리** | `?cert=`, `?round=` (선택 회차 하이라이트 등 상태 연동) |

| ID | 기능 |
|----|------|
| `exl-001` | 자격증명·회차 선택 안내 헤더 |
| `exl-002` | 비로그인 시 로그인 유도 문구 |
| `exl-003` | 만료 구독 경고 |
| `exl-004` | 회차 카드 리스트(완료·현재·맞춤형·잠금 UI) |
| `exl-005` | 4회차 티저 블록(조건부) |
| `exl-006` | 학습/실전 모드 선택 모달 |
| `exl-007` | (베타) 맞춤형 문항 수 선택 |
| `exl-008` | 잠금 안내 모달 — 사유별 로그인/결제 CTA |
| `exl-009` | 무료 회원 맞춤형 잠금 → 결제 유도 모달 |
| `exl-010` | 정적 회차(초기 맞춤형) 안내 모달 |
| `exl-011` | 맞춤형 진입 준비 오버레이·카운트다운·문제 프리패치 |
| `exl-012` | 뒤로가기 — 로그인 시 `/mypage`, 비로그인 시 목록 유지 |

---

### 0.8 `/quiz`

| 항목 | 내용 |
|------|------|
| **목적** | **선택한 회차 문항 풀이·제출** 및 중간 이탈 처리 |
| **전제** | `selectedCertId` + `selectedRoundId` 없으면 `/exam-list`로 복귀 |

| ID | 기능 |
|----|------|
| `qiz-001` | 지문(텍스트·이미지·KaTeX 등) 표시 |
| `qiz-002` | 선지 선택 및 세션 기록 |
| `qiz-003` | 학습/실전 모드 표시 |
| `qiz-004` | 진행도·과목 라벨 등 헤더 정보 |
| `qiz-005` | 회차 메모·핀 |
| `qiz-006` | 답안 플래그(헷갈림·모름 등) |
| `qiz-007` | 이탈 시 `/mypage` 또는 `/exam-list` |
| `qiz-008` | 제출 후 결과 데이터 넘김 → `/result` |
| `qiz-009` | 해설/프리미엄 영역 잠금 시 로그인·결제 유도 |
| `qiz-010` | (레거시) 게스트 한도 도달 시 로그인 유도 |

---

### 0.9 `/result`

| 항목 | 내용 |
|------|------|
| **목적** | **채점 결과 확인** — 과목별 점수, 오답·해설, 다음 학습 행동 유도 |
| **전제** | `quizResult` 없으면 빈 화면(직접 진입 거의 없음) |

| ID | 기능 |
|----|------|
| `rst-001` | 총점·합격 메시지 |
| `rst-002` | 과목별 점수 테이블 |
| `rst-003` | 상세 리포트 잠금·쿠폰/로그인 CTA |
| `rst-004` | 오답·정답 해설 영역(등급별 마스킹) |
| `rst-005` | 문항 플래그 표시(헷갈림·찍기 등) |
| `rst-006` | 홈 이동(`/` 또는 `/exam-list`) |
| `rst-007` | 모의고사 목록으로 이동 |
| `rst-008` | 대시보드 이동(`?cert=&refresh=`) |
| `rst-009` | 같은 회차 재시도 → 앱 모달에서 모드 선택 |
| `rst-010` | 다음 회차 자동 진행(유료 확인·모드·프리패치) |
| `rst-011` | 결제·로그인 유도 |
| `rst-012` | 쿠폰 획득 이펙트 등(플래그 연동) |

---

### 0.10 `/admin`

| 항목 | 내용 |
|------|------|
| **목적** | **운영자** 회원·통계·베타 등 관리(`initialMenu="users"` 기본) |

| ID | 기능 |
|----|------|
| `adm-001` | 회원 목록·검색·페이지네이션 |
| `adm-002` | 사용자별 멤버십·차단·메모·기기·비밀번호 재설정 등 액션 |
| `adm-003` | 내부 메뉴 전환 — 대시보드, 문항·정산 링크, 베타 등 |
| `adm-004` | 방문·오류·문제 신고 등 운영 지표 뷰(메뉴에 포함 시) |

---

### 0.11 `/admin/certs`

| 항목 | 내용 |
|------|------|
| **목적** | 자격증(과목) **메타데이터** 관리 |

| ID | 기능 |
|----|------|
| `adc-001` | 자격증 목록·편집 UI (`AdminCerts`) |

---

### 0.12 `/admin/questions`

| 항목 | 내용 |
|------|------|
| **목적** | **문항** CRUD·난이도 등 콘텐츠 운영 |

| ID | 기능 |
|----|------|
| `adq-001` | 문항 관리 화면 (`AdminQuestions`) |

---

### 0.13 `/admin/billing`

| 항목 | 내용 |
|------|------|
| **목적** | **쿠폰·정산** 등 결제 관련 운영 |

| ID | 기능 |
|----|------|
| `adb-001` | 정산·쿠폰 UI (`AdminBilling`) |
| `adb-002` | 뒤로가기 → `/admin` |

---

## 1. 라우팅 개요

### 1.1 `Route` 타입 (실제 `route` 상태에 올라가는 경로)

`useAppNavigation.ts`에 정의된 값만 **페이지 전환**으로 취급합니다.

| 경로 | 설명 |
|------|------|
| `/` | 홈(관리자: 어드민 대시보드 / 로그인 사용자: 마이페이지) |
| `/mypage` | 마이페이지(대시보드) |
| `/account-settings` | 계정설정 |
| `/exam-list` | 모의고사 회차 목록 |
| `/quiz` | 문제 풀이 |
| `/result` | 시험 결과 |
| `/admin` | 관리자 — 회원 중심 메뉴(`initialMenu="users"`) |
| `/admin/certs` | 관리자 — 자격증 관리 |
| `/admin/questions` | 관리자 — 문항 관리 |
| `/admin/billing` | 관리자 — 쿠폰·정산 |

- **초기 `route`**: `/exam-list` (`useAppNavigation` 기본값).
- **`/checkout`**: `Route`에 **포함되지 않음**. `navigate('/checkout')` 시 **결제 모달**만 열리고 `route`는 바뀌지 않음 (`setShowCheckoutModal(true)`).
- **`/login`**: 경로가 아니라 `navigate('/login')` → **로그인 모달** 오픈.

### 1.2 `navigate` 쿼리 파라미터

| 호출 예 | 효과 |
|---------|------|
| `/exam-list?cert=` | `selectedCertId` 설정 |
| `/exam-list?cert=&round=` | 위 + `selectedRoundId` 설정 |
| `/mypage?cert=` | `selectedCertId` 설정 |
| `/mypage?cert=&refresh=1` | 결과 화면 등에서 대시보드 새로고침 유도 |

### 1.3 로그인 필요 경로 (비로그인 시)

`pathname`이 `/mypage`, `/account-settings`, `/admin`으로 시작하면 비로그인 시 로그인 모달을 띄웁니다.  
`/mypage` 시도 시 `route`는 `/exam-list`로 되돌아가는 분기가 있습니다. `/account-settings`·`/admin`은 `route`만 해당 경로로 두고 본문은 `null`/거부 처리에 가깝습니다.

### 1.4 비로그인 `/` 처리

`App.tsx`의 `useLayoutEffect`: 비로그인이고 `route === '/'` 이면 **`navigate('/exam-list')`** 로 유도합니다.

---

## 2. 전역 크롬 · 공통 레이아웃

### 2.1 모바일

`useIsMobile()`이 참이면 **전역 단일 화면**: PC 이용 안내 문구만 표시하고 본 서비스 UI는 렌더하지 않습니다.

### 2.2 좌측 LNB — `DashboardSidebar`

| 요소 | 동작 |
|------|------|
| 로고 | 로그인 시 `onNavigate('/')`, 비로그인 시 `onNavigate('/exam-list')` |
| 프로필(로그인 시) | 팝업: 계정설정(`/account-settings`), 로그아웃 확인 모달 |
| 쿠폰 등록 | `FEATURE_COUPON && onOpenCoupon` 일 때만 팝업에 표시. **`App`은 현재 `onOpenCoupon`을 넘기지 않음** → 실사용 시 비노출 |
| 자격증 목록(`List`) | **비관리자**만 표시. 항목 클릭 → `/mypage?cert={id}` |
| 대시보드(`LayoutDashboard`) | 로그인 시만. → `/mypage`. 활성 표시: `currentPath === '/mypage' \|\| '/'` |
| 관리자 전용 | `/admin`(Users), `/admin/certs`(List 아이콘), `/admin/questions`(BookOpen), `/admin/billing`(Ticket) |
| 핵심 기능 가이드(`HelpCircle`) | `onOpenOrientation` 있을 때만. **`App`**: `isBeta && user && hasCoupon` 일 때 오리엔테이션(`fromLNB`) 오픈 |
| 로그인(`LogIn`) | 비로그인 하단 → `onNavigate('/login')` (모달) |

어드민 전체 화면(`Admin` 등)은 내부에서 **흰색 LNB**를 쓰고, 앱의 파란 `DashboardSidebar`는 유지되나 메인 콘텐츠가 어드민으로 덮이는 구조입니다.

### 2.3 `main` 상단 배너 (로그인·미인증)

로그인 상태이고 `user.is_verified === false` 이면 **이메일 인증 유도 배너** + 재발송 → `showResendVerificationModal`.

---

## 3. 앱 전역 모달·오버레이 (`App.tsx`)

로그인 후 메인 레이아웃에서 겹쳐지는 주요 UI입니다.

| 상태 | 용도 |
|------|------|
| `LoginModal` | 구글/이메일 등. `LoginModalIntent`: `standalone` \| `guestContinue` \| `checkout` \| `guestQuizLogin` |
| `showQuizLoginSuccessModal` | 퀴즈 중 `/login` intent `guestQuizLogin` 완료 후 안내 |
| `OrientationPopup` / `OrientationPopupBeta` | `forced` \| `fromLNB` \| `fromUpdate` — 업데이트 안내, 학습 수준, OT 슬라이드, 오픈 베타 마무리 등 |
| `showCheckoutModal` + `Checkout` | 주문/결제(전체 화면에 가까운 모달) |
| `showPaymentSuccessModal` | 결제 완료 피드백 |
| `showSignupSuccessModal` | 회원가입 완료 → 확인 시 `/exam-list` |
| `showGuestContinueModal` | 게스트 이어하기 로그인 후 21번부터 안내(레거시 플로우) |
| `showResendVerificationModal` | 인증 메일 재발송 |
| `showRetryModeModal` | 결과에서 재시도 시 학습/실전 모드 선택 |
| `showNextRoundPaymentModal` | 다음 회차 진행 시 유료 필요 안내 |
| `showNextRoundModeModal` | 다음 회차 모드 선택 |
| `showNextRoundPreparing` | 다음 회차 맞춤형일 때 카운트다운·문제 프리패치 후 `/quiz` |
| `showInsufficientDataModal` | (약점/강화 학습 등) 데이터 부족 안내 |
| `showBetatestEndedPopup` | 베타 쿠폰 사용자 대상 베타 종료 안내 |
| `pendingVerificationBanner` | 가입 직후 이메일 인증 대기 배너(비로그인 풀스크린 분기 쪽) |

**베타·비로그인 랜딩 분기**: `isLanding`(정의상 `route === '/' && !user`)일 때는 로그인 모달 + `isBeta && !user` 면 중앙 “로그인 후 이용해 주세요” 문구. 다만 비로그인 `/`는 곧 `/exam-list`로 리다이렉트되므로 체류는 짧습니다.

---

## 4. 화면별 IA

### 4.1 `/` (홈)

| 조건 | 화면 |
|------|------|
| `canShowAdmin(user)` | `Admin`, `initialMenu="dashboard"`, `hideSidebar` |
| 그 외 로그인 사용자 | `MyPageBeta` 또는 `MyPage` (`useBetaCertifications`) |
| 비로그인 | `renderContent`는 `null` → 위 리다이렉트로 사실상 `/exam-list` |

마이페이지에서 자격증 선택 시 `onSelectExam` / `onStartNewCert` 등으로 **`/exam-list`로 이동**하는 흐름이 연결되어 있습니다.

### 4.2 `/mypage`

| 조건 | 화면 |
|------|------|
| 관리자 | `Admin` + `initialMenu="dashboard"` |
| 일반 로그인 | `MyPageBeta` 또는 `MyPage`, `initialCertId` = URL `cert` 반영 |

**MyPage / MyPageBeta 공통 축(코드 상 구조 유사)**

- 상단: 시험일 경과 `PostExamBanner`, 만료 `ExpiredBanner`, `DataPreservationCard`(해당 시)
- 헤더: 자격증·시험일·일정·자격증 추가
- 분석 영역: 과목별 안전도 / 취약 개념 / 유형별 분석 + 각 **강화·집중 학습** CTA → 앱에서 큐레이션 후 `/quiz`
- 좌측(베타 레이아웃): 예측 합격률 또는 실력진단 진행 카드, **학습 시작하기** → `/exam-list`
- 하단: **나의 학습 기록** + 페이지네이션, 시험 결과 보기 연동
- 모달: 자격증 추가, 합격/불합격 설문, 유료 기능 잠금 안내 등

비베타 `MyPage`는 데이터 없을 때 `EmptyState` 등 다른 카피가 나올 수 있습니다.

### 4.3 `/account-settings` — `AccountSettings`

- 뒤로 → `/mypage`
- 표시 이름(성/이름) 저장, 비밀번호 변경
- `FEATURE_COUPON` 시 쿠폰 입력 UI
- 회원 탈퇴 확인

### 4.4 `/exam-list` — `ExamList`

- 헤더: 자격증명, 회차 선택 안내, 비로그인 시 로그인 안내, 만료 시 경고
- **회차 카드 리스트**: 순번, 제목·설명, 완료/현재/맞춤형(그라데이션) 스타일, 잠금·재생
- **4회차 티저**(`showTeaser4`): 미완료 시 별도 노출 블록
- **모달·오버레이**  
  - `showModeModal`: 학습/실전 모드 + (베타) 문항 수 선택  
  - `showLockedModal`: 잠금 사유(게스트·회차 잠금 등) → `onRequestLogin` 등  
  - `showFreePaymentModal`: 무료 회원 맞춤형 잠금 → 결제 유도  
  - `showStaticModal`: 정적 회차(초기 맞춤형) 안내  
  - `showPreparingOverlay`: 4회차+ 맞춤형 — 카운트다운 후 문제 로드 → 퀴즈 이동

`certId`는 `selectedCertId` → 구독/결제 id → `CERTIFICATIONS[0]` 순 폴백.

### 4.5 `/quiz` — `Quiz`

- `selectedCertId` + `selectedRoundId` 없으면 `useEffect`로 `/exam-list` 복귀
- 과목·모드(학습/실전), 진행, 지문·선지, 플래그(헷갈림·모름 등), 회차 메모
- 종료: 로그인 시 `/mypage`, 비로그인 시 `/exam-list`
- `onGuestLimitReached` → 로그인 모달 `guestContinue`(정책상 게스트 풀이는 서비스에서 제한되는 중)
- `onRequestCheckout`: 비로그인 시 로그인 모달 `checkout`, 로그인 시 `navigate('/checkout')`(모달)

### 4.6 `/result` — `Result`

- 총점, 합격 메시지, 과목별 점수 테이블
- 비유료·비로그인에 따른 **상세 리포트 잠금**, 쿠폰/로그인 CTA
- 오답 노출·해설(등급에 따른 마스킹), 헷갈림/찍기 태그
- 액션: 홈(`/` 또는 `/exam-list`), 재시도(모드 모달), 목록, 대시보드(`?cert=&refresh=1`), 다음 회차(유료·모드·프리패치 분기), 결제, 로그인 등

### 4.7 결제 UI — `Checkout`

- **페이지 라우트가 아님** — 모달 내부 또는 (구버전) 단독 페이지 컴포넌트로 재사용 가능
- 주문 상품(열공 패키지 요약), 오픈 베타 문구, 완료 버튼 → `onComplete`에서 앱 상태 갱신

---

## 5. 관리자 (`Admin.tsx` 등)

- **`/admin`**: `initialMenu="users"` — 회원 목록·검색·멤버십/차단/메모/학습 상태 등. 내부 메뉴 전환으로 대시보드·문항 링크·정산·베타 등 포함(`AdminMenu`).
- **`/admin/certs`**: `AdminCerts`
- **`/admin/questions`**: `AdminQuestions`
- **`/admin/billing`**: `AdminBilling`, 뒤로 `/admin`

비관리자 접근 시 `Access Denied` 텍스트.

---

## 6. 권한·진입 요약

| 경로 | 비로그인 |
|------|----------|
| `/exam-list` | 허용(회차 선택 시 로그인 유도) |
| `/quiz` | `checkExamAccess` 등으로 사실상 불가 → 에러 뷰 |
| `/mypage`, `/account-settings`, `/admin*` | 로그인 모달 또는 거부 |
| `/result` | `quizResult` 없으면 빈 화면 — 보통 퀴즈 완료 후만 |

---

## 7. 참고 파일

| 파일 | 내용 |
|------|------|
| `src/hooks/useAppNavigation.ts` | `Route`, `navigate`, 초기 route |
| `src/App.tsx` | `renderContent`, 전역 모달, 리다이렉트·가드 |
| `src/components/DashboardSidebar.tsx` | LNB IA |
| `src/components/LoginModal.tsx` | `LoginModalIntent` |
| `src/pages/ExamList.tsx`, `Quiz.tsx`, `Result.tsx`, `MyPage*.tsx`, `AccountSettings.tsx`, `Checkout.tsx` | 본문 IA |
| `src/pages/Admin*.tsx` | 관리자 IA |

`src/pages/Home.tsx`는 현재 라우트에서 **import 되지 않음**(레거시·예비 파일로 추정).

---

*문서 버전: 코드 스냅샷 기준 일회 검토. 라우팅·플래그 변경 시 `App.tsx` / `useAppNavigation.ts`와 함께 갱신 권장.*  
*§0의 기능 ID(`glo-*`, `dash-*` 등)는 문서·기획 참조용이며, 소스에 동명 상수가 없을 수 있습니다.*
