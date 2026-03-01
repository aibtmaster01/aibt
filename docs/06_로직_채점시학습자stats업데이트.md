# 로직: 채점 시 학습자 stats 업데이트

> 퀴즈 제출 후 exam_results, stats(3차원 통계), Elo 갱신 흐름. **실제 코드 기준** — `src/services/gradingService.ts` 중심.

---

## 1. 처리 순서 (시퀀스)

1. **클라이언트 호출**  
   `gradingService.submitQuizResult(uid, certId, sessionHistory, questions, options?)`  
   - `sessionHistory`: 문항별 `{ qid, selected, isCorrect, isConfused?, elapsedSec? }`  
   - `options`: `SubmitQuizResultOptions` (examId, roundId, roundLabel 등)

2. **자격증 정보 로드**  
   `getCertificationInfo(certCode)` → Firestore `certifications/{certCode}/certification_info/config`  
   - 합격 기준: `average_score`, `min_subject_score`(과목별 과락선, 예: 40)

3. **과목별 점수**  
   `sessionHistory` + `questions`의 `subject_number`로 과목별 correct/total 집계 → `subject_scores` (과목 번호 → 점수 %)

4. **합격·예측 합격률**  
   - **합격:** `average_score` 이상이고 모든 과목이 `min_subject_score` 이상.  
   - **예측 합격률:** `computePredictedPassRate(subject_scores, minSubjectScore)`  
     - 과목별 점수 평균에서, **과락선 미만 과목이 있으면** `(minSubjectScore - minScore) / minSubjectScore * 20` 만큼 연속 감점 후 0~100 클램프.  
   - `exam_results` 문서에 `is_passed`, `predicted_pass_rate` 저장.

5. **exam_results 저장**  
   `users/{uid}/exam_results/{examId}`  
   - 필드: `certId`, `roundId`, `roundLabel`, `subject_scores`, `is_passed`, `predicted_pass_rate`, `answers`, `totalQuestions`, `correctCount`, `submittedAt` 등.

6. **3차원 통계 집계**  
   문항별 정오·헷갈림·과목·개념·유형·태그 기준으로 correct/total/confused 누적, **proficiency(Elo)** 갱신.  
   - **갱신 대상:**  
     - `core_concept_stats` (개념별)  
     - `sub_core_id_stats` (세부 개념별, 취약 개념·맞춤형 큐레이션에 사용)  
     - `problem_type_stats` (유형별)  
     - `subject_stats` (과목별)  
     - `tag_stats` (태그별)  
   - 각 키별로 `correct`, `total`, `misconception_count`(confused) increment, `proficiency`는 Elo 공식으로 갱신.

7. **stats 문서 갱신**  
   `users/{uid}/stats/{certCode}`  
   - 위 3차원 맵 increment + proficiency 덮어쓰기.  
   - `confused_qids`: 최근 N개(예: CONFUSED_QIDS_MAX 100) 유지.

8. **종합 Elo 레이팅**  
   `updateEloRating(uid, certId)` → `users/{uid}` 문서의 `elo_rating_by_cert[certId]` 갱신 (전체 실력 지표).

---

## 2. Elo·Proficiency 상수 (gradingService.ts)

| 항목 | 값 | 설명 |
|------|-----|------|
| K_FACTOR | 32 | 종합 Elo 갱신 민감도 |
| PROFICIENCY_K_FACTOR | 32 | 개념/유형/과목별 proficiency 갱신 민감도 |
| DEFAULT_ELO | 1200 | 초기 Elo |
| PROBLEM_DIFFICULTY_ELO | 1200 | 문제 난이도 기준 Elo (기대득점 계산 시 사용) |
| CONFUSED_QIDS_MAX | 100 | stats.confused_qids 최대 개수 |

- **기대득점:** `expectedScore(userProficiency, problemElo) = 1 / (1 + 10^((problemElo - userProficiency) / 400))`  
- **숙련도 갱신:** `nextProficiency(old, outcome, isConfused)` — outcome 0 or 1, clamp 100~2500.  
- **Lucky-Guess:** outcome=1 이면서 `isConfused === true` 이면 delta × 0.2 (20%만 반영).

---

## 3. Firestore 경로

| 경로 | 내용 |
|------|------|
| `users/{uid}/exam_results/{examId}` | 시험 결과 (과목별 점수, 합격 여부, 예측 합격률, 답안 목록, 제출 시각) |
| `users/{uid}/stats/{certCode}` | core_concept_stats, sub_core_id_stats, problem_type_stats, subject_stats, tag_stats, confused_qids |
| `users/{uid}` | elo_rating_by_cert (자격증별 종합 Elo) |
| `certifications/{certCode}/certification_info/config` | 합격 기준, 과목 구성 (getCertificationInfo) |

---

## 4. 마이페이지 연동

- **예측 합격률 표시:** `statsService.fetchDashboardStats`에서 최근 3회 `exam_results`의 `predicted_pass_rate`를 가중 평균한 `weightedPassRate` 사용 가능.  
- **과목별 안전도:** `subject_scores`에서 합격선(40) 대비 `safetyMargin`, 최근 2~3회 추이로 `trend`(up/down/stable) 계산 — `statsService.calcSubjectTrend`, `SubjectScore.safetyMargin`, `SubjectScore.trend`.

---

## 5. 참고 코드

- `src/services/gradingService.ts`: `submitQuizResult`, `getCertificationInfo`, `computePredictedPassRate`, `updateEloRating`, `nextProficiency`, `eloToPercent`  
- `src/services/statsService.ts`: `fetchDashboardStats`, `weightedPassRate`, `calcSubjectTrend`, `SubjectScore`
