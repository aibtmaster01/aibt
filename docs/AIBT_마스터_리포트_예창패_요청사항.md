# AIbT 마스터 리포트 — 예비창업패키지 사업계획서 작성용

본 문서는 **예비창업패키지 제출용 사업계획서**를 작성할 AI 에이전트에게 전달하는 참고 자료입니다.  
요청할 작업 4가지와 **코드베이스에서 확인된 구체적 내용**, 추가 어필 포인트를 정리했습니다.

---

## 문서 사용 방법

- **사업계획서 작성 에이전트**에게 이 문서를 컨텍스트로 제공한 뒤, 각 섹션의 **「요청 내용」**을 수행하도록 지시하면 됩니다.
- **코드에 실제로 존재하는 값·흐름**은 「코드베이스 기준 정리」에 적었고, **코드에 없는 기획/설계**는 「추가 확인 필요」로 표시했습니다.

---

## 1. 시스템 아키텍처 및 데이터 흐름 (ERD·시퀀스)

### 1.1 개발자에게 요청할 내용

- **「사용자가 답안을 제출한 순간부터 `exam_results` 저장, ELO 갱신, weakness_stats 업데이트까지의 데이터 파이프라인 시퀀스 다이어그램을 그려줘.»**
- Firestore의 `users`, `stats`, `questions` 문서가 **시험 종료 후 어떤 순서로 갱신되는지** 시각적 흐름이 필요합니다.

### 1.2 관련 Firestore 경로 (전문)

| 문서/컬렉션 | Firestore 경로 | 주요 필드/용도 |
|-------------|----------------|----------------|
| 시험 설정 | `certifications/{certCode}/certification_info/config` | `exam_config.pass_criteria` (average_score, min_subject_score), `subjects[]` (subject_number, name, score_per_question, question_count) |
| 시험 결과 | `users/{uid}/exam_results/{examId}` | certId, certCode, roundId, subject_scores, is_passed, predicted_pass_rate, totalQuestions, correctCount, answers[], submittedAt |
| 사용자 통계 | `users/{uid}/stats/{certCode}` | hierarchy_stats, problem_type_stats, subject_stats, tag_stats (각 키별 correct, total, misconception_count, proficiency), confused_qids[] |
| 사용자 Elo | `users/{uid}` | elo_rating_by_cert: { [certId]: number } |
| 고정 시험 장부 | `certifications/{certCode}/static_exams/Round_{N}` | question_refs: [{ q_id, difficulty?, hierarchy? }], title?, round?, isPremium?, timeLimit? |
| 문제 풀 | `certifications/{certCode}/question_pools/{hierarchy}/questions/{docId}` | q_id, question_text, options, answer, explanation, ai_explanation, wrong_feedback, hierarchy, tags, subject_number, problem_types 등 |
| collectionGroup | `questions` (cert_id 일치) | 동일 스키마, Round 4+·약점 시 cert_id로 풀 전체 조회 시 사용 |
| 멤버십 | `users/{uid}` | subscriptions, passes, passesByCert; memberships는 authService에서 users.paidCertIds/expiredCertIds로 변환 |

### 1.3 제출 후 처리 순서 (시퀀스 다이어그램 그릴 때 참고)

1. **클라이언트**  
   퀴즈 제출 시 `gradingService.submitQuizResult(uid, certId, sessionHistory, questions, options?)` 호출.  
   - `sessionHistory`: `QuizAnswerRecord[]` — 문제별 `{ qid, selected, isCorrect, isConfused? }`.

2. **자격증 정보 로드**  
   `getCertificationInfo(certCode)` → `certifications/{certCode}/certification_info/config` 조회.  
   과목 수·배점(score_per_question)·합격 기준(pass_criteria) 확보.

3. **과목별 점수 계산**  
   각 문제의 `subject_number`로 sessionHistory를 과목별 correct/total 집계 → `subject_scores: Record<과목번호, 0~100 점수>` (소수 반올림).  
   과목 정보 없으면 전체 정답률을 과목 0으로 저장.

