# 핀셋 서비스 브리핑

> **대상**: 서비스를 처음 보는 사람  
> **제품명**: 핀셋 (자격증 합격용 AI 맞춤형 모의고사·학습 플랫폼)

---

## 1. 서비스가 무엇인가

**핀셋**은 **자격증 시험(빅데이터분석기사 등) 합격을 위한 AI 맞춤형 모의고사·학습 플랫폼**입니다.

- **목표**: “최단기 합격 루트” — 학습자의 실력을 실시간 분석해, **가장 필요한 문제만** 큐레이션해서 풀게 함.
- **핵심 차별점**:
  - **3차원 학습 행동 분석**: “모르겠어요” / “헷갈림(풀이 시간)” / “찍기”를 구분해, 단순 정·오답이 아닌 **행동 신호**로 실력을 반영.
  - **Elo 스타일 이해도(proficiency)** 로 개념·과목·유형별 실력을 수치화(1200 기준, K=32)하고, 약점 우선 출제.
  - **예측 합격률**로 “지금 이대로 가면 합격할 수 있는지”를 한 눈에 보여줌.

**지원 자격증**  
- **빅데이터분석기사(BIGDATA)**: 메인. 4과목(빅데이터 분석 기획 / 탐색 / 모델링 / 시각화), 회차별 40 또는 80문항. 인덱스·문항은 `certifications` 또는 `certifications_beta`(레벨드) 사용.  
- SQLD, ADsP: 목록에 노출되나 현재 비활성(선택 불가).  
- 자격증·과목 설정: `src/constants.ts`의 `CERTIFICATIONS`, `SUBJECT_NAMES_BY_CERT`, `EXAM_ROUNDS`.

---

## 2. 유저 플로우 (전체 여정)

```
[랜딩/로그인]
    ↓
[자격증 선택] (빅데이터분석기사 등)
    ↓
[오리엔테이션] (최초 1회)
    - 학습 준비 수준 선택: 초급 / 어느 정도 해봤어요 / 많이 해봤어요
    - 슬라이드: AI 학습 모드 vs 실전 모드, 맞춤형 모의고사, 대시보드 활용
    - 쿠폰 입력(옵션)
    → prep_level, 초기 Elo(진단 1회차 제출 시 반영)
    ↓
[모의고사 목록] (회차 선택)
    - 1·2·3회: 연습 / 응용 / 실전 (고정 문제, 40 또는 80문항)
    - 레벨별 진단: prepLevel에 따라 roundId = l_1, l_2, l_3 / m_1~m_3 / h_1~h_3
    - 4회 이상: “약점 공략 모의고사” (AI 맞춤형, 과목당 20문항·총 80문항)
    - 3회차 완료 후 4회차 이상 순차 언락; 무료는 1·2회차만 풀이 가능
    ↓
[모드 선택] 학습 모드 vs 실전 모드
    ↓
[퀴즈 풀이] (src/pages/Quiz.tsx)
    - 학습 모드: 1문항씩 제출 → 즉시 정답/해설/오답 피드백, “모르겠어요” 버튼, “헷갈려요” 체크
    - 실전 모드: 전 문항 풀이 후 일괄 채점, “모르겠어요”만 선택 가능(헷갈림은 채점 시 시간 기준 자동 판정)
    - 문항별 elapsedSec 기록 → 채점 시 isConfused / isLucked 판정
    ↓
[결과 화면] (src/pages/Result.tsx)
    - 과목별 점수, 합격/불합격, 예측 합격률
    - 헷갈린 문제·찍기 배지, 오답 해설
    - CTA: 다시 풀기, 다음 회차, 대시보드, 결제 등
    ↓
[대시보드(마이페이지)] (src/pages/MyPage.tsx)
    - 예측 합격률, 과목별 정답률, 회차별 점수 추이
    - 취약 과목/유형/개념, 집중 학습(과목 강화, 취약 유형, 취약 개념)
```

