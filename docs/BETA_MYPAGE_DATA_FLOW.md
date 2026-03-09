# 베타·로컬 마이페이지 데이터 흐름 검토

**목적**: 베타 로컬 서버에서만 동작해야 하는 로직과, 베타 실서버와 공유되는 로직을 명확히 구분한다. **베타 실서버에는 절대 영향을 주지 않는다.**

---

## 1. 베타 / 로컬 구분 (config/brand.ts)

| 플래그 | 조건 | 로컬 dev (npm run dev:beta) | 베타 실서버 (배포) |
|--------|------|-----------------------------|---------------------|
| `import.meta.env.DEV` | 개발 모드 | ✅ true | ❌ false |
| `APP_BRAND` | VITE_APP_BRAND | 'AiBT' 등 | 'AiBT' 등 |
| **`isBetaLocal`** | **DEV && (FEATURE_COUPON \|\| APP_BRAND === 'AiBT')** | **✅ true** | **❌ false** |
| `useBetaCertifications` | isBetaLocal \|\| APP_BRAND === 'AiBT' | ✅ true | ✅ true |

- **로컬 전용**으로 둘 로직은 반드시 **`isBetaLocal`**로 분기한다.
- `useBetaCertifications`는 베타 서버에서도 true이므로, “로컬에서만” 제한에는 사용하지 않는다.

---

## 2. 데이터 저장 경로 (베타/실서버 동일)

마이페이지의 **과목별 안전도·취약 개념·유형별 분석**은 아래 경로만 사용한다. **certifications_beta는 문항 풀(인덱스/문제)에만** 쓰이고, 사용자 학습 데이터에는 쓰이지 않는다.

| 데이터 | Firestore 경로 | 비고 |
|--------|-----------------|------|
| 시험 결과(트렌드) | `users / {uid} / exam_results / {examId}` | 서브컬렉션, certCode/certId·submittedAt 필수 |
| 통계(과목/유형/개념) | `users / {uid} / stats / {certCode}` | 서브컬렉션, 문서 ID = 'BIGDATA' 등 certCode |
| 자격증 설정·과목명 | `certifications / {certCode} / certification_info / config` | 베타에서도 동일 컬렉션 (문항만 certifications_beta) |

즉, **마이페이지 표시용 학습 데이터는 베타 로컬이든 베타 실서버든 같은 Firestore 경로**를 읽고 쓴다.

---

## 3. 과목별 안전도 분석 (표시 로직)

### 3.1 데이터 소스

1. **MyPage**  
   - `loadMyPageData(forceRefresh)` → `getCachedOrFetchMyPageData(user.id, activeCert.code, { forceRefresh })`  
   - `activeCert` = `CERTIFICATIONS.find(c => c.id === activeCertId)` → `activeCert.code` 예: `'BIGDATA'`

2. **statsServiceWithCache**  
   - 캐시 유효 시: IndexedDB `userStatsCache`의 `subjectScores` 반환.  
   - 캐시 무효 시: `fetchDashboardStats(uid, certCode)` 호출.

3. **statsService.fetchDashboardStats**  
   - `users/{uid}/stats/{certCode}` 문서에서 `subject_stats` (과목별 correct/total/proficiency) 읽음.  
   - `users/{uid}/exam_results` 서브컬렉션을 `orderBy('submittedAt','desc')`, limit(50) 후, `isExamForCert(doc, certCode)`로 필터한 뒤 최대 5건 사용.  
   - **과목별 점수 결정**:  
     - `latestSubjectScores` = 위 최근 시험 중 **첫 번째로 `subject_scores`가 있는 문서**의 `subject_scores`.  
     - `subjectKeys` = `subject_stats` 키 ∪ `latestSubjectScores` 키 (없으면 최근 시험들에서 키 수집).  
     - 각 과목(키)별:  
       - 점수 = `latestSubjectScores[key]` ?? (최근 시험들의 해당 과목 평균) ?? `understandingFromStat(subject_stats[key])`  
       - 99% 상한 적용.

4. **MyPage 표시**  
   - `hasLearningHistory` = `trend.length > 0` (트렌드가 있으면 true).  
   - `displaySubjectScores` = `hasLearningHistory ? subjectScores : []`.  
   - 카드 1: `displaySubjectScores.length ? displaySubjectScores : freeSubjectScoresForDisplay` 를 최대 4과목까지 막대(% )로 표시.  
   - 학습 이력 없으면 "데이터가 없습니다" 메시지.

### 3.2 베타 로컬 전용 처리

- **statsService**의 “orderBy 결과 0건일 때 orderBy 없이 재조회” fallback은 **로컬에서만** 동작하도록 **`isBetaLocal`**로 감싼다 (아래 6절).  
- 그 외 과목별 안전도 계산·표시 로직은 베타/실서버 공통이며, **베타 실서버에 별도 영향 없음**.

---

## 4. 취약 개념 분석 (표시 로직)

### 4.1 데이터 소스

1. **fetchDashboardStats**  
   - `sub_core_id_stats` 존재 시: sub_core_id → coreId(앞부분) 합산 후, `agg.total >= 3`인 것만 이해도(accuracy) 낮은 순 정렬, 상위 3개 → `weaknessTop3` (이름 `개념 ${coreId}`, id = coreId).  
   - 없으면 `core_concept_stats`에서 `total >= 3 && correct >= 1`인 것만 이해도 낮은 순 상위 3개.

