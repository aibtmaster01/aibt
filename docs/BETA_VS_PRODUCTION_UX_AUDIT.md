# 베타 vs 실서비스 — 정책 분기와 공통 UX 정리

이 문서는 **정책성 카피/플로우**와 **제품 UX(정보 구조·피드백)** 를 분리해 기록한다. 모바일 개편 컴포넌트는 정책이 아니라 공통 UX로 유지한다.

**플래그:** `src/config/brand.ts`의 `showCommercialSubscriptionCopy` (`!useBetaCertifications`, 즉 AiBT 베타 빌드에서는 `false`).

---

## 1. 베타 전용으로 유지할 항목

| 영역 | 내용 |
|------|------|
| 자격증/회차 | `useBetaCertifications`: c1 `prepLevel` 기반 진단 회차 ID, 40/80 문항 선택(맞춤형 모달), 큐레이션 문구 |
| 온보딩 | AiBT OT / 업데이트 OT / 베타 로그인 유도, `LoginModal`의 `FEATURE_COUPON \|\| APP_BRAND === 'AiBT'` 기반 구글 우선 플로우 |
| 로그인 UI | `IS_BETA_GOOGLE_ONLY`일 때 이메일 폼·인증 재발송 UI 비노출(내부 `authService` 로직은 유지) |
| 학습 잠금 규칙 | 무료 1·2회차, 3회차+ 잠금 등 **규칙 자체**는 유지. 베타에서는 **결제/이용권 카피만** `showCommercialSubscriptionCopy`로 완화 |

---

## 2. 실서비스 전용 → 베타에서 숨기거나 완화한 항목

| 항목 | 조치 |
|------|------|
| 이용권/결제 카피, 결제 CTA | `ExamList` 잠금 모달, `MyPage_beta` 취약 집중 학습 모달, `Result` 쿠폰/결제/열공 업셀 |
| 2회차 결과 → 결제 모달 | `Result`에서 `onNextRoundPaymentRequest`는 상용일 때만 호출 |
| 합격 축하 쿠폰 → 체크아웃 | `Result` CTA: 베타는 «모의고사·학습 계속하기» 등 중립 동선 |
| 오답이유 열공 업셀 | `Result` 오답 블록: 베타는 안내 문구만 |
| 불합격 할인 모달 결제 | `FailCouponModal` `showCheckout={showCommercialSubscriptionCopy}` |
| 쿠폰 연출(이펙트/배너) | `Result`에서 상용일 때만 쿠폰 카피·이펙트와 조합 권장(이미 `showCouponEffect && showCommercialSubscriptionCopy`로 제한) |
| 환불 FAQ | `Home`의 `FAQS`에서 베타 시 환불 질문 제외(`return null`이어돘 데이터는 정합 유지) |

---

## 3. 공통 UX로 유지할 항목

- `MobileAppShell`, `ResponsivePageContainer`, `SectionAccordion`, 모바일 하단 액션/시트 패턴
- `Quiz`: 모바일 액션바·시트·풀스크린 모달, 신고 토스트 등 피드백
- `Result`: 요약 → 분석 → 다음 행동 정보 위계(모바일/데스크톱 레이아웃만 다름)
- `MyPage_beta`: 학습 홈형 구조, 아코디언으로 정보 밀도 조절
- `DashboardSidebar` + 모바일 드로어: **네비 방식 차이**, 기능 동선은 동일 계열

---

## 4. PC에도 부분 반영을 검토할 만한 항목

- **Result** 무료 사용자 오답 3번째 이상: 베타처럼 «상위 2문항까지» 안내를 PC에도 동일 문구로 두면 정책·UX 일치(이미 모바일/데스크톱 동일 분기).
- **Quiz** 신고 성공/실패 토스트: 모바일과 동일 패턴을 PC에서도 노출하면 피드백 일관성 향상(강제 이식 금지 — 기존 토스트/플래시 컴포넌트 재사용 수준 권장).

---

## 5. 파일별 변경 요약 (이번 반영)

