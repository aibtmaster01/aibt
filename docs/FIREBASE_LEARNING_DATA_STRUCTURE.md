# Firebase 학습 데이터 구조 (대시보드 반영용)

대시보드(마이페이지)가 학습 기록을 표시하려면 아래 경로·필드와 **완전히 동일**해야 합니다.

## 1. 시험 결과 (학습 이력 목록 / 트렌드)

- **경로**: `users / {uid} / exam_results / {examId}`
  - `users`: 컬렉션
  - `{uid}`: 로그인 사용자 UID (Firebase Auth `user.uid`와 동일)
  - `exam_results`: **서브컬렉션** (문서 ID = 시험마다 고유 examId)
- **쿼리**: `exam_results` 서브컬렉션을 `submittedAt` 내림차순, 최대 150건 조회 후 메모리에서 자격증 필터

**문서 필드 (예시)**:

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `certCode` | string | 권장 | 자격증 코드. 예: `"BIGDATA"` (대소문자 구분) |
| `certId` | string | certCode 없을 때 | 자격증 ID. 예: `"c1"`. certCode 없으면 이걸로 매칭 |
| `roundId` | string \| null | | 회차 ID. `"weakness_retry"`면 학습 이력 목록에서 제외 |
| `roundLabel` | string \| null | | 회차 표시명 |
| `subject_scores` | map<string, number> | | 과목별 점수(0~99). 키 예: `"1"`, `"2"`, `"3"`, `"4"` |
| `is_passed` | boolean | | 합격 여부 |
| `predicted_pass_rate` | number | | 예측 합격률(0~99) |
| `totalQuestions` | number | | 총 문항 수 |
| `correctCount` | number | | 정답 수 |
| `answers` | array | | 답안/플래그 배열 |
| **`submittedAt`** | **Timestamp** | **필수** | 제출 시각. **없으면 orderBy 쿼리에서 제외됨** |

- **자격증 매칭**: 현재 선택한 자격증의 `code`(예: `BIGDATA`)와 문서의 `certCode`가 같거나, `certId`(예: `c1`)가 같아야 트렌드/대시보드에 포함됩니다.

## 2. 통계 (과목별 안전도 / 유형별 분석 / 취약 개념)

- **경로**: `users / {uid} / stats / {certCode}`
  - `stats`: **서브컬렉션** (문서 ID = 자격증 **코드**, 예: `BIGDATA` — 대소문자 구분)
- **문서 ID**: 반드시 `BIGDATA`, `SQLD`, `ADSP` 등 **constants.ts의 code와 동일**해야 합니다.

**문서 필드 (맵 형태)**:

| 필드 | 설명 |
|------|------|
| `subject_stats` | 과목별 집계. 키: `"1"`, `"2"`, … (문자열). 값: `{ correct, total, proficiency? }` |
| `problem_type_stats` | 유형별 집계. 키: `"단순암기형"`, `"개념이해형"` 등. 값: `{ correct, total, proficiency? }` |
| `core_concept_stats` | 개념별 집계 (취약 개념 표시용) |
| `sub_core_id_stats` | 세부 개념별 집계 (취약 개념 Top3 계산용) |

- 퀴즈 제출 시 `gradingService.submitQuizResult`가 위 경로에 **increment**로 누적합니다. 이 경로에 문서가 없거나 certCode가 다르면 대시보드에 0%로 나올 수 있습니다.

## 3. 확인 체크리스트

Firebase Console에서 다음을 확인하세요.

1. **사용자 UID**  
   - 앱 로그인 시 사용하는 UID와 Console의 `users / {uid}` 문서 ID가 같은지.

2. **exam_results 위치**  
   - 반드시 `users / {해당 uid} / exam_results` **서브컬렉션**인지.  
   - 최상위 컬렉션 `exam_results` 등 다른 경로에 있으면 대시보드에서 읽지 않습니다.

3. **exam_results 문서 필드**  
   - 각 문서에 `certCode` 또는 `certId`가 있는지.  
   - **`submittedAt`** (Timestamp)가 있는지. 없으면 정렬 쿼리 결과에서 빠질 수 있습니다.

4. **stats 문서 위치·ID**  
   - `users / {해당 uid} / stats / BIGDATA` 형태인지.  
   - 문서 ID가 `BIGDATA`(대문자)인지. `bigdata` 등이면 별도 문서로 인식됩니다.

5. **캐시**  
   - 마이페이지 상단 **「데이터 새로고침」**으로 캐시 무효화 후 다시 로드해 보기.

## 4. 개발 시 디버깅

개발 모드(`npm run dev` 또는 `npm run dev:beta`)에서 마이페이지를 열고 콘솔을 확인하면:

- `[Stats] fetchUserTrendData` 로그: 사용한 `uid`, `certCode`, exam_results **전체 건수**, **필터 후 건수**
- `[Stats] fetchDashboardStats` 로그: `uid`, `certCode`, **stats 문서 존재 여부**, recentExamDocs **건수**

Firebase Console의 데이터와 위 로그를 비교하면 어디에서 불일치가 나는지 추적할 수 있습니다.