4. **합격·예측 합격률**  
   - `is_passed`: pass_criteria의 average_score 이상이고, 모든 과목이 min_subject_score 이상.  
   - `computePredictedPassRate(subject_scores, minSubjectScore)`: 평균 점수 × 안정성 계수(과락 있으면 0.8, 없으면 1.0), 0~100 클램프.

5. **exam_results 저장**  
   `users/{uid}/exam_results/{examId}` 에 `setDoc(..., { merge: true })`:  
   certId, certCode, roundId, subject_scores, is_passed, predicted_pass_rate, totalQuestions, correctCount, answers[], submittedAt.  
   저장 후 getDoc으로 totalQuestions 검증.

6. **3차원 통계 집계 (메모리)**  
   sessionHistory + questions 맵으로 다음 4가지 Agg 생성:  
   - hierarchy_stats: 문제의 `hierarchy`(없으면 '기타') 기준 correct/total/confused.  
   - problem_type_stats: 문제의 `problem_types[]` 각 항목별 correct/total/confused (1문항이 여러 유형에 기여).  
   - subject_stats: `subject_number` 기준.  
   - tag_stats: 문제의 `tags[]` 각 항목별 correct/total/confused (키는 sanitizeKey 적용: `. / [ ] * ~` → `_`).  
   `confused`는 `isConfused === true`인 문항만 카운트; 해당 qid는 confused_qids 배열에 추가.

7. **proficiency 계산 (메모리)**  
   기존 `users/{uid}/stats/{certCode}` 문서의 hierarchy_stats, problem_type_stats, subject_stats에서 키별 기존 proficiency(없으면 DEFAULT_ELO 1200)를 읽어, sessionHistory 순으로 문제별 outcome(0 또는 1)에 대해 `nextProficiency(old, outcome)` 순차 적용.  
   (문제 난이도는 고정 PROBLEM_DIFFICULTY_ELO 1200 사용.)

8. **stats 문서 갱신**  
   `users/{uid}/stats/{certCode}` 에 대해:  
   - 문서 없으면 먼저 `setDoc(statsRef, {})`.  
   - updates 객체: 각 키에 `increment(agg.correct/total/confused)`, proficiency 값, 그리고 confused_qids = 기존 배열 + 이번 세션 confused_qids, **최근 100개만** 유지(CONFUSED_QIDS_MAX = 100).  
   - Firestore 업데이트 필드 수 제한(500) 때문에 `MAX_UPDATES_PER_WRITE = 500` 단위로 청크 나누어 `updateDoc` 반복.

9. **Elo 레이팅 갱신**  
   `updateEloRating(uid, certId, sessionHistory)`:  
   `users/{uid}`의 `elo_rating_by_cert[certId]`(없으면 1200)를 **회차 전체 정답률** 기준으로 갱신:  
   `newElo = oldElo + K_FACTOR * (actual - 0.5)` (actual = correctCount/total), 100~2500 클램프 후 `setDoc(..., { merge: true })`.

10. **반환**  
    `{ examId, subject_scores, is_passed }` 반환.

### 1.4 참고 코드 위치

- `src/services/gradingService.ts`: `submitQuizResult`, `getCertificationInfo`, `computePredictedPassRate`, `updateEloRating`, `nextProficiency`, `sanitizeKey`, StatEntry/UserStatsDoc 타입, CONFUSED_QIDS_MAX, MAX_UPDATES_PER_WRITE.
- `src/services/README.md`: 서비스 목록 및 데이터 흐름 요약.

### 1.5 정밀진단(학습자 진단)·Elo·통계 저장

**정밀진단**이란 사용자별 **3차원 통계 + Elo 기반 숙련도**로 학습 수준을 진단하고, 대시보드·약점 큐레이션에 반영하는 흐름을 말합니다.

