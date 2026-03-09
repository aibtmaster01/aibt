# 베타 분기 전체 검토 — 실서버 신뢰도 보호

**목적**: 베타 테스터(실서버)에게 영향을 줄 수 있는 모든 파일과 분기 지점을 꼼꼼히 정리한다.  
**원칙**: 베타 로컬 전용 실험은 **반드시 isBetaLocal 또는 전용 컴포넌트(_beta)** 로만 적용하고, 베타 실서버 빌드에는 기존 동작이 유지되어야 한다.

---

## 1. 현재 플래그 정의 (config/brand.ts) — 재확인 필요

| 플래그 | 현재 조건 | 베타 로컬 (DEV) | 베타 실서버 (배포) |
|--------|-----------|------------------|---------------------|
| `isBetaLocal` | `import.meta.env.DEV && (FEATURE_COUPON \|\| APP_BRAND === 'AiBT')` | ✅ true | ❌ false |
| `useBetaCertifications` | `isBetaLocal \|\| APP_BRAND === 'AiBT'` | ✅ true | ✅ **true** |

**리스크**: `useBetaCertifications`가 베타 실서버에서도 true이므로, 실서버에서 이미 **certifications_beta** 인덱스/문항을 쓰고 있다.  
여기서 “베타 실서버는 certifications, 베타 로컬만 certifications_beta”로 바꾸려면 **`useBetaCertifications = isBetaLocal`** 로 변경해야 한다.  
그 경우 **아래 2절의 모든 서비스/훅**이 실서버에서는 `certifications`만 쓰게 되므로,  
- 실서버에 이미 저장된 exam_results의 문항 ID가 certifications_beta 전용이면 **오답확인 시 문항이 안 나올 수 있음**  
- 실서버 빌드 전에 “실서버는 항상 certifications만 사용했다”는 전제가 맞는지 반드시 확인할 것.

---

## 2. useBetaCertifications / getCertificationsCollection 를 쓰는 파일 (데이터 소스 분기)

이 파일들은 **“BIGDATA 문항/인덱스를 certifications에서 가져올지, certifications_beta에서 가져올지”** 에 관여한다.  
`useBetaCertifications`를 `isBetaLocal` 전용으로 바꾸면, **베타 실서버에서는 모두 certifications만 사용**하게 된다.

| 파일 | 용도 | 베타 실서버 영향 |
|------|------|------------------|
| **src/services/db/localCacheDB.ts** | `syncQuestionIndex`, `getQuestionIndexFromCache`, `clearQuestionIndexCache`, `fetchBetaIndexFromFirestore` | BIGDATA 인덱스: 베타 실서버는 Storage + certifications/public/index 경로 사용. `USE_FIRESTORE_INDEX_ONLY`는 FEATURE_COUPON \|\| APP_BRAND === 'AiBT' 로 여전히 베타 빌드 전반에 적용됨. |
| **src/services/examService.ts** | `getCertificationsCollection`(문항 getDoc), `isBetaDiagnostic`, `roundKeyForStorage`, 진단 1~3회차 40문항·레벨드 인덱스 | 문항 조회·회차 키: 실서버는 certifications + 기존 회차(1,2,3…)만 사용. |
| **src/services/gradingService.ts** | 진단 round 제출 시 `updateEloAfterDiagnostic`, `getCertificationInfo`는 항상 certifications | Elo: 실서버에서는 진단 전용 Elo 재조정 안 함 (prepLevel 없음 또는 useBetaCertifications false). |
| **src/services/aiRoundCurationService.ts** | 문항 getDoc 시 `getCertificationsCollection`, 레벨드 인덱스·prepLevel | AI 라운드 문항: 실서버는 certifications에서만 조회. |
| **src/services/adminQuestionService.ts** | 문항 doc ref 시 `getCertificationsCollection` | 관리자 문항 조회: 실서버는 certifications. |