2. **MyPage 표시**  
   - `displayWeaknessTop3` = `hasLearningHistory ? weaknessTop3 : []`.  
   - 각 항목: `w.id` 또는 이름에서 숫자 추출 → `resolvedId`.  
   - **BIGDATA**: `activeCert?.code === 'BIGDATA' && BIGDATA_CORE_CONCEPTS_BY_ID[resolvedId]` 있으면 그 개념명·키워드 사용 (로컬 상수). 없으면 `certInfo?.core_concepts_by_id?.[resolvedId]`.  
   - 그 외 자격증: `certInfo?.core_concepts_by_id?.[resolvedId]`.  
   - `displayName` = byId?.concept ?? w.name.  
   - 학습 이력 없으면 빈 메시지; 있지만 weaknessTop3 비어 있으면 "아직 취약 개념이 분석되지 않았어요."

### 4.2 베타 실서버

- 취약 개념 계산은 모두 공통 경로(`users/{uid}/stats/{certCode}`).  
- BIGDATA 개념명은 로컬 상수 우선이지만, 이는 “표시 이름”만 바꾸는 것이고 **베타 실서버에도 동일 코드가 적용**된다. 실서버에 “영향을 주지 말라”는 것은 **데이터 저장/조회 경로나 로직 분기**를 바꾸지 말라는 의미이므로, 표시 이름 우선순위는 유지해도 됨.  
- **로컬 전용**으로 추가한 fallback만 `isBetaLocal`로 제한.

---

## 5. 유형별 분석 (표시 로직)

### 5.1 데이터 소스

1. **fetchDashboardStats**  
   - `problem_type_stats`를 읽어 유형별 이해도 계산.  
   - `PROBLEM_TYPE_LABELS` 순서로 5축 고정: `radarData` = [단순암기형, 개념이해형, 계산풀이형, 결과독해형, 실무적용형] 각각에 대해 `typeToA.get(label) ?? 0`.

2. **MyPage**  
   - `displayRadarData` = `hasLearningHistory ? radarData : []`.  
   - `radarChartData` = displayRadarData 있으면 그대로, 없으면 5개 라벨에 A:0 fallback.  
   - 레이더 차트로 5축 표시, 최소값 유형을 weakestSubject로 강조.

### 5.2 베타 실서버

- 유형별 분석도 동일 경로·동일 로직. **로컬 전용 fallback만** `isBetaLocal`로 제한하면 됨.

---

## 6. 유저 정보가 마이페이지에서 쓰이는 방식

### 6.1 User 타입 (Firestore users/{uid} + AuthContext)

- `id`, `email`, `familyName`, `givenName`, `name`, `isAdmin`, `isPremium`, `subscriptions`, `paidCertIds`, `expiredCertIds`, `prepLevel`, `usedBetatestCoupon` 등.

### 6.2 MyPage에서의 사용

- **activeCertId**: `user.subscriptions?.[0]?.id ?? user.paidCertIds?.[0] ?? CERTIFICATIONS[0].id` (및 initialCertId 반영).  
- **hasPayment**: `(user.paidCertIds?.length ?? 0) > 0 || user.isPremium === true`.  
- **effectiveSubscriptions**: subscriptions 있으면 그대로, 없으면 paidCertIds → CERTIFICATIONS 매핑, 없으면 initialCertId 기반 1개, 없으면 [].  
- **loadMyPageData**: `user.id`, `activeCert.code` → getCachedOrFetchMyPageData(user.id, certCode).  
- **isPremiumCert**: `user.isPremium || user.paidCertIds?.includes(activeCertId)`.  
- **헤더**: 자격증명·회차·D-Day 등은 certInfo·schedules 기반. 사용자 이름은 여기서 직접 안 쓰이고, **사이드바**에서 사용.

### 6.3 DashboardSidebar

- `user.givenName`, `user.name`으로 아바타/이름 표시.  
- `user.subscriptions` 등으로 자격증 목록.

### 6.4 베타 로컬 전용 유저 필드

- `prepLevel` (베타 로컬 쿠폰 플로우에서 저장) 등은 **저장만** 로컬/베타에서 하고, 마이페이지 표시 로직은 공통.  
- “유저 정보가 어떻게 퍼지는지”는 위와 동일하게 베타/실서버 동일 코드 경로이며, **로컬 전용 분기는 fallback에만 isBetaLocal 사용**.

---

## 7. 베타 실서버에 영향 주지 않기 (요약)

- **데이터 경로**: `users/{uid}/exam_results`, `users/{uid}/stats/{certCode}` — 변경하지 않음.  
- **공통 로직**: 과목별 안전도·취약 개념·유형별 분석의 계산·표시는 그대로 두고, **로컬에서만** 필요한 복구/디버깅만 추가할 때는 아래를 준수한다.  
  - **statsService**에서  
    - “orderBy 쿼리 실패 시 orderBy 없이 재조회”,  
    - “orderBy 결과 0건일 때 orderBy 없이 재조회”,  
    - “fetchDashboardStats에서 exam_results 조회 실패 시 orderBy 없이 재조회”  
    같은 **fallback**은 **`isBetaLocal`이 true일 때만** 실행한다.  
  - 개발용 `console.info`/`console.warn`은 `process.env.NODE_ENV === 'development'`로만 감싸면 되며, 베타 실서버는 production 빌드이므로 이미 제외됨.

이렇게 하면 **베타 로컬 서버에서만** fallback이 동작하고, **베타 실서버에는 영향이 가지 않는다.**