**게스트**  
- 1회차만 제한된 문항 수(예: 20문항)로 체험 가능. 이후 로그인 유도. (`GUEST_QUESTION_LIMIT`, `src/pages/Quiz.tsx`)

---

## 3. 선택지: 학습 모드 vs 실전 모드

| 구분 | 학습 모드 | 실전 모드 |
|------|-----------|-----------|
| **진행** | 1문항씩 제출 → 즉시 채점·해설 | 전 문항 풀이 후 일괄 채점 |
| **피드백** | 정답/오답 즉시 + 오답별 피드백(wrong_feedback) | 결과 화면에서 일괄 확인 |
| **“모르겠어요”** | 선택 가능(selected=0) | 선택 가능 |
| **“헷갈려요”** | 체크 가능(다음 문제로 넘길 때) | 없음(헷갈림은 채점 시 **시간 기준**만: elapsedSec ≥ 예상×2.5) |
| **용도** | 개념 복습, 즉시 피드백 | 시험 감각, 시간 배분 연습 |

- 회차 선택 후 “학습 모드로 풀기” / “실전 모드로 풀기” 중 선택.  
- 4회차 이상은 “맞춤형 문항 5초 준비” 오버레이 후 동일하게 모드 선택.  
- 테마: 학습 모드 주황/파랑 계열, 실전 모드 파랑 계열(`QUIZ_THEME`, `src/constants.ts`).

---

## 4. 추적·저장되는 내용 (데이터)

### 4.1 시험 1회분: `exam_results`

- **경로**: `users/{uid}/exam_results/{examId}` (Firestore)
- **저장 주체**: `src/services/gradingService.ts` → `submitQuizResult()`
- **저장 항목**:
  - `certId`, `certCode`, `roundId`, `roundLabel`(집중학습 시)
  - `subject_scores`: 과목별 점수(만점 100 기준)
  - `is_passed`, `predicted_pass_rate` (0~100)
  - `totalQuestions`, `correctCount`
  - **`answers`**: 문항별 배열
    - `qid`, `isCorrect`, `elapsedSec`
    - **`isDontKnow`**: 모르겠어요 선택 여부(selected===0)
    - **`isConfused`**: 풀이시간 ≥ 문항 `estimated_time_sec × 2.5`
    - **`isLucked`**: 정답 이고, 해당 개념 Expected<0.5 이고, 풀이시간 < `estimated_time_sec × 0.5`
  - `submittedAt` (Timestamp)

### 4.2 누적 실력: `stats`

- **경로**: `users/{uid}/stats/{certCode}` (문서 1개)
- **저장 주체**: `gradingService.submitQuizResult()` 내부
- **구조**:
  - **3차원 통계** (개념·유형·과목·세부개념·태그별): `core_concept_stats`, `problem_type_stats`, `subject_stats`, `sub_core_id_stats`, `tag_stats`
    - 각 키별: `correct`, `total`, `misconception_count`(헷갈림 횟수), `proficiency`(Elo, 100~2500)
  - **리스트** (최근 100개): `confused_qids`, `dontknow_qids`
- **키 정규화**: `. / [ ] * ~` 등 Firestore 불가 문자는 `sanitizeKey()`로 `_` 치환.

### 4.3 문항 품질 집계: `problem_attempt_stats`

- **경로**: `problem_attempt_stats/{certCode}_{qid}` (문서당 1문항)
- **저장 주체**: `gradingService.submitQuizResult()` — 채점 시 문항별 `setDoc(..., { merge: true })` + `increment(1)` / `increment(0 또는 1)`
- **필드**: `totalAttempts`, `dontKnowCount`, `confusedCount`, `luckedCount`
- **용도**: 문항별 비율 계산 → 품질 등급(A/B/C/D), 관리자 지표, 격리 문항 수.

### 4.4 문제 신고: `problem_reports`