**분기 전략**  
- **옵션 A**: `useBetaCertifications = isBetaLocal` 로 변경 → 위 파일들은 수정 없이, 실서버는 자동으로 certifications만 사용.  
- **옵션 B**: `useBetaCertifications` 유지 시, 실서버도 계속 certifications_beta 사용.  
- **공통**: “문항 소스” 분기는 **이 레이어에서만** 하고, UI는 가능한 한 **App.tsx 라우트/컴포넌트 분기**로만 처리하는 것이 안전하다.

---

## 3. isBetaLocal 만 쓰는 파일 (로컬 전용 — 실서버 무영향)

이미 **로컬(DEV)에서만** 동작하므로 베타 실서버에는 영향 없다.

| 파일 | 용도 |
|------|------|
| **src/services/statsService.ts** | exam_results orderBy 실패/0건 시 fallback 재조회, fetchDashboardStats exam_results fallback, 개발용 로그 |
| **src/components/OrientationPopup.tsx** | `showLevelFirst`(난이도 먼저 노출), `setInitialEloByPrepLevel` 호출 |

**유지**: 계속 `isBetaLocal`로만 분기하면 된다.

---

## 4. APP_BRAND / FEATURE_COUPON / isBeta 를 쓰는 파일 (베타 빌드 공통)

베타 실서버에 배포되는 빌드에서도 동일하게 적용된다. “실서버 신뢰도”와 직결되는 부분만 정리.

| 파일 | 용도 | 비고 |
|------|------|------|
| **src/App.tsx** | `isBeta`, `FEATURE_COUPON`, `useBetaCertifications`, 오리엔테이션 강제/쿠폰 플로우, 로그인 모달 persistent, `renderContent` vs 랜딩, 쿠폰/오리엔테이션 LNB | **분기 중심**: MyPage/OrientationPopup/ExamList/Quiz/Result 를 **isBetaLocal 일 때만** _beta 컴포넌트로 스왑하는 것이 좋음. |
| **src/components/LoginModal.tsx** | `IS_BETA_GOOGLE_ONLY` → 구글 로그인만 노출 | 베타 테스터 경험 일부. 의도된 동작이면 유지. |
| **src/components/DashboardSidebar.tsx** | `APP_BRAND`, `FEATURE_COUPON`(쿠폰 버튼) | 브랜드/기능 노출만. |
| **src/components/empty-state.tsx** | `APP_BRAND`, `APP_BRAND_LANDING` | 문구만. |
| **src/pages/Checkout.tsx** | `FEATURE_COUPON` → 쿠폰 입력 vs 결제 UI | 베타는 쿠폰 플로우. |
| **src/pages/Result.tsx** | `APP_BRAND` 문구 | 문자열만. |
| **src/hooks/useAppBootstrap.ts** | `APP_BRAND`(document.title), `syncQuestionIndex('BIGDATA')` | 제목 + 인덱스 동기화. 동기화는 localCacheDB 분기 따라감. |

**주의**: `App.tsx`에서 **라우트별로 렌더할 컴포넌트**만 isBetaLocal 기준으로 MyPage_beta / OrientationPopup_beta 등으로 바꾸고, 나머지 로직은 기존 그대로 두면 실서버가 안정된다.

---

## 5. 추가로 분기/검토가 필요한 파일 (이미 논의된 것 외)

앞서 말한 **MyPage, OrientationPopup, ExamList, Quiz, Result** 외에, 아래도 한 번씩 짚는 것이 좋다.

### 5.1 반드시 검토 권장