| 파일 | 변경 |
|------|------|
| `src/config/brand.ts` | `showCommercialSubscriptionCopy` 추가 |
| `src/pages/ExamList.tsx` | 잠금 서브타이틀/CTA/뱃지/3회차+ 모달: 상용 vs 베타 문구·결제 버튼 분기 |
| `src/pages/Result.tsx` | `showCheckoutUpsell`, 결제·쿠폰 CTA, 2회차 결제 모달 트리거, 오답 열공 카피, 쿠폰 이펙트 조합 분기 |
| `src/pages/MyPage_beta.tsx` | 취약 학습 결제 모달, `FailCouponModal` 상용 전용 CTA 분기 |
| `src/components/dashboard/modals.tsx` | `FailCouponModal`에 `showCheckout` 옵션 |
| `src/pages/Home.tsx` | 베타 시 환불 FAQ 배열에서 제외 |
| `src/App.tsx`, `gradingService.ts`, `adminService.ts` | 로컬 ingest 디버그 호출 제거 |

**미변경(점검만):** `LoginModal.tsx`(이미 베타 구글 전용 UI), `Quiz.tsx`(공통 피드백 유지), `DashboardSidebar`/`MobileAppShell`(하단 탭 = 학습홈+모의고사, PC는 사이드바+드로어로 더 많은 메뉴 — **기능 패리티는 ‘핵심 2축(홈·모의고사)’ 기준**으로 충족).

---

## 6. 변경 후 QA 체크리스트

### AiBT 베타 빌드 (`APP_BRAND=AiBT`)

- [ ] ExamList: 3회차 이상 잠금 탭 시 «결제하러 가기» 없음, 안내 문구에 이용권·결제 강요 없음
- [ ] ExamList: prepLevel·40/80·맞춤형 설명 그대로
- [ ] Result: 무료·고득점(very_stable)에서 체크아웃으로 가는 CTA 없음, «모의고사·학습 계속하기» 등으로 목록 동선
- [ ] Result: 2회차 무료 결과에서 «다음 학습» 시 결제 모달이 뜨지 않고 목록/계속 학습 동선
- [ ] Result: 오답 3번째+ 에 열공/결제 링크 없음, 상위 2문항 안내만
- [ ] MyPage(베타): 집중 학습 잠금 시 «결제하러 가기» 없음, 베타 안내 확인만
- [ ] 불합격 쿠폰 모달: 할인·결제 버튼 없이 확인만 (해당 플로우 진입 시)
- [ ] 로그인: 구글만 노출, 이메일 가입/인증 UI 비노출

### 실서비스 빌드 (핀셋 등, `showCommercialSubscriptionCopy === true`)

- [ ] ExamList/Result/MyPage: 기존 결제·이용권·쿠폰 CTA 복원
- [ ] Home: 랜딩 재사용 시 환불 FAQ 포함 여부 확인

---

## 분류 질문에 대한 답 형식

각 기능을 아래처럼 보면 된다.

| 질문 | 판단 기준 |
|------|-----------|
| **베타에서 보여야 하나?** | 베타 운영에 필수인가(진단·OT·구글 로그인) vs 상용 전환 시에만 필요한가(결제·환불·이용권) |
| **실서비스에서만 보여야 하나?** | 수익·약관·환불·구독 업셀에 직결되는가 → `showCommercialSubscriptionCopy` |
| **정책이 아니라 UX 개선인가?** | 레이아웃·피드백·정보 순서·반응형 셸 → 플래그 없이 유지 |
| **모바일 전용 인터랙션 vs PC 공통 피드백?** | 바텀시트·드로어 등은 모바일; 토스트·명확한 성공/실패 문구는 PC 동일 적용 가치 있음 |

---

## changelog (요약)

- **정책**은 `showCommercialSubscriptionCopy` 한 축으로 모았고, **모바일 개편 UX**는 건드리지 않았다.
- **삭제 대신 분기**를 우선했으며, 로그인/채점 **내부 로직**은 유지하고 **노출**만 베타에 맞췄다.