- **경로**: `problem_reports` (컬렉션, 문서 ID 자동)
- **저장 주체**: 퀴즈 내 “신고” 버튼 → `src/services/adminQuestionService.ts` → `submitProblemReport()` → `addDoc(collection(db, 'problem_reports'), payload)`
- **필드**: `certCode`, `qid`, `reportType`, `userId`, `userElo`, `createdAt`(serverTimestamp)
- **reportType**: `wrong_answer`(정답이 틀렸어요), `typo_or_error`(오타나 지문 오류), `out_of_scope`(출제 범위 이탈)
- **접수 시**: 클라이언트 콘솔에 `[문제 신고] 접수됨 — 확인하세요:` 로그 출력. 관리자 페이지에서 1건이라도 들어오면 목록으로 바로 확인 가능.

### 4.5 그 외

- **users**: `prep_level`(beginner/intermediate/advanced), `elo_rating_by_cert`(자격증별 Elo), 구독·결제·멤버십 관련
- **user_rounds**: `users/{uid}/user_rounds/{roundKey}` — 회차별 풀었던 문제 ID 목록(박제), roundKey는 숫자 또는 진단 시 `l_1` 등
- **certification_info**: `certifications/{certCode}/certification_info/config` — 과목 구성, 합격 기준(min_subject_score, average_score), 시험 설정

---

## 5. 수식·알고리즘 (구체)

### 5.1 Elo 스타일 이해도 (proficiency)

- **문제 난이도**: 1200 고정 (`PROBLEM_DIFFICULTY_ELO`, `gradingService.ts`)
- **Expected(맞출 확률)**  
  `Expected = 1 / (1 + 10^((1200 − userProficiency) / 400))`
- **1문항 반영**  
  `Δ_base = K × (Outcome − Expected)` (Outcome: 1=정답, 0=오답)  
  `Δ_final = Δ_base × WeightMultiplier`  
  `newProficiency = clamp(old + K × Δ_final, 100, 2500)`  
  **K = 32** (`K_FACTOR`, `PROFICIENCY_K_FACTOR`).

### 5.2 3차원 가중치 (WeightMultiplier)

| 상황 | 가중치 |
|------|--------|
| 오답 + 모르겠어요 | 1.3 |
| 오답 + 헷갈림(시간) | 1.1 |
| 오답 기본 | 1.0 |
| 정답 + 찍기 | 0.2 |
| 정답 + 헷갈림 | 0.4 |
| 정답 기본 | 1.0 |

→ “모르겠어요 오답”은 실력 하락을 더 크게, “찍기 정답”은 실력 상승을 거의 반영하지 않음.

### 5.3 플래그 판정 (채점 시, gradingService 내부)

- **isDontKnow**: `selected === 0` (모르겠어요 버튼)
- **isConfused**: `elapsedSec ≥ (문항 estimated_time_sec) × 2.5` (`CONFUSED_TIME_MULT = 2.5`)
- **isLucked**:  
  정답 **이고** 해당 문항 `core_concept`의 현재 proficiency로 계산한 **Expected < 0.5** **이고**  
  `elapsedSec < (문항 estimated_time_sec) × 0.5` (`LUCKED_TIME_MULT = 0.5`)  
- 문항에 `estimated_time_sec` 없으면 isConfused/isLucked는 false.

### 5.4 예측 합격률 (predicted_pass_rate)

- **과목별 점수**: certification_info의 `score_per_question`과 과목별 정답 수로 계산, 0~100.
- **기본 점수**: 과목별 점수의 **평균**
- **과락 패널티**: `min_subject_score`(기본 40) 미만인 과목이 하나라도 있으면  
  `(minSubjectScore − min(과목점수)) / minSubjectScore × 20` 점 감점
- **최종**: `round(기본 점수 − 패널티)`, 0~100 클램프.  
  → 대시보드·결과에 “예측 합격률”로 표시. 4회차 이상 언락 조건(예: D-Day 3일 이내 + 예측 합격률 70% 이상)에도 사용.

### 5.5 약점 우선순위 (큐레이션·집중학습)