| 파일 | 이유 | 권장 조치 |
|------|------|-----------|
| **src/hooks/useAppBootstrap.ts** | 매 로드 시 `syncQuestionIndex('BIGDATA')` 호출. `useBetaCertifications`가 true인 베타 실서버는 현재 certifications_beta 인덱스를 동기화함. | `useBetaCertifications = isBetaLocal` 로 바꾸면 별도 수정 없이 실서버는 certifications 경로만 사용. 그대로 두면 실서버도 계속 certifications_beta 사용. |
| **src/App.tsx** | `handleViewExamResult`(오답확인)에서 `exam.fetchQuestionsFromPools(certCode, qids)` 호출 → `getCertificationsCollection` 사용. | 실서버를 certifications 전용으로 바꾼다면, **과거에 certifications_beta 기준으로 저장된 exam_results**는 문항 ID가 certifications에 없을 수 있어 오답확인 시 문항이 비어 보일 수 있음. 데이터 이력 확인 필요. |
| **src/App.tsx** | `handleQuizFinish` → `submitQuizResult(..., { prepLevel })` 전달. `useBetaCertifications && user.prepLevel` 일 때만 prepLevel 넘김. | `useBetaCertifications = isBetaLocal` 이면 실서버에서는 prepLevel 미전달 → gradingService의 진단 Elo 재조정이 실서버에서 안 돌아감. 의도에 맞음. |
| **src/pages/ExamList.tsx** | `useBetaCertifications`로 baseRounds(진단 l_1~h_3), 40/80 문항 수 선택, pendingRoundId UI. | 실서버에서 useBetaCertifications false면 기존 EXAM_ROUNDS만 표시. **컴포넌트 분기**는 “실서버 = 기존 ExamList, 로컬 = ExamList_beta”로 두면 명확. |
| **src/pages/Quiz.tsx** | `useBetaCertifications`로 40/80 선택 UI, 제출 전 추가 안내 등. | 실서버에서는 해당 UI 비노출. 로컬 전용 UI는 Quiz_beta로 빼거나, 기존대로 useBetaCertifications로 숨기면 됨. |

### 5.2 실서버에 영향 적지만 한 번 확인할 것

| 파일 | 내용 |
|------|------|
| **src/services/authService.ts** | `prepLevel`은 Firestore 사용자 문서에서 읽기만 함. 저장은 OrientationPopup(로컬 전용) 등에서 함. 실서버 사용자는 prepLevel 없을 수 있음 → 이미 다른 분기에서 처리됨. |
| **src/services/couponService.ts** | `isBetatest`는 쿠폰 코드 문자열 "BETATEST" 여부만 사용. 환경 분기 아님. |
| **src/pages/AdminBilling.tsx** | `isBetatest`로 “배포용 베타테스트” 문구 등. 쿠폰 코드 기준이라 환경 분기 아님. |
| **src/contexts/AuthContext.tsx** | `process.env.NODE_ENV === 'development'` 로그만. 실서버 무영향. |
| **src/services/gradingService.ts** | `getCertificationInfo`는 항상 `certifications/{certCode}/certification_info/config`. 베타/로컬 구분 없음. |

---

## 6. examService 내부의 하드코딩 'certifications'

다음 함수들은 **컬렉션명이 'certifications'로 하드코딩**되어 있다.

- `fetchRandomQuestionsFromPools` (poolRef, qRef)
- `fetchFromCollectionGroupFallback` (collectionGroup 'questions' 사용)
- `generateAdaptiveExamPlan` 내 poolRef, fetchAllPoolQuestions 호출
- 기타 question_pools 나열용 `collection(db, 'certifications', ...)`

**의미**:  
- BIGDATA가 아닌 자격증(SQLD 등)은 어차피 certifications만 사용.  
- BIGDATA라도 **맞춤형/적응형 플랜** 등에서 풀 목록·랜덤 문항을 가져오는 경로는 현재 항상 certifications.  
- `getCertificationsCollection`을 쓰는 곳은 **BIGDATA 문항 getDoc** 구간뿐이다.

**결론**:  
- 베타 실서버를 certifications만 쓰게 하면, 위 하드코딩 경로와 일치한다.  
- 베타 로컬에서 “맞춤형”을 certifications_beta 기준으로 돌리려면, 나중에 pool 나열/랜덤 문항도 `getCertificationsCollection` 또는 별도 플래그로 분기해야 할 수 있음. 지금은 **문항 getDoc 분기만** 해도 실서버 보호에는 충분하다.

---

## 7. 분기 처리 체크리스트 (실서버 신뢰도 보호)

- [ ] **config/brand.ts**  
  - 베타 실서버를 “certifications만 사용”으로 할지 결정.  
  - 할 경우: `useBetaCertifications = isBetaLocal` 로 변경하고, 기존 실서버 exam_results/문항 이력 검토.

