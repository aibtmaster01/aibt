# Firebase Read 우려 구간 정리 (취약개념 / 오답다시풀기 포함)

취약개념·오답다시풀기·과목강화·취약유형 등 기능에서 사용하는 Firestore read 패턴을 정리하고, 우려되는 부분만 표시했습니다.

---

## 1. 이미 제한이 있는 구간 (참고용)

| 위치 | 내용 | 제한 |
|------|------|------|
| **examService** `fetchExamResultAnswerSets` | `users/{uid}/exam_results` (오답/정답 ID 수집) | `orderBy('submittedAt','desc'), limit(100)` |
| **examService** `fetchAllPoolQuestions` | `collectionGroup('questions')` + cert_id | `limit(2000)` |
| **examService** `fetchQuestionsFromPools` | `collectionGroup('questions')` + `where('q_id','in',chunk)` | chunk당 최대 30개, 청크 수만큼 쿼리 |
| **examService** `getQuestionsForRound` | user_rounds 1 getDoc, static_exams 1 getDoc, 필요 시 fetchQuestionsFromPools | 문서 수 고정 |
| **aiRoundCurationService** `fetchUserExamResultAnswerSets` | `users/{uid}/exam_results` | `orderBy, limit(100)` |
| **aiRoundCurationService** `hasCompletedStatic45` | `users/{uid}/exam_results` | `orderBy, limit(80)` |
| **aiRoundCurationService** `fetchAllPoolQuestions` | collectionGroup questions | `limit(2000)` (캐시 있으면 0 read) |
| **statsService** `fetchUserTrendData` | `users/{uid}/exam_results` | `orderBy('submittedAt','asc'), limit(30)` |
| **statsService** `fetchHasAnyExamRecord` | `users/{uid}/exam_results` | `limit(1)` |
| **ExamList.tsx** 완료 회차 로딩 | `users/{uid}/exam_results` | `orderBy, limit(150)` |

---

## 2. 우려되는 구간 (개선 권장)

### 2-1. **높음** – 무제한 Read

| 위치 | 내용 | 우려 |
|------|------|------|
| **adminService** `fetchUserQuestionCount` | `getDocs(collection(db, 'users', uid, 'exam_results'))` **limit 없음** | 한 유저가 시험 수백 회 응시 시 문서 수만큼 read. 관리자 기능이지만 비용·지연 증가 가능. |
| **adminService** `subscribeToUsers` | `onSnapshot(collection(db, 'users'))` **전체 users 컬렉션** | 유저 수만큼 read + 실시간 구독. 관리자 전용이어도 유저 수가 크면 비용·성능 이슈. |

**권장**

- `fetchUserQuestionCount`: `query(examRef, orderBy('submittedAt','desc'), limit(N))` 추가 후, 필요 시 `totalQuestions`만 합산하거나 페이지네이션/집계 필드 도입.
- `subscribeToUsers`: 관리자만 사용한다면 유지 가능하나, 가능하면 `limit` 또는 조건부 쿼리 + 페이지네이션 검토.

---

### 2-2. **중간** – 호출 1회당 Read 수가 많음 (취약/오답 기능)

| 위치 | 기능 | Read 구성 | 우려 |
|------|------|-----------|------|
| **examService** `fetchSubjectStrengthTraining50` | 과목 강화 50문항 | 1) exam_results 100건 2) allPool 2000건 3) stats 1건 4) 오답 ID로 fetchQuestionsFromPools(최대 50개 기준 약 2청크 = 2쿼리) | 풀 2000 read가 매번 발생. |
| **examService** `fetchWeakTypeFocus50` | 취약 유형 50문항 | 동일 (exam_results 100 + allPool 2000 + stats 1 + fetchQuestionsFromPools) | 동일. |
| **examService** `fetchWeakConceptFocus50` | 취약 개념 50문항 | 동일 | 동일. |
| **examService** `generateWeaknessAttackMode` (오답다시풀기/약점 공략) | Round 5 약점 80문항 | exam_results 100 + allPool 2000 + stats 1. 추가로 fetchFromCollectionGroupFallback 시 needed*3 문서 | 1회 호출에 2000+ read 고정. |
| **examService** `generateRealExamMode` | 실전 대비형 80문항 | exam_results 100 + allPool 2000 | 동일. |
| **examService** `generateAiMockExam` (맞춤형) | Round 4+ 80문항 | pool 1회 getDocs + fetchWeaknessQuestions(plan 수만큼 getDocs) + fetchRandomQuestionsFromPools(계층 수*2) + 필요 시 fetchFromCollectionGroupFallback 2회 | 계층/plan 수에 따라 수십~수백 read 추가. |
| **examService** `fetchWeaknessQuestions` | plan별 hierarchy 풀 조회 | plan 항목마다 question_pools 하위 1 getDocs. fallback 시 collectionGroup 1회(limit item.count*3) | plan 수·fallback 사용 시 read 증가. |

