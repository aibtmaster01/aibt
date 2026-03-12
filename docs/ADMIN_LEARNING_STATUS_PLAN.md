# 어드민 회원관리 → 학습현황 기능 계획

## 1. 이해 확인

- **실서버** 어드민 회원관리에서:
  - 기존 **"푼 문제"** 컬럼을 **"학습현황"**으로 변경
  - **"학습현황 확인하기"** 버튼 추가
  - 해당 버튼 클릭 시 **해당 학습자 전용 모달**에서:
    - **1회차 ~ 마지막 푼 회차**까지 순서대로
    - **회차별 점수** (과목별/총점)
    - **Elo Rating** 수치 (과목·개념 등)
    - **합격률**: 3회차부터 제공되므로, **3회차 옆에 합격률, 4회차 옆에 합격률** … 식으로 시점별로 모두 표시

---

## 2. 베타 기준: 학습자가 문제 풀면 데이터가 어떻게 들어가는지

### 2.1 퀴즈 제출 시 호출

- **App.tsx**: 퀴즈 종료 후 `submitQuizResult(user.id, selectedCertId, sessionHistory, questions, { roundId, roundLabel, prepLevel })` 호출

### 2.2 gradingService.submitQuizResult

1. **exam_results 저장** (`users/{uid}/exam_results/{examId}`)
   - `certId`, `certCode`, `roundId`, `roundLabel`
   - `subject_scores`: 과목별 점수 (0~99)
   - `is_passed`, `predicted_pass_rate` (과목점수·최저점 기반 시그모이드, 15~96% 클램프)
   - `totalQuestions`, `correctCount`, `answers`, `submittedAt`

2. **stats 갱신** (`users/{uid}/stats/{certCode}`)
   - `core_concept_stats`, `problem_type_stats`, `subject_stats`, `sub_core_id_stats`, `tag_stats`: correct/total 누적 + **proficiency(Elo)** 갱신 (1200 기준, K=32)
   - `confused_qids`, `dontknow_qids` 등

즉, **회차별 점수·합격률**은 `exam_results` 문서에, **Elo(proficiency)** 는 `stats/{certCode}` 한 문서에 누적 반영됨.

---

## 3. 진행 계획

### 3.1 UI 변경 (Admin.tsx)

| 항목 | 내용 |
|------|------|
| 테이블 헤더 | "푼 문제" → **"학습현황"** |
| 셀 내용 | 기존 "N개" 대신 **"학습현황 확인하기"** 버튼 (또는 버튼만 두고 숫자는 제거) |
| 드롭다운 메뉴 | **"학습현황 확인하기"** 항목 추가 → 클릭 시 해당 회원용 학습현황 모달 오픈 |

(테이블에 "N개"를 유지할지, 버튼만 둘지는 선택 가능)

### 3.2 학습현황 모달 데이터

- **데이터 소스**
  - `users/{uid}/exam_results`: `orderBy('submittedAt', 'asc')` 또는 서버에서 가져온 뒤 클라이언트에서 1회차→N회차 순 정렬
  - `users/{uid}/stats/{certCode}`: 자격증별 1개 문서 → 과목/개념별 **proficiency(Elo)** 및 correct/total

- **회차별 표시**
  - 각 exam_result 한 행: **회차명**(roundLabel/roundId), **점수**(subject_scores → 총점 또는 과목별), **합격률**(predicted_pass_rate, 3회차부터만 값 있음 → 3회차 옆에 합격률, 4회차 옆에 합격률 …)
  - Elo는 **현재 시점의 stats**를 한 번에 표시 (과목별/개념별 등). “회차별 Elo”는 저장하지 않으므로 “현재 Elo”로 통일

### 3.3 서비스 레이어 (adminService / 공용)

- **fetchUserExamResultsForAdmin(uid)** (이름 가칭)
  - `users/{uid}/exam_results` 쿼리: `orderBy('submittedAt', 'desc')` (또는 asc), `limit(100)` 등
  - 반환: `{ examId, roundId, roundLabel, subject_scores, predicted_pass_rate, totalQuestions, correctCount, submittedAt }[]`
  - 필요 시 자격증별 필터(certCode) 적용

- **fetchUserStatsForAdmin(uid, certCode)** (또는 certCode 없이 여러 cert 한 번에)
  - `users/{uid}/stats/{certCode}` getDoc
  - 반환: subject_stats, core_concept_stats 등 (proficiency 포함) → Elo 표시용

### 3.4 모달 UI

- 제목: 예) **"{이름} 학습현황"**
- 자격증이 여러 개면: 탭 또는 섹션으로 자격증별 구분
- **표**: 회차(1회~N회) | 점수(총점 또는 과목별) | 합격률(3회차부터) | 비고
- **Elo**: 같은 모달 하단 또는 별도 섹션에 "현재 Elo (과목/개념)" 표 (subject_stats, core_concept_stats 등)

### 3.5 구현 순서 제안

1. **adminService**
   - `fetchUserExamResultsForAdmin(uid)`, `fetchUserStatsForAdmin(uid, certCode)` 추가 (실서버 Firestore 경로 그대로 사용)
2. **Admin.tsx**
   - "푼 문제" → "학습현황", "학습현황 확인하기" 버튼/메뉴 추가
   - 학습현황 모달 state (열린 대상 uid) 추가
3. **학습현황 모달**
   - 선택한 uid로 exam_results + stats 조회
   - 1회차~푼 회차 순으로 정렬, 회차별 점수·합격률(3회차 옆, 4회차 옆 …) + 현재 Elo 표시

---

## 4. 정리

- **데이터**: 문제 풀면 `exam_results`(회차별 점수·합격률) + `stats`(Elo)에 저장됨.
- **실서버**: 위 로직을 실서버 배포 대상 코드에 반영 (베타 전용 분기 없이 동일 코드로 실서버에서만 어드민 접근 가능한 구조 유지).
- **합격률**: 3회차부터만 값이 있으므로, 테이블에서 "3회차 옆에 합격률, 4회차 옆에 합격률" 형태로 시점별 표시.

이 계획대로 구현하면 됩니다.