| 구분 | 내용 |
|------|------|
| **3차원 통계** | `gradingService` 제출 시 집계: **hierarchy_stats**(개념), **problem_type_stats**(유형), **subject_stats**(과목), **tag_stats**(태그). 각 키별 correct/total/confused, proficiency(Elo 스타일). |
| **Elo** | K=32, DEFAULT_ELO=1200. **종합**: `users/{uid}.elo_rating_by_cert[certId]` — 회차 전체 정답률로 갱신. **키별 숙련도**: stats 내 proficiency — `nextProficiency(old, outcome)` 순차 적용. |
| **표시용** | `eloToPercent(proficiency)`로 0~100% 변환. 레이더·대시보드·4회차 추천(avgCorrectRate)에 사용. |
| **저장 경로** | `users/{uid}/stats/{certCode}` — hierarchy_stats, problem_type_stats, subject_stats, tag_stats, confused_qids(최근 100개). `users/{uid}.elo_rating_by_cert` — 자격증별 종합 Elo. |
| **약점 우선순위** | `examService.calculatePriority(stat) = (100 - proficiency)*0.5 + daysSince*0.3 + misconceptionCount*5*0.2`. hierarchy_stats 기반 상위 3 topic으로 5회차 약점 계획·fetchWeaknessQuestions에 사용. |
| **대시보드 연동** | `statsService`: fetchTrendData(성적 추이), fetchRadarData/fetchSubjectStatsRadar(레이더·과목 밸런스), fetchWeaknessFromStats(약점 카드). 모두 stats·exam_results 조회 후 포맷 변환. |

---

## 2. 'The Sniper Engine' / AI 문제 생성 파라미터

### 2.1 개발자에게 요청할 내용

- **「AI 문제 생성 시 입력값으로 들어가는 'DNA 설계도(목차, 함정 패턴)'의 예시와, '지엽적 문제 생성 방지'를 위해 설정한 프롬프트 내의 제약 조건(Negative Constraints) 리스트를 정리해줘.»**

### 2.2 코드베이스에서 확인된 내용

- 현재 레포에는 **LLM을 호출해 문항 텍스트를 생성하는 코드**와 **DNA 시드·Negative Constraints**라는 이름의 프롬프트/설정이 **없습니다**.
- 구현된 것은 **기출/풀 기반 맞춤 선정**입니다.

| 기능 | 서비스/함수 | 동작 요약 |
|------|-------------|-----------|
| Round 4+ (20문항) | `aiRoundCurationService.fetchAdaptiveQuestions` → `generateAdaptiveExam` | question_pools 전체에서, exam_results 기반 **맞춘 문제 영구 제외**, **틀린 문제(Zone A)**·**안 푼 문제(Zone B)** 구분 후 과목별 question_count 배분, Zone A 우선 채우고 Zone B로 부족분 채움. |
| Round 5 (80문항) | `examService.getQuestionsForWeaknessRound` → `generateAiMockExam` | `generateAdaptiveExamPlan`(stats 기반)으로 hierarchy별 우선순위 계획 수립 후 약점 문항 + 랜덤 문항 조합. 또는 **실전 대비형** `generateRealExamMode`(트렌드·Zone A 리뷰 비율), **약점 강화형** `generateWeaknessAttackMode`(confused_qids 24 + 틀린 문제 24 + 하위 3태그 32 등). |
| 약점 다시풀기 | `examService.fetchWeaknessRetryQuestions` | hierarchy 또는 problem_type 기준 최하위 2개 개념/유형의 오답 위주 20문항. |

- **generateWeaknessAttackMode** 상세:  
  - `needConfused = 24`, `needWrong = 24`, `needTag = 32`.  
  - confused_qids 최근 48개에서 24문항, Zone A(틀린 문제)에서 hierarchy 낮은 순으로 24문항, tag_stats 하위 3개 태그 비율(3:3:4)로 32문항 선정.

