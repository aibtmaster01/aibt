# 베타 버전 코드 리뷰 요약

베타 서비스 오류·정책 충돌 가능성을 점검한 내용과, 적용한 수정·확인 요청 사항을 정리했습니다.

---

## 1. 수정해 둔 부분 (이번 리뷰에서 반영)

### 1) 리다이렉트 복귀 시 로그인 모달 + OT 팝업 동시 노출

- **문제:** 구글 로그인 리다이렉트 후 쿠폰 미등록이면 “로그인 모달(쿠폰 단계)”과 “오리엔테이션 팝업(forced)”이 둘 다 열릴 수 있었음.
- **조치:** 베타에서 리다이렉트 복귀 + 쿠폰 없을 때는 **오리엔테이션 팝업만** 띄우도록 변경. 로그인 모달은 열지 않음. (`setShowOrientationPopup('forced')` 만 수행)

### 2) 베타에서 게스트 이어하기(guestContinue) 복원

- **문제:** 다른 탭/실서버에서 게스트 20번 → 구글 로그인 리다이렉트로 저장된 `guestContinue` intent가 있으면, 베타에서도 복원되어 퀴즈로 바로 들어갈 수 있었음. 베타는 게스트 비허용 정책과 어긋남.
- **조치:** `isBeta`일 때는 `guestContinue` 복원 로직을 타지 않고, 저장된 intent만 삭제하도록 수정.

### 3) OT에서 쿠폰 등록 후 refreshUser 실패 시 팝업이 안 닫히는 문제

- **문제:** `onCouponRegistered`에서 `refreshUser()`가 실패하면 `setShowOrientationPopup(null)`이 호출되지 않아, 팝업이 계속 떠 있을 수 있었음.
- **조치:** `try { await refreshUser(); } finally { setShowOrientationPopup(null); }` 로 바꿔, 실패해도 팝업은 닫히도록 수정.

---

## 2. 동작 확인된 부분

| 항목 | 내용 |
|------|------|
| **강제 로그인** | 베타 + 비로그인 시 `showLoginModal(true)`, `persistent` 로 닫기 불가. 랜딩에 EmptyState 대신 "로그인 후 이용해 주세요"만 노출. |
| **쿠폰 분기** | `hasCoupon` = `user.isPremium \|\| (user.paidCertIds?.length > 0)`. 미등록 시 OT forced, 등록 후 메인(마이페이지 등) 이동. |
| **OT 강제 노출** | 쿠폰 미등록 시 `showOrientationPopup('forced')` 만 설정. X/외부 클릭 없음, 5페이지 쿠폰 등록으로만 닫기. |
| **LNB 가이드** | `onOpenOrientation` 은 `hasCoupon` 일 때만 전달 → 쿠폰 있는 사용자만 HelpCircle로 OT 재오픈, 5페이지에 [닫기]만 노출. |
| **라우팅** | 베타에서 비로그인 시에는 `isLanding` 분기로 메인의 `renderContent()`(EmptyState 등)가 호출되지 않음. |

---

## 3. 추가로 확인하면 좋은 것 (정책/설정)

### 3-1. 베타에서 `/exam-list` 직접 접근

- **상황:** 베타에서도 URL에 `/exam-list` 를 직접 넣으면, 로그인만 되어 있으면 ExamList가 뜹니다. 비로그인 상태에서는 `isLanding`이라 메인 라우트가 `/`이고, 로그인 전에는 메인 분기로 안 들어가서 현재는 문제 없음.
- **질문:** 베타에서 “비로그인 사용자가 주소창에 `/exam-list` 입력”을 막고 싶다면, `navigate`/초기 라우트에서 베타+비로그인일 때 `/` 로 리다이렉트하는 가드를 둘 수 있습니다. **이렇게 제한할지 여부**만 정하면 됩니다.

### 3-2. .env.beta 배포 환경

- **상황:** `npm run build:beta` 는 `.env.beta` (VITE_APP_BRAND=AiBT, VITE_FEATURE_COUPON=true) 를 읽습니다. 이 파일은 `.gitignore`에 있어 저장소에는 없고, CI/배포 서버에서 빌드할 때 **별도로 두어야** 베타 플래그가 들어갑니다.
- **질문:** 베타 배포를 CI로 돌리신다면, 해당 빌드 스텝에 `.env.beta` 를 생성하거나 artifact로 넣는 과정이 있는지 한 번만 확인해 두시면 좋습니다.

### 3-3. 실서버와 베타의 “브랜드/쿠폰” 구분

- **상황:** `isBeta = FEATURE_COUPON || APP_BRAND === 'AiBT'` 로 한 번에 판단합니다. 실서버는 보통 두 값 모두 false/핀셋, 베타는 둘 중 하나라도 true 로 쓰는 구조로 보입니다.
- **질문:** “실서버에서도 쿠폰만 켜고 싶다”(FEATURE_COUPON=true, 브랜드는 핀셋) 같은 조합을 쓰실 계획이 있나요? 있다면, “강제 로그인 + OT”는 **APP_BRAND === 'AiBT'** 일 때만 적용하는 식으로 나누는 것도 가능합니다.

---

## 4. 요약

- **서비스 오류 방지:** 리다이렉트 후 모달/OT 중복 노출 제거, 베타에서 guestContinue 미복원, OT 쿠폰 등록 후 팝업은 항상 닫히도록 수정해 두었습니다.
- **정책적 결정이 필요한 부분:**  
  - 베타에서 `/exam-list` 직접 접근 차단 여부  
  - 배포 환경에서 `.env.beta` 보장 여부  
  - 실서버에 “쿠폰만 켜기” 조합 사용 시 강제 로그인/OT 적용 범위  

위 세 가지만 정해 주시면, 필요 시 그에 맞춰 가드나 분기 한 번 더 정리할 수 있습니다.
