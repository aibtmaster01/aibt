# 베타 실서버 기능 점검 체크리스트

> 베타 실서버(AiBT 빌드)에 로컬과 동일한 기능이 올라갔는지, 예상 버그가 해결되었는지 기능별로 정리한 문서.

---

## 1. 플래그·빌드

| 항목 | 적용 여부 | 비고 |
|------|-----------|------|
| `useBetaCertifications` | ✅ AiBT 빌드에서만 true | `APP_BRAND === 'AiBT'` (brand.ts) |
| `isBetaLocal` 제거 | ✅ 완료 | 베타 로컬 구분 없음, orderBy fallback만 `import.meta.env.DEV` 사용 |
| 데이터 소스 | ✅ 모두 `certifications` | 인덱스·문항 모두 certifications 사용 |

---

## 2. 난이도 선택 (prepLevel)

| 항목 | 적용 여부 | 위치 |
|------|-----------|------|
| 오리엔테이션 첫 단계에 난이도 선택 | ✅ | useBetaCertifications 시 OrientationPopupBeta 사용, showLevelFirst = (forced && !fromLNB) \|\| fromUpdateFlow |
| 쿠폰 입력 후 prepLevel 저장 | ✅ | authService.updateUserPrepLevel |
| 진단 1~3회차 roundKey (l_1, m_2, h_3) | ✅ | examService: isBetaDiagnostic, getRoundKeyForPrepLevel |
| 진단 Elo 초기값(prepLevel 기반) | ✅ | authService.setInitialEloByPrepLevel, gradingService 제출 시 보정 |

---

## 3. 업데이트 안내 팝업 (기존 학습 이력 사용자)

| 항목 | 적용 여부 | 비고 |
|------|-----------|------|
| 신규 가입(이메일) 후 회원가입 완료 모달 | ✅ | isNewUser && !is_verified 등 |
| **기존 유저(구글 standalone)** 로그인 시 업데이트 팝업 | ✅ | isNewUser: true, is_verified: true → getBetaUpdateModalSeen() false면 setShowBetaUpdateModal(true) |
| **기존 유저(쿠폰 보유)** 재로그인 시 업데이트 팝업 | ✅ 수정됨 | LoginModal에서 hasCoupon 시에도 onAuthSuccess({ isNewUser: false, is_verified }) 호출, App else 분기에서 is_verified && !getBetaUpdateModalSeen() 시 팝업 노출 |
| 한 번 확인 후 재노출 안 함 | ✅ | localStorage `aibt_beta_update_modal_seen` |
| "새로운 진단 시작하기" → 난이도 선택 → 오리엔테이션 | ✅ | setShowOrientationPopup('fromUpdate') |

---

## 4. 로그인 모달 버그 수정

| 항목 | 적용 여부 | 비고 |
|------|-----------|------|
| **로그인 → 로그아웃 → 로그인** 시 모달 사라지지 않는 현상 | ✅ 수정됨 | 1) handleLogout에서 setShowLoginModal(false) 등 초기화 2) user가 truthy일 때마다 useEffect에서 setShowLoginModal(false) 호출해 로그인 성공 시 항상 모달 닫기 |
| 구글 리다이렉트 복귀 후 모달 | ✅ | user 설정되면 위 effect로 모달 닫힘 |

---

## 5. 문제 큐레이션

| 항목 | 적용 여부 | 위치 |
|------|-----------|------|
| 진단 1~3회차 40문항·레벨드 인덱스 | ✅ | examService: isBetaDiagnostic, certifications/BIGDATA/public/index_leveled |
| 맞춤형 40/80 선택 | ✅ | ExamList questionCount, getQuestionsForRound(..., options?.questionCount) |
| BIGDATA 문항 메타 보강(인덱스 캐시) | ✅ | examService.maskQuestionDataWithIndexMeta, useBetaCertifications && BIGDATA |
| getCertificationsCollection | ✅ | 항상 'certifications' |

---

## 6. 마이페이지·합격률 예측

| 항목 | 적용 여부 | 위치 |
|------|-----------|------|
| 베타 빌드 시 MyPageBeta 사용 | ✅ | App.tsx useBetaCertifications ? MyPageBeta : MyPage |
| **예측 합격률 3회 이상 시만 표시** | ✅ | MyPage_beta: fetchHasAnyExamRecord, 3회 미만이면 숫자 미표시 |
| 합격률 표시 시 하한(15%)·상한(99%) | ✅ | gradingService PASS_RATE_MIN, PASS_RATE_MAX |
| 시그모이드 적용 | ✅ | gradingService.computePredictedPassRate → applySigmoidTransform (합격선 60점 중심) |
| 난이도 보정(α) | ✅ | predicted_pass_rate = α × P_raw, 0~99 클램프 |
| 과목별 안전도(과락선 40점 기준) | ✅ | statsService getSubjectSafetyZone, SUBJECT_SCORE_MIN = PASS_RATE_MIN (15), 대시보드 표시용 40점 기준 |
| 최소 합격률(PASS_RATE_MIN 15) | ✅ | gradingService, statsService |

---

## 7. 채점·진단 Elo

| 항목 | 적용 여부 | 위치 |
|------|-----------|------|
| 진단 roundId (l_1, m_2, h_3) 시 prepLevel 기반 Elo 보정 | ✅ | gradingService: useBetaCertifications && isDiagnosticRoundId && prepLevel |
| exam_results.roundId 저장 | ✅ | options?.roundId |

---

## 8. 기타 베타 전용

| 항목 | 적용 여부 | 비고 |
|------|-----------|------|
| 쿠폰 입력(랜딩·LNB) | ✅ | FEATURE_COUPON \|\| APP_BRAND === 'AiBT' |
| 구글 로그인만 노출(베타) | ✅ | LoginModal IS_BETA_GOOGLE_ONLY |
| 문제 신고(Quiz) | ✅ | useBetaCertifications && 문제 신고 UI |
| BETATEST 쿠폰 사용 중지 시 팝업 | ✅ | showBetatestEndedPopup |

---

## 9. 확인 시 주의사항

- **업데이트 팝업이 안 나올 수 있는 경우**  
  - 이미 "새로운 진단 시작하기"를 한 번 눌러 localStorage에 저장된 경우  
  - 로그인 시 `is_verified !== true`로 오는 경우(이메일 미인증 등)  
- **로그인 모달**  
  - 로그인 성공 시 user가 설정되면 effect로 모달이 닫히므로, 리다이렉트·재로그인 모두 동일하게 동작해야 함.  
- **합격률**  
  - 베타는 3회 미만이면 숫자 미표시(MyPageBeta). 실서버(핀셋) MyPage는 1회부터 표시 가능.

---

## 10. 이번에 수정한 코드 요약

1. **App.tsx**  
   - handleLogout: 로그아웃 시 `setShowLoginModal(false)`, `setLoginModalIntent(null)`, `setLoginModalInitialCouponStep(null)` 호출.  
   - user가 truthy일 때 로그인 모달 닫는 useEffect 추가.  
   - handleLoginModalAuthSuccess의 else 분기: 기존 유저도 `isBeta && options?.is_verified && !getBetaUpdateModalSeen()`이면 업데이트 팝업 노출.

2. **LoginModal.tsx**  
   - 쿠폰 보유 재로그인 시 `onAuthSuccess({ isNewUser: false, is_verified: appUser.is_verified === true })` 전달.