- 따라서 **DNA 설계도·Negative Constraints**는 별도 백엔드/LLM 서비스, 또는 기획·설계서에 있을 수 있습니다.  
  → 사업계획서용으로는 해당 설계 문서·API 스펙을 찾아 정리하거나, **「기획상 적용 예정」**으로 명시해 달라고 요청하는 것이 좋습니다.

### 2.3 4회차 추천(UI) 및 4회·5회차 큐레이션 상세

#### 4회차 추천 (모달 문구·버튼만, 문항 구성과 무관)

- **함수**: `ExamList.tsx` — `getCurationRecommendation(daysLeft, avgCorrectRate)`.
- **입력**: `daysLeft` = 이용권/다음 시험일 D-Day, `avgCorrectRate` = 유료 회원 `stats.hierarchy_stats` proficiency → `eloToPercent` 평균(0~100).
- **규칙**:
  - D-Day ≤ 3일 → 정답률 ≥ 60%면 **실전 대비(REAL_EXAM)** 추천, 미만이면 **약점 강화(WEAKNESS_ATTACK)**.
  - D-Day 4~6일 → 정답률 ≥ 80%면 실전 대비, 미만이면 약점 강화.
  - D-Day ≥ 7일 또는 null → **약점 강화**.
- **역할**: 4회차 모달 문구·버튼 순서만 변경. **4회차 문항 구성 자체는 모드와 무관**하며, 항상 아래 4회차 큐레이션 한 가지 로직으로 20문항이 만들어짐. **5회차**에서만 REAL_EXAM / WEAKNESS_ATTACK이 문항 선정에 사용됨.

#### 4회차(20문항) 큐레이션

- **서비스**: `aiRoundCurationService.generateAdaptiveExam`.
- **로직**: exam_results 기준 **맞춘 문제 영구 제외** → 과목별로 **Zone A(틀린 문제)** 우선, **Zone B(안 푼 문제)**로 부족분 채움 → `certification_info.subjects`의 `question_count` 비율로 배분 → 셔플 후 20문항. (Pool: question_pools 전체.)

#### 5회차(80문항) 큐레이션

- **서비스**: `examService.generateAiMockExam`.
- **REAL_EXAM(실전 대비형)**: 80% Trend·신규(Zone B 중 trend 있음 + difficulty≥3, 과목 비율 준수), 20% 오답(Zone A) 랜덤.
- **WEAKNESS_ATTACK(약점 강화형)**: 30% confused_qids(24문항), 30% 오답·hierarchy 낮은 순(24문항), 40% tag_stats 하위 3태그(32문항). 부족분은 fallback.
- **mode 없이 호출 시**: `generateAdaptiveExamPlan(uid, certCode, targetExamDate)` 사용. D-Day 7일 이하면 REAL_EXAM_BALANCE(약점 40%), 초과면 WEAKNESS_ATTACK(약점 80%). `calculatePriority`로 상위 3 topic 선정 후 `fetchWeaknessQuestions` 등으로 80문항 채움.

---

## 3. 숙련도(Proficiency) 산출 수식의 변수값

### 3.1 개발자에게 요청할 내용

- **「gradingService.ts에 정의된 숙련도 갱신 공식의 상세 변수값과, '운 좋은 정답(Lucky Guess)' 판정 시 숙련도 반영 비율을 0.2(20%)로 설정한 기술적 근거를 알려줘.»**

### 3.2 코드에 정의된 상수·공식 (gradingService.ts)

