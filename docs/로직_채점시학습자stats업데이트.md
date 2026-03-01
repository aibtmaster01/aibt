# 로직: 채점 시 학습자 Stats 업데이트

> 퀴즈 제출 후 채점·통계·Elo 갱신 전체 파이프라인. 실제 코드 기준.

---

## 1. 전체 처리 순서

`gradingService.submitQuizResult(uid, certId, sessionHistory, questions, options?)` 호출 시:

```
1. 자격증 정보 로드 (certification_info/config)
2. 과목별 점수 계산
3. 합격·예측 합격률 판정
4. exam_results 저장
5. 3차원 통계 집계 (메모리)
6. proficiency(Elo) 계산 (메모리)
7. stats 문서 갱신 (Firestore)
8. 종합 Elo 갱신
9. 결과 반환
```

---

## 2. 상수

| 상수 | 값 | 용도 |
|------|-----|------|
| `K_FACTOR` | 32 | 종합 Elo 갱신 |
| `PROFICIENCY_K_FACTOR` | 32 | 키별 proficiency 갱신 |
| `DEFAULT_ELO` | 1200 | 초기 Elo값 |
| `PROBLEM_DIFFICULTY_ELO` | 1200 | 문제 난이도 (고정) |
| `CONFUSED_QIDS_MAX` | 100 | confused_qids 배열 최대 길이 |
| `MAX_UPDATES_PER_WRITE` | 500 | Firestore 필드 수 제한 청크 |

---

## 3. 수식

### 기대득점 (Expected Score)

```
E(user, problem) = 1 / (1 + 10^((problemElo - userProficiency) / 400))
```

### 키별 Proficiency 갱신

```
newP = old + PROFICIENCY_K_FACTOR × (outcome - expected)
```

- `outcome`: 0(오답) 또는 1(정답)
- **Lucky-Guess 보정**: 정답(1) + 헷갈림(isConfused=true) → `delta × 0.2`
- 결과: `clamp(round(newP), 100, 2500)`

### 종합 Elo 갱신

```
actual = correctCount / totalCount
newElo = oldElo + K_FACTOR × (actual - 0.5)
```

- 결과: `clamp(round(newElo), 100, 2500)`

### 표시용 변환

```
eloToPercent(proficiency) = round(expectedScore(proficiency) × 100)
```

→ 0~100% (레이더/대시보드 표시용)

### 예측 합격률

```
predictedPassRate = 평균점수 × stabilityFactor
stabilityFactor = 과락 과목 있으면 0.8, 없으면 1.0
```

---

## 4. 3차원 통계 집계

sessionHistory + questions를 순회하며 4가지 통계 생성:

| 통계 | 키 기준 | 설명 |
|------|---------|------|
| `core_concept_stats` | `question.hierarchy` (없으면 '기타') | 핵심 개념별 |
| `problem_type_stats` | `question.problem_types[]` 각 항목 | 유형별 (1문항 → 여러 유형) |
| `subject_stats` | `question.subject_number` | 과목별 |
| `sub_core_id_stats` | `question.sub_core_id` (있을 때) | 세부 개념별 |

각 키별 집계 필드:

| 필드 | 설명 |
|------|------|
| `correct` | 정답 수 (increment) |
| `total` | 시도 수 (increment) |
| `misconception_count` | 헷갈림 체크 수 (increment) |
| `proficiency` | Elo 스타일 숙련도 (최신 값 덮어쓰기) |

### confused_qids

- `isConfused === true`인 문항의 qid를 배열에 추가
- **최근 100개만** 유지 (`CONFUSED_QIDS_MAX = 100`)

---

## 5. Firestore 저장 경로

| 경로 | 저장 내용 |
|------|-----------|
| `users/{uid}/exam_results/{examId}` | certId, certCode, roundId, subject_scores, is_passed, predicted_pass_rate, answers[], submittedAt |
| `users/{uid}/stats/{certCode}` | core_concept_stats, problem_type_stats, subject_stats, sub_core_id_stats, confused_qids |
| `users/{uid}` | `elo_rating_by_cert: { [certId]: number }` |

### stats 문서 갱신 방식

- 문서 없으면 `setDoc(statsRef, {})` 먼저 생성
- `increment()` 함수로 correct/total/misconception_count 누적
- proficiency는 최신 값으로 직접 대입
- Firestore 500 필드 제한 → `MAX_UPDATES_PER_WRITE` 단위로 청크 분할 후 `updateDoc` 반복

---

## 6. 대시보드 연동

`statsService.ts`가 위 stats 데이터를 조회하여 대시보드에 표시:

| 함수 | 용도 |
|------|------|
| `fetchUserTrendData` | 성적 추이 (회차별 점수, 예측 합격률) |
| `fetchRadarData` | 유형별 밸런스 (problem_type_stats → proficiency → %) |
| `fetchSubjectStatsRadar` | 과목별 밸런스 (subject_stats → proficiency → %) |
| `fetchWeaknessFromStats` | 약점 카드 (core_concept_stats → 하위 항목) |

---

## 관련 파일

| 파일 | 역할 |
|------|------|
| `src/services/gradingService.ts` | `submitQuizResult`, `nextProficiency`, `expectedScore`, `eloToPercent`, `updateEloRating` |
| `src/services/statsService.ts` | 대시보드용 stats 조회·포맷 |
| `src/types.ts` | `QuizAnswerRecord`, `StatEntry`, `UserStatsForCert` 타입 |
| `src/App.tsx` | `handleQuizFinish` → `submitQuizResult` 호출 |