- **공식** (`examService._calculatePriority`, `gradingService` 주석과 동일):  
  `Priority = (100 − Proficiency)×0.5 + DaysSince×0.3 + MisconceptionCount×5×0.2`  
  - Proficiency: stats의 Elo 값(0~100 아님). DaysSince: 마지막 시도 일수(기본 14). MisconceptionCount: 헷갈림 횟수.
- proficiency 낮을수록, 오래 안 풀었을수록, 헷갈림 횟수가 많을수록 우선 출제.

### 5.6 진단 회차 후 Elo 재조정 (최초 1회만)

- **조건**: `roundId`가 `l_1`, `m_2`, `h_3` 등 진단 패턴(`/^(l|m|h)_[123]$/`)이고, 사용자 `prepLevel`이 있을 때.
- **재응시 판단**: **현재 제출분을 `exam_results`에 저장하기 전에** `users/{uid}/exam_results`를 조회해, **같은 roundId**로 이미 저장된 문서가 1건이라도 있으면 “재응시”로 간주. 따라서 최초 제출 시에는 0건이어서 진단 보정이 적용되고, 같은 회차를 다시 풀면 1건 이상이어서 진단 보정은 건너뜀.
- **재응시 시**: 위 조회에서 1건 이상이면 **진단 보정 생략** → 일반 문항별 Elo만 적용(`updateEloRating`).
- **최초 1회만**:
  - `initialElo`: beginner 1000, intermediate 1300, advanced 1600  
  - `expectedScore%`: beginner 40%, intermediate 60%, advanced 75%  
  - `rawDelta = (실제 득점률 − expectedScore) × 10`  
  - **보정폭 제한**: `cappedDelta = clamp(rawDelta, -300, +300)` (`DIAGNOSTIC_ELO_DELTA_CAP = 300`)  
  - `newElo = clamp(initialElo + cappedDelta, 100, 2500)`  
  → 이후 일반 Elo 업데이트와 동일하게 유지.

### 5.7 문항 품질 등급 (qualityService, 관리자 지표)

- **입력**: `problem_attempt_stats` 문서의 `totalAttempts`, `dontKnowCount`, `confusedCount`, `luckedCount`
- **최소 시도**: 30회 미만이면 등급 없음(null). (`MIN_ATTEMPTS = 30`, `src/services/qualityService.ts`)
- **비율**: dontKnowRate, confusedRate, luckedRate (0~1)
- **등급 기준**:
  - D: dontKnowRate ≥ 40% 또는 (high_lucked + elevated_dont_know)
  - C: dontKnowRate ≥ 25% 또는 luckedRate ≥ 30%
  - B: confusedRate ≥ 50%
  - A: 위 해당 없음
- **이슈 코드**: `high_dont_know`, `elevated_dont_know`, `high_lucked`, `high_confused`
- **격리된 문제**: 등급 D 문항 개수(quarantined).

---

## 6. 학습 효과가 나오는 방식

1. **맞춤 출제**  
   `stats`의 개념·유형·과목별 proficiency와 misconception_count로 “약한 곳”을 계산하고, 약점 공략 모의고사·집중학습(과목/유형/개념)에서 그 순서로 문항 선발. (`aiRoundCurationService`, `examService`)

2. **행동 보정**  
   “찍기 정답”은 0.2, “모르겠어요 오답”은 1.3 가중치로 proficiency를 갱신해, **실제 이해도**에 가깝게 수치 유지.

3. **예측 합격률**  
   과목별 점수와 과락 여부를 반영해 “지금 상태로 합격 가능한지”를 보여주고, 과락 과목·취약 개념을 대시보드에서 강조.

4. **복습 경로**  
   `confused_qids`, `dontknow_qids`를 활용한 “헷갈린 문제”“모르겠어요 문제” 복습·큐레이션 확장 가능.