| 항목 | 값 | 비고 |
|------|-----|------|
| K_FACTOR | 32 | 종합 Elo 갱신용 |
| PROFICIENCY_K_FACTOR | 32 | hierarchy/problem_type/subject별 숙련도 갱신용 |
| DEFAULT_ELO | 1200 | 통계/숙련도 초기값 |
| PROBLEM_DIFFICULTY_ELO | 1200 | 문제 난이도(기대득점 계산 시 사용, 현재 단일 값) |
| DEFAULT_SCORE_PER_QUESTION | 5 | 과목별 배점 없을 때 기본값 |
| MIN_SUBJECT_SCORE_FOR_STABILITY | 40 | 예측 합격률 안정성: 과목 40점 미만이면 stability 0.8 |
| STABILITY_FACTOR_WITH_FAIL | 0.8 | 과목 불합격 시 예측 합격률 보정 계수 |
| STABILITY_FACTOR_NO_FAIL | 1.0 | 전 과목 합격 시 |
| CONFUSED_QIDS_MAX | 100 | confused_qids 배열 최대 길이 |

- **기대득점**  
  `expectedScore(userProficiency, problemElo) = 1 / (1 + 10^((problemElo - userProficiency) / 400))`  
  (problemElo 기본값 PROBLEM_DIFFICULTY_ELO 1200.)

- **숙련도 갱신**  
  `nextProficiency(old, outcome) = clamp(round(old + PROFICIENCY_K_FACTOR * (outcome - expected)), 100, 2500)`  
  - outcome: 0(오답) 또는 1(정답).

- **표시용 퍼센트**  
  `eloToPercent(proficiency)`: 동일 기대득점 식으로 0~100% 변환 (레이더/대시보드용).

### 3.3 is_confused / time_spent / Lucky Guess

- **is_confused**: proficiency 수식에는 **미사용**. `isConfused`는 `misconception_count` 증가와 `confused_qids` 리스트에만 반영됩니다.
- **time_spent**: gradingService·proficiency 로직에는 **미반영**.
- **「Lucky Guess 20%」**: 코드 상 **해당 판정 로직이나 0.2 비율 없음**.  
  → 사업계획서에 넣을 경우, 기획/연구 근거를 별도 문서에서 정리해 달라고 요청하는 것이 좋습니다.

---

## 4. 멤버십(Membership)별 기능 제한 로직

### 4.1 개발자에게 요청할 내용

- **「사용자 등급별로 기능 접근 권한을 제어하는 서버 사이드 로직과, 무료 사용자에게 AI 해설을 차단하는 필터링 방식을 정리해줘.»**

### 4.2 등급 정의 (examService)

- **UserGrade** 타입: `'Guest' | 'Free' | 'Premium' | 'Expired'`.
- **getUserGradeForCert(user, certId)** (examService.ts 내부 함수):
  - `user === null` → **Guest**.
  - `user.isAdmin === true` → **Premium** (마스킹 없음).
  - `user.subscriptions`에 certId가 없음 → **Guest**.
  - `user.paidCertIds`에 certId 있고 `user.expiredCertIds`에 있음 → **Expired**.
  - `user.paidCertIds`에 certId 있고 expired 아님 → **Premium**.
  - 그 외(구독은 있으나 유료 아님) → **Free**.

- **데이터 소스**: Firestore `users/{uid}` — subscriptions, paidCertIds, expiredCertIds는 authService가 `memberships` 문서/데이터를 읽어 변환하여 User 객체에 채움. (authService: membershipsToUserFields, getSessionForCurrentAuth.)

### 4.3 접근 제어 (checkExamAccess)

- **checkExamAccess({ user, certId, round, isWeaknessRound?, weaknessTrialUsed? })**:  
  - Admin: CERT_IDS_WITH_QUESTIONS에 있으면 allowed.  
  - 해당 certId가 문제 없음(준비중): allowed false, reason "해당 과목은 현재 준비중입니다."  
  - **Guest**: round === 1만 allowed, 그 외 "로그인하면 더 많은 회차를 풀 수 있어요."  
  - 구독 없음: round === 1만 allowed, 그 외 "해당 과목 구독 후 이용 가능합니다."  
  - Expired: allowed false, "구독이 만료되었습니다. 오답노트 열람만 가능해요."  
  - Premium: allowed true (Round 1~4+ 모두).  
  - **Free**: round <= 2만 allowed, 3 이상은 "열공모드로 합격권에 진입하세요."

