# 베타 모달 노출 기준 정리

> `is_verified` 대신 **역할에 맞는 명확한 기준**으로 각 모달 노출을 제어합니다.

---

## 1. 모달 종류와 목적

| 모달 | 목적 | 노출 시점 |
|------|------|-----------|
| **쿠폰 입력** (오리엔테이션 내) | 쿠폰 미등록 유저에게 유료 전환 유도 | 로그인 후 쿠폰이 없을 때 |
| **난이도 선택** (오리엔테이션 1단계) | 진단 난이도(초급/중급/고급) 선택 | 신규 가입·쿠폰 미등록·업데이트 후 |
| **업데이트 안내** | 기존에 학습 이력 있던 유저에게 베타 2.0 안내 + 새 진단 시작 | 재로그인 시, **과거 1회 이상 제출 이력** 있을 때만 |
| **회원가입 완료** | 신규 가입 환영 | **이번 세션에서 막 가입한 유저**만 |
| **응원 문구** (LNB용 오리엔테이션) | 이미 쿠폰 보유 유저에게 가이드만 보여줌 | LNB "핵심 기능 가이드" 클릭 시 |

---

## 2. 기준 정리 (is_verified 제거)

### 2.1 신규 vs 기존 유저 (Firestore 필드 없음, 기존 로직 활용)

- **신규**: Google 로그인 시 **이번에 Firestore `users/{uid}` 문서가 방금 생성된 경우**만.  
  → `authService.completeGoogleSignIn`에서 `userSnap.exists()`가 false일 때 setDoc 후 `_sessionIsNewUser: true`를 붙여 반환. (Firestore에 저장하는 필드 아님, 세션 전용)
- **기존**: `userSnap.exists()`가 true인 경우 → `_sessionIsNewUser: false`.  
  → 재로그인, 쿠폰 보유 재로그인, 이메일 로그인 모두 기존으로 처리.
- **이메일 회원가입**: `register()` 호출 후 로그인 전이므로, 로그인 성공 시 콜백에서 `isNewUser: true` 전달 (기존대로).
- **쿠폰 입력 확인 후**: `handleBetaCouponConfirm`에서는 `isNewUser: false` 전달 → 회원가입 완료 모달 생략, 마이페이지 또는 업데이트 판단만.

`is_verified`는 **이메일 인증 여부**용으로만 두고, “신규 vs 기존”이나 “업데이트 모달 여부”에는 사용하지 않음.

### 2.2 업데이트 안내 모달 (showBetaUpdateModal)

- **목적**: “예전에 모의고사를 한 번이라도 제출한 적 있는” 유저에게만 베타 2.0 안내.
- **기준**  
  - `isBeta === true`  
  - **과거 모의고사 제출 이력 있음** → `fetchHasAnyExamRecord(uid) === true`  
  - **아직 업데이트 모달을 본 적 없음** → `!getBetaUpdateModalSeen()`
- **제거**: `is_verified === true` 조건 제거 (구글 신규도 true라서 혼란 발생).

이렇게 하면 “학습 이력 있던 사람”만 업데이트 모달을 보고, 신규/한 번도 안 푼 유저는 보지 않음.

### 2.3 쿠폰 / 난이도 / 오리엔테이션 (showOrientationPopup)

- **forced**  
  - **기준**: 베타 && 로그인됨 && **쿠폰 없음** (`!hasCoupon`) && 아직 오리엔테이션 미노출.  
  - **의미**: 쿠폰 입력 + (필요 시) 난이도 선택 유도.  
  - **hasCoupon**: `user.isPremium === true || (user.paidCertIds?.length ?? 0) > 0`
- **fromLNB**  
  - **기준**: LNB에서 “핵심 기능 가이드” 클릭.  
  - **의미**: 응원 문구 위주, 쿠폰 입력 없이 닫기만.
- **fromUpdate**  
  - **기준**: 업데이트 안내 모달에서 “새로운 진단 시작하기” 클릭.  
  - **의미**: 난이도 선택 → 오리엔테이션 → 응원 문구.

난이도 선택은 “forced / fromUpdate”일 때 오리엔테이션 **1단계**로 노출 (OrientationPopupBeta 기준).

### 2.4 회원가입 완료 모달 (showSignupSuccessModal)

- **기준**: **신규 가입자만** → `options?.isNewUser === true`.
- **확인 클릭 시**  
  - 베타: 모달 닫고 `setShowOrientationPopup('forced')` → 난이도 선택 포함 오리엔테이션.  
  - 비베타: 모달 닫고 `/exam-list`로 이동.

`is_verified`와 무관하게 “이번에 신규로 들어온 사람”만 회원가입 완료 모달을 봄.

---

## 3. 적용 요약

| 구분 | 이전 (혼란) | 변경 후 |
|------|-------------|---------|
| 업데이트 모달 | `is_verified === true` && 미확인 | **fetchHasAnyExamRecord(uid)** && 미확인 |
| 신규 가입자 | is_verified로 업데이트/회원가입 완료 갈림 | **isNewUser만** 사용 → 항상 회원가입 완료 → (베타) 오리엔테이션(난이도) |
| 기존 유저 재로그인 | is_verified로 업데이트 모달 | **과거 제출 이력 있으면** 업데이트 모달, 없으면 마이페이지 |

---

## 4. 영향 범위

- **authService.completeGoogleSignIn**: Firestore 문서가 이미 있으면 `_sessionIsNewUser: false`, 방금 setDoc한 경우만 `_sessionIsNewUser: true`를 붙여 반환 (User 타입에 `_sessionIsNewUser?` 추가, Firestore에는 저장 안 함).
- **LoginModal**: Google standalone 시 `appUser._sessionIsNewUser === true`일 때만 `isNewUser: true` 전달. 쿠폰 확인 후에는 `isNewUser: false`. 기존 유저 경로에서는 `uid` 전달 (업데이트 모달 판단용).
- **App.tsx**:  
  - 신규: `options?.isNewUser === true` → 회원가입 완료 모달 → (베타) 확인 시 오리엔테이션(난이도).  
  - 구글 리다이렉트 신규: `user._sessionIsNewUser === true`이면 회원가입 완료 모달 먼저 노출하는 effect 추가.  
  - 기존: `fetchHasAnyExamRecord(uid)` + `getBetaUpdateModalSeen()`으로 업데이트 모달 여부 결정.  
  - 쿠폰 미등록 오리엔테이션: `_sessionIsNewUser !== true`인 경우만 effect에서 `forced` 설정 (신규는 회원가입 완료 모달 먼저).
- **다른 기능**: 쿠폰/난이도/오리엔테이션/응원 문구는 기존 기준 유지. prepLevel 등 기존 Firestore 필드 그대로 사용.