- [ ] **App.tsx**  
  - `route`/화면별로 **isBetaLocal 일 때만** MyPage_beta, OrientationPopup_beta, (필요 시) ExamList_beta, Quiz_beta 사용.  
  - 나머지 로직(handleQuizFinish, handleViewExamResult 등)은 기존 유지.  
  - prepLevel 전달은 이미 `useBetaCertifications && user.prepLevel`에 묶여 있으므로, useBetaCertifications를 isBetaLocal로 바꾸면 실서버에는 prepLevel 안 넘어감.

- [ ] **MyPage_beta.tsx**  
  - 예측 합격률: 3회 이상 시험, 난이도별 가중치, 과목별 안전도 계산식 등 로컬 전용 규칙만 구현.

- [ ] **OrientationPopup_beta.tsx**  
  - 난이도(레벨) 선택 포함. 기존 OrientationPopup은 실서버용으로 그대로.

- [ ] **ExamList / Quiz**  
  - 실서버: 기존 ExamList, Quiz (certifications + EXAM_ROUNDS).  
  - 로컬: ExamList_beta, Quiz_beta 또는 동일 컴포넌트에 “데이터 소스”만 isBetaLocal로 주입.  
  - 모의고사 이름·문제 수·round 이름은 실서버 = constants + certifications, 로컬 = certifications_beta + 레벨드 round 키.

- [ ] **Result**  
  - 문구만 APP_BRAND 사용. 별도 Result_beta 없이 유지 가능. 필요 시 문구만 분기.

- [ ] **useAppBootstrap**  
  - `syncQuestionIndex('BIGDATA')` 유지.  
  - useBetaCertifications를 isBetaLocal로 바꾸면, 실서버에서는 localCacheDB가 자동으로 certifications 경로만 사용.

- [ ] **statsService**  
  - fallback은 이미 isBetaLocal로만 동작. 추가 분기 불필요.

- [ ] **그 외 서비스**  
  - localCacheDB, examService, gradingService, aiRoundCurationService, adminQuestionService는 **getCertificationsCollection / useBetaCertifications** 만 사용하므로, config 변경만으로 실서버/로컬 데이터 소스 분리 가능.  
  - 이 레이어에서 “화면별” 분기는 넣지 말고, **UI 분기는 App.tsx + _beta 컴포넌트**에만 두는 것을 권장.

---

## 8. 요약: “또 분기해야 할 파일” 정리

- **이미 계획된 분기**  
  MyPage, OrientationPopup, ExamList, Quiz (및 필요 시 Result) — **App.tsx에서 isBetaLocal로 _beta 스왑**.

- **추가로 “한 번 더 검토”할 파일**  
  - **useAppBootstrap.ts** — syncQuestionIndex는 그대로 두고, config의 useBetaCertifications 정의만 정리.  
  - **App.tsx** — handleViewExamResult(오답확인) 시 문항 소스가 바뀜에 따른 과거 데이터 호환성.  
  - **ExamList.tsx, Quiz.tsx** — 실서버에서는 useBetaCertifications가 false가 되면 기존 UI만 보이므로, 컴포넌트 분기를 _beta로 완전히 나누면 더 명확.

- **분기 넣지 말아야 할 파일**  
  - statsService (이미 isBetaLocal만 사용), authService, couponService, AdminBilling, AuthContext — 환경 분기 추가 없이 유지.

- **데이터 소스 분기 한 곳에서**  
  - `useBetaCertifications`를 **isBetaLocal 전용**으로 바꿀지 여부만 결정하면,  
  - localCacheDB, examService, gradingService, aiRoundCurationService, adminQuestionService, ExamList, Quiz, App.tsx의 prepLevel 전달이 **한 번에** 실서버 = certifications, 로컬 = certifications_beta 로 정리된다.

이렇게 하면 **화면/플로우 변경은 _beta 컴포넌트와 App.tsx에만** 모이고, **데이터 소스는 config 한 줄과 기존 getCertificationsCollection 사용처**로만 제어되어, 베타 테스터 실서버 신뢰도를 안전하게 유지할 수 있다.