- Round 4+·약점(Round 5)은 유료 전용이므로, getQuestionsForRound/getQuestionsForWeaknessRound 호출 전에 checkExamAccess로 검증하는 것이 전제입니다.

### 4.4 AI 해설 필터링 (마스킹)

- **maskQuestionData(questions, userGrade)** (examService.ts):
  - **Premium**: 마스킹 없음, questions 그대로 반환.
  - **Guest / Free / Expired**: 각 문제 객체에서 **`aiExplanation` 필드만 delete**.  
  - explanation(기본 해설), wrong_feedback은 유지 → 결과 화면에서 오답 상위 2개 등 제한적으로 노출 가능.

- 적용 시점:  
  - `getQuestionsForRound`: Round 4+는 fetchAdaptiveQuestions 후, Round 1~3은 fetchQuestionsFromPools 후, **반환 직전**에 `getUserGradeForCert(user, certId)`로 등급을 구한 뒤 `maskQuestionData(questions, grade)` 적용.  
  - `getQuestionsForWeaknessRound`: Round 5는 유료 전용이라 보통 Premium만 진입하지만, 코드 상 이 함수는 generateAiMockExam 결과를 **마스킹 없이** 그대로 반환함. 폴백으로 getQuestionsForRound(certId, 5, user)를 타면 그 경로에서 마스킹 적용. 사업계획서/보안 검토 시에는 Round 5 응답에도 등급별 마스킹 적용을 권장할 수 있음.

- **UI 플레이스홀더** (examService.ts export):  
  - `PREMIUM_EXPLANATION_PLACEHOLDER = '가입 후 확인하기'`  
  - `WRONG_FEEDBACK_PLACEHOLDER = '열공모드 가입 후 오답인 이유 확인하기'`  
  Quiz/Result 쪽에서 비프리미엄 사용자에게 이 문구를 노출합니다.

### 4.5 참고 코드 위치

- `src/services/examService.ts`: checkExamAccess, getUserGradeForCert, maskQuestionData, getQuestionsForRound, getQuestionsForWeaknessRound, PREMIUM_EXPLANATION_PLACEHOLDER, WRONG_FEEDBACK_PLACEHOLDER.
- `src/services/authService.ts`: memberships → paidCertIds, expiredCertIds, subscriptions 변환.
- `src/types.ts`: User (paidCertIds, expiredCertIds, subscriptions, isAdmin 등).

---

## 5. 추가 어필 포인트 (사업계획서용)

- **이용권(Pass)·회차 기반 운영**: 시험당일 12:00 KST 컷오프, pending → active 활성화, 회차별 이용권(제 N회 대비). 결제 시 회차 선택, 주문 취소는 시험당일 12:00 이전만 가능하다는 규칙을 명시적으로 적용. (AccountSettings, authService.cancelPass 등.)
- **서버 시간 기반 컷오프**: 기기 시간 조작에 덜 취약하도록 WorldTimeAPI(Asia/Seoul)로 12:00 KST 판단, 실패 시에만 로컬 시간 fallback.
- **게스트 → 회원 전환 UX**: 게스트 퀴즈 진행 상태를 sessionStorage에 저장해 로그인 후 같은 탭에서 이어풀기 가능. 탭 종료 시 초기화로 개인정보 유출 리스크 완화.
- **다자격증 동시 준비**: 마이페이지에서 자격증 탭을 **시험일 D-Day가 가까운 순**으로 정렬하고, 진입 시 가장 가까운 시험 탭을 기본 선택. (getNearestExamDate, getDaysLeft 등.)
- **연말·일정 공백 대비**: getNearestExamDate가 null인 경우(다음 연도 일정 미등록) "다음 시험 일정이 곧 업데이트됩니다" 등으로 안내해 앱이 멈추지 않도록 처리.
- **Firestore 구조**: certifications, users/{uid}/exam_results, users/{uid}/stats/{certCode}, question_pools, static_exams 등으로 채점·통계·문제 풀이가 일관되게 구성. ERD·시퀀스는 1장 요청으로 다이어그램화 가능.
- **3차원 통계**: hierarchy(개념)·problem_type(유형)·subject(과목)·tag 별로 correct, total, misconception_count와 Elo 기반 proficiency를 유지해 대시보드·약점 큐레이션에 활용. (statsService, fetchRadarData, fetchSubjectStatsRadar.)
- **Round 5 우선순위 식**: `calculatePriority(stat) = (100 - proficiency)*0.5 + daysSince*0.3 + misconceptionCount*5*0.2` (숙련도·망각·오개념 반영). hierarchy_stats 기반 약점 계획에 사용.
- **Round 4+ Zone A/B**: 맞춘 문제 영구 제외, 틀린 문제(Zone A) 복습 우선, 안 푼 문제(Zone B) 도전, 과목별 question_count 배분으로 20문항 구성.

