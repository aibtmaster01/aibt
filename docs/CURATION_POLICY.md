# 모의고사 풀이 정책 및 큐레이션 기법

## 1. 구현 개요

이 문서는 **유저별 모의고사 박제(UserRound)** 및 **Zone 기반 적응형 큐레이션**이 적용된 현재 시스템을 설명합니다.

---

## 2. 회원별 모의고사 풀이 정책

### 2.1 회원 등급별 접근

| 등급 | 접근 가능 회차 | 비고 |
|------|----------------|------|
| **Guest** | Round 1만 (20문제 제한) | 로그인 유도 |
| **Free** | Round 1, 2 | Round 3+ 및 약점 공략 접근 불가 |
| **Premium** | Round 1~3(고정형), Round 4+(맞춤형) 전체 | 유료 전용 기능 |
| **Expired** | Round 1만 (오답노트 열람만) | 만료 시 |

### 2.2 회차 노출 조건 (ExamList)

- **Round 1~3**: 항상 노출. 2·3회차는 이전 회차 완료 후 순차 잠금 해제.
- **Round 4·5 (고난도)**: D-Day 3일 이내 **AND** 예측 합격률 70% 이상 시에만 노출.
- **Round 6+ (약점 공략)**: 3회차 완료 후 노출. 4·5가 숨겨져 있으면 6회차가 목록에 바로 표시.

### 2.3 유저별 회차 박제 (UserRound)

| 경로 | 설명 |
|------|------|
| `users/{uid}/user_rounds/{roundNum}` | 유저 기준 회차별 고정 문제 세트 |

**UserRound 필드**

- `roundNum`: 유저 기준 회차 번호 (1, 2, 3, 4, 5, 6, …)
- `sourceRounds`: 출처 회차 배열 (예: `[1]`, `[4]`, `[99]`)
- `questionIds`: 고정된 문제 ID 배열
- `createdAt`: 생성일 (ISO)

**동작**

1. 모의고사 진입 시 `user_rounds/{roundNum}` 조회.
2. **존재 시**: 저장된 `questionIds`로 즉시 문제 로드 → **재응시 시 동일 문제 유지**.
3. **없을 시**: Static vs 맞춤형 판단 후 생성, Firestore 트랜잭션으로 UserRound 저장.
4. 이후 같은 회차 재진입 시 해당 UserRound를 재사용.

---

## 3. 모의고사 큐레이션 기법

### 3.1 Zone 기반 문항 배분

맞춤형 모의고사 생성 시 아래 **우선순위**로 과목별 `question_count`를 채웁니다.

| 우선순위 | Zone | 설명 | 선정 기준 |
|----------|------|------|-----------|
| 1 | **Zone A (복습)** | 과거에 틀렸던 문제 | `exam_results`의 `answers`에서 `isCorrect === false` |
| 2 | **Zone B (도전)** | 한 번도 풀지 않은 신규 문제 | round 99 또는 round 1~5 풀에서 추출 |
| 3 | **Fallback** | 제외 영역 재활용 | 맞춘 문제 중 **가장 오래전에 푼 문제** 또는 **trap_score 높은 순** |

- **과목별 비중**: `certification_info.subjects`의 `question_count`를 엄격히 유지.
- **출력 순서**: 1과목 → 2과목 → … (과목 순서 고정).

### 3.2 고난이도 스케일링

유저가 **Static 4·5회차를 이미 완료**한 이력이 있으면:

- Zone B 추출 시 `difficulty_level`이 **높은 문제**를 우선 선정.
- 실전 대비 수준의 문항 비율을 높여 난이도를 상향 조정.

### 3.3 Lucky-Guess Elo 보정 (gradingService)

- **정답 + 헷갈림 체크**: “운으로 맞춘 것”으로 간주.
- Elo 상승량에 **0.2(20%)**만 반영.
- `nextProficiency(oldProficiency, outcome, isConfused)`에서 처리.

### 3.4 약점 우선순위 공식

`Priority = (100 - Proficiency) × 0.5 + DaysSince × 0.3 + MisconceptionCount × 5 × 0.2`

- **Proficiency**: 0~100 스케일 이해도
- **DaysSince**: 마지막 시도 경과일
- **MisconceptionCount**: 헷갈림(오개념) 누적 횟수

---

## 4. 데이터 흐름 요약

```
[진입] getQuestionsForRound
    → user_rounds/{round} 조회
    → 있으면: questionIds로 즉시 로드
    → 없으면: Static vs 맞춤형 판단
        → Static: static_exams/Round_{n}
        → 맞춤형: aiRoundCurationService (Zone A→B→Fallback)
    → UserRound 저장 (트랜잭션)
    → maskQuestionData → 반환

[제출] submitQuizResult
    → exam_results 저장
    → stats 3차원 갱신 (hierarchy/problem_type/subject)
    → nextProficiency (Lucky-Guess 0.2 반영)
```

---

## 5. 관련 파일

| 파일 | 역할 |
|------|------|
| `src/types.ts` | `UserRound` 인터페이스 |
| `src/services/examService.ts` | UserRound 기반 진입·라우팅, Static/맞춤형 분기 |
| `src/services/aiRoundCurationService.ts` | Zone A/B/Fallback 배분, 고난이도 스케일링 |
| `src/services/gradingService.ts` | 채점, Elo, Lucky-Guess 보정 |