**권장**

- **풀 메타/스텁 캐시**: `aiRoundCurationService`처럼 `question_pools` 또는 collectionGroup 결과를 IndexedDB 등으로 메타데이터 캐시하고, 과목강화/취약유형/취약개념/오답다시풀기는 “오답 ID 목록 + stats” 위주로만 Firestore를 쓰고 풀 데이터는 캐시에서 조합하는 방식 검토.
- **exam_results**: 이미 100으로 제한되어 있어 유지. 필요 시 “오답만 모은 서브컬렉션/집계 문서” 도입 시 read 추가 절감 가능.

---

### 2-3. **중간** – collectionGroup 대량 스캔

| 위치 | 내용 | 우려 |
|------|------|------|
| **examService** `fetchAllPoolQuestions` | `collectionGroup(db,'questions'), where('cert_id','==',certCode), limit(2000)` | cert별로 최대 2000 read. 호출 빈도가 높으면 비용 큼. |
| **examService** `fetchFromCollectionGroupFallback` | `cert_id + random_id` 조건, `limit(needed*3)` 1~2회 | 필요 문항의 3배 수 read. |
| **aiRoundCurationService** `fetchAllPoolQuestions` | 동일 (단, IndexedDB 캐시 있으면 0 read) | 캐시 미스 시 2000 read. |

**권장**

- examService 쪽도 “메타데이터 1회 로드 후 캐시” 패턴을 적용하면, 취약/오답/과목강화/취약유형/취약개념 호출 시 collectionGroup read를 크게 줄일 수 있음.

---

### 2-4. **버그** – 잘못된 문서 경로

| 위치 | 내용 | 조치 |
|------|------|------|
| **MyPage.tsx** `handleWrongAnswers` | `getDoc(doc(db, user.id, "exam_results", examId))` | 경로가 `users/{uid}/exam_results/{examId}`가 아님. `doc(db, 'users', user.id, 'exam_results', examId)`로 수정 필요. |

현재는 `user.id`가 컬렉션 ID처럼 쓰여, `users` 컬렉션을 읽지 않습니다. 오답 보기 등이 동작하지 않거나 잘못된 경로를 읽을 수 있습니다.

---

## 3. 기능별 Read 요약

- **오답 다시풀기 / 약점 공략(Round 5)**  
  - `getQuestionsForWeaknessRound` → `generateAiMockExam(..., 'WEAKNESS_ATTACK')`  
  - `fetchExamResultAnswerSets`(100) + `fetchAllPoolQuestions`(2000) + `fetchStatsDoc`(1) + 필요 시 fallback.

- **취약 개념 50문항**  
  - `fetchWeakConceptFocus50`: exam_results 100 + allPool 2000 + stats 1 + fetchQuestionsFromPools(오답 ID).

- **취약 유형 50문항**  
  - `fetchWeakTypeFocus50`: 동일 패턴.

- **과목 강화 50문항**  
  - `fetchSubjectStrengthTraining50`: 동일 패턴.

- **맞춤형 Round 4+ (20/80문항)**  
  - `fetchAdaptiveQuestions` → `generateAdaptiveExam` 또는 `generateAiMockExam`:  
  - aiRoundCuration은 캐시 시 풀 0 read; examService 경로는 풀 2000 + exam_results 100 등.

---

## 4. 요약 표

| 구분 | 항목 | 권장 |
|------|------|------|
| 버그 | MyPage `doc(db, user.id, ...)` | `doc(db, 'users', user.id, 'exam_results', examId)` 로 수정 |
| 높음 | adminService `fetchUserQuestionCount` 무제한 getDocs | `limit` 또는 집계 구조 도입 |
| 높음 | adminService `subscribeToUsers` 전체 users | 관리자 전용 유지 시 유의, 필요 시 limit/페이지네이션 |
| 중간 | 과목강화/취약유형/취약개념/오답다시풀기 시 풀 2000 read 반복 | 풀 메타 캐시(IndexedDB) 적용 검토 |
| 중간 | examService 쪽 collectionGroup 2000 | aiRoundCuration처럼 메타 캐시 후 재사용 검토 |

이 문서는 취약개념·오답다시풀기·과목강화·취약유형 등 관련 Firebase read만 정리한 것이며, authService/gradingService 등 다른 서비스의 read는 제외했습니다.
