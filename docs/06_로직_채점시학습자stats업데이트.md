# 로직: 채점 시 학습자 stats 업데이트

> 퀴즈 제출 후 exam_results, stats, Elo 갱신 흐름. gradingService 기준.

---

## 처리 순서 (시퀀스)

1. **클라이언트**  
   `gradingService.submitQuizResult(uid, certId, sessionHistory, questions, options?)` 호출.

2. **자격증 정보 로드**  
   `getCertificationInfo(certCode)` → `certifications/{certCode}/certification_info/config`.

3. **과목별 점수**  
   sessionHistory → subject_number별 correct/total 집계 → `subject_scores`.

4. **합격·예측 합격률**  
   - `is_passed`: average_score 이상, min_subject_score 이상.
   - `computePredictedPassRate(subject_scores, minSubjectScore)`.

5. **exam_results 저장**  
   `users/{uid}/exam_results/{examId}` — certId, roundId, subject_scores, is_passed, predicted_pass_rate, answers, submittedAt.

6. **3차원 통계 집계**  
   hierarchy_stats, problem_type_stats, subject_stats, tag_stats — correct/total/confused, proficiency(Elo).

7. **stats 문서 갱신**  
   `users/{uid}/stats/{certCode}` — increment, proficiency, confused_qids(최근 100개).

8. **Elo 레이팅**  
   `updateEloRating(uid, certId)` — `users/{uid}.elo_rating_by_cert[certId]` 갱신.

---

## Elo·Proficiency 상수

| 항목 | 값 |
|------|-----|
| K_FACTOR | 32 |
| PROFICIENCY_K_FACTOR | 32 |
| DEFAULT_ELO | 1200 |
| PROBLEM_DIFFICULTY_ELO | 1200 |
| CONFUSED_QIDS_MAX | 100 |

- **기대득점**: `expectedScore = 1 / (1 + 10^((problemElo - userProficiency) / 400))`
- **숙련도 갱신**: `nextProficiency(old, outcome)` — outcome 0 or 1, clamp 100~2500.
- **Lucky-Guess**: outcome=1 && isConfused=true → delta × 0.2 (20%만 반영).

---

## Firestore 경로

| 경로 | 내용 |
|------|------|
| `users/{uid}/exam_results/{examId}` | 시험 결과 |
| `users/{uid}/stats/{certCode}` | hierarchy_stats, problem_type_stats, subject_stats, tag_stats, confused_qids |
| `users/{uid}` | elo_rating_by_cert |

---

## 참고 코드

- `src/services/gradingService.ts`: submitQuizResult, getCertificationInfo, updateEloRating, nextProficiency