5. **문항 품질**  
   `problem_attempt_stats`로 문항별 비율을 계산하고, 등급이 낮은 문항은 보정·격리해 시험 품질 유지. 관리자 지표에서 A/B/C/D·격리 개수 모니터링.

---

## 7. 학습자가 느끼는 방식 (체감 포인트)

- **시작 시**  
  오리엔테이션에서 “학습 모드 vs 실전 모드”, “실력 분석 기반 맞춤 출제”, “대시보드로 취약점 확인” 안내.  
  “학습 준비 수준(초급/중급/고급)” 선택 → **최초 1회** 진단 회차 제출 시에만 Elo가 레벨별 초기값+득점률 보정으로 잡히고, 재응시 시에는 일반 문항별 Elo만 적용되어 점수가 튀지 않음.

- **풀이 중**  
  - 학습 모드: 한 문항 풀 때마다 바로 정답/해설/오답 피드백. “모르겠어요” 선택 시 해설만 보고 넘기기.  
  - 실전 모드: 시험처럼 한 번에 풀고, 제출 후 결과에서 “헷갈린 문제”“찍기” 배지와 함께 복기.  
  - 문제 오류 시 “신고” → 3가지 유형(정답 오류 / 오타·지문 오류 / 출제 범위 이탈) 중 선택 후 전송.

- **결과**  
  - “합격/불합격” + “예측 합격률”로 상태 파악.  
  - 과목별 막대, 과락 여부, “가장 취약한 개념” 한 줄 안내.  
  - “다음 회차”로 이어서 풀면, 이전 실력이 반영된 맞춤 문항 세트 제공.

- **대시보드**  
  - 예측 합격률, 과목별 정답률, 회차별 점수 추이.  
  - “취약 과목/유형/개념” → “과목 강화 학습”“취약 유형 집중”“취약 개념 집중”으로 **집중 학습** 진입.

- **잠금·동기 부여**  
  - 3회차(실전 모의고사)는 유료. 2회차까지 무료 체험 후 “실전으로 점검” 유도.  
  - 4회차 이상(약점 공략)은 “D-Day 3일 이내 + 예측 합격률 70% 이상” 등 조건 시 언락.

---

## 8. 관리자 지표 (Admin, 실서버 공통)

- **메뉴**: Admin 사이드바 → “핀셋 지표”(또는 “지표”) 메뉴.
- **표시 지표**:
  - **총 가입자 수**: Firestore `users` 컬렉션 문서 개수 (`getCountFromServer`).
  - **플래그 분포**: `problem_attempt_stats` 전체 집계 → 모르겠어요/헷갈림/찍기 **비율**(%) 및 총 시도 수.
  - **목표 vs 현재 (색상)**:
    - 모르겠어요: 목표 **10~15%** — 범위 안이면 초록, 밖이면 빨강.
    - 헷갈림: 목표 **20~30%** — 범위 안이면 초록, 밖이면 빨강.
    - 찍기: 목표 **5~10%** — 범위 안이면 초록, 밖이면 빨강.
  - **문항 품질**: 시도 30회 이상 문항에 대해 등급 A/B/C/D 개수, **격리된 문제 개수**(D등급).
  - **문제 신고**: 총 N건 + 최근 50건 목록(시간, 자격증, 문항 ID, 유형, userElo). 1건이라도 들어오면 목록에서 바로 확인 가능.
- **Firestore 규칙**:
  - `problem_attempt_stats`: 인증 사용자 create/update, 관리자만 read.
  - `problem_reports`: 인증 사용자 create, 관리자만 read.

---

## 9. 한 줄 요약

**핀셋**은 “모르겠어요 / 헷갈림 / 찍기”를 구분해 **행동 기반으로 실력을 갱신**하고, **Elo·예측 합격률·약점 우선순위**로 맞춤 문항을 제공하며, **학습 모드(즉시 피드백)** 와 **실전 모드(일괄 채점)** 를 선택하게 해 **최단기 합격**을 목표로 하는 자격증 모의고사 서비스입니다.