---

## 6. 요약 체크리스트 (에이전트 작업 확인용)

- [ ] 1. 제출 → exam_results → stats → Elo 순서의 **시퀀스 다이어그램** 작성
- [ ] 2. DNA 설계도·Negative Constraints: **별도 설계/백엔드 확인** 또는 기획 반영
- [ ] 3. 숙련도 공식 변수값·Lucky Guess 20%: **코드 기준 정리 + 기획 근거** 보완
- [ ] 4. 멤버십·AI 해설 마스킹: **등급 정의·maskQuestionData·checkExamAccess** 정리
- [ ] 5. 추가 어필 포인트를 사업계획서 문단에 **선택 반영**

---

## 7. 주요 파일·함수 인덱스

| 파일 | 함수/상수 | 설명 |
|------|-----------|------|
| gradingService.ts | submitQuizResult | 퀴즈 제출 진입점, exam_results 저장 + stats + Elo |
| gradingService.ts | getCertificationInfo | certification_info/config 조회 |
| gradingService.ts | updateEloRating | elo_rating_by_cert 갱신 |
| gradingService.ts | nextProficiency, expectedScore | proficiency 공식 |
| gradingService.ts | K_FACTOR, PROFICIENCY_K_FACTOR, DEFAULT_ELO, CONFUSED_QIDS_MAX | 상수 |
| examService.ts | checkExamAccess | 회차/등급별 접근 허용 여부 |
| examService.ts | getUserGradeForCert | User → UserGrade (내부) |
| examService.ts | maskQuestionData | aiExplanation 삭제 (비프리미엄) |
| examService.ts | getQuestionsForRound | Round 1~3 static, Round 4+ fetchAdaptiveQuestions |
| examService.ts | getQuestionsForWeaknessRound | Round 5, generateAiMockExam |
| examService.ts | generateWeaknessAttackMode | confused 24 + wrong 24 + tag 32 |
| examService.ts | calculatePriority | 약점 우선순위 점수 |
| aiRoundCurationService.ts | fetchAdaptiveQuestions | Round 4+ 20문항 진입 (4회 문항 구성은 모드 무관) |
| aiRoundCurationService.ts | generateAdaptiveExam | Zone A/B, 과목별 question_count 배분, 20문항 |
| statsService.ts | fetchTrendData, fetchRadarData, fetchWeaknessFromStats | 정밀진단·대시보드용 성적 추이·레이더·약점 카드 |
| ExamList.tsx | getCurationRecommendation | 4회차 추천: daysLeft·avgCorrectRate → REAL_EXAM / WEAKNESS_ATTACK (UI만) |
| authService.ts | membershipsToUserFields | paidCertIds, expiredCertIds 생성 |
