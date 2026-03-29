# Quiz: 비정상 빠른 선택 감지 & 학습 반영 제외

## 1. 감지 조건 설계

| 상수 | 값 | 파일 |
|------|-----|------|
| 연속 문항 수 | 5 | `RAPID_SOLVE_STREAK_REQUIRED` |
| 문제당 상한(초, 이하이면 빠름) | 2 | `RAPID_SOLVE_MAX_SECONDS_PER_QUESTION` |
| "네, 학습 중" 후 재질문까지 최소 추가 풀이 수 | 15 | `RAPID_PROMPT_COOLDOWN_AFTER_DISMISS_ANSWERS` |
| 세션당 팝업 최대 횟수 | 2 | `RAPID_PROMPT_MAX_PER_QUIZ_SESSION` |

- `elapsedSec`가 없는 기록은 연속 패턴에 포함되지 않음(`hasConsecutiveRapidAnswers`).
- 제재·오답 처리 없음. 확인 대화만 노출.

## 2. Quiz 세션 상태

- `learningReflectionDisabled`: 사용자가 "기능 둘러보기" 경로로 확인한 뒤 `true`. 이후 동일 세션에서 빠른 선택 확인 팝업을 다시 띄우지 않음.
- `rapidPendingHistory` / 모달 단계: 답안 커밋 직전에 모달을 띄우고, 응답 후 `commitAnswerAndAdvance`로 진행.
- `roundId`·`certId` 변경 시 쿨다운·프롬프트 카운터·반영 제외 플래그 초기화.

## 3. 결과 전달 (`QuizFinishMeta`)

`Quiz.tsx`의 `onFinish` / `onWeaknessRetrySave` 마지막 인자:

```ts
{ excludeFromLearningStats: boolean }
```

- 일반 풀이: `excludeFromLearningStats === false`
- 둘러보기 확인 후: `true`

## 4. grading / 저장 동작 (`submitQuizResult`)

`SubmitQuizResultOptions.excludeFromLearningStats === true` 일 때:

- **수행**: `exam_results` 문서 저장(제출 이력·점수 UI용), 필드 `excludeFromLearningStats: true` 포함.
- **생략**: `users/{uid}/stats/{certCode}` 갱신, `problem_attempt_stats`, Elo(`updateEloRating` / 진단 보정).

`statsService.ts`는 본 플래그를 직접 읽지 않음. 집계 경로는 `gradingService.submitQuizResult` 한 곳에서 분기.

## 5. 이후 확장 시 참고

- 서버/백필: 기존 `exam_results`에 `excludeFromLearningStats` 없으면 기존과 동일하게 처리.
- 마이페이지·대시보드에서 해당 시험 배지/필터가 필요하면 `exam_results.excludeFromLearningStats` 기준.
- 임계값 튜닝은 `src/constants/rapidSolveDetection.ts`만 수정.

## 6. QA 체크리스트

- [ ] 실전 모드에서 보기를 2초 이내로 5문항 연속 제출 → 확인 팝업 1회.
- [ ] "네, 학습 중이에요" → 팝업 닫힘, 다음 문항으로 진행, 동일 패턴이 **즉시** 재등장하지 않음(쿨다운 15문항).
- [ ] 쿨다운 후 다시 5연속 초고속 → 두 번째 팝업 가능, 세션 최대 2회.
- [ ] "아니오…" → 2차 안내 → "확인" → amber 안내 바 노출, 이후 팝업 없음, 완료 시 `excludeFromLearningStats` 전달.
- [ ] 로그인 사용자가 둘러보기 경로 완료 시 Firestore `exam_results`에 플래그 있고 `stats` 문서 수치가 변하지 않음(이전 대비).
- [ ] 학습 모드에서 해설·다음 흐름이 길면 2초 연속 5회가 잘 안 나와 팝업이 과도하지 않음.
- [ ] 모바일(`lg` 미만) 바텀 시트형·데스크톱 중앙 카드 모두 문구·버튼 동작.
- [ ] 비로그인 / 게스트 한도(20문항) 경로에서 모달 후에도 기존 `onGuestLimitReached` 동작 유지.
