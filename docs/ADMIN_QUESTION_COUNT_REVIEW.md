# 어드민 회원관리 "푼 문제" 미표시 검토

## 현재 구현 요약

- **위치**: 회원 관리 테이블의 "푼 문제" 컬럼, 회원 상세(결제/정보)에서도 동일 값 표시.
- **데이터 소스**: `users/{uid}/exam_results` 서브컬렉션. 각 문서의 `totalQuestions`를 합산해 "N개"로 표시.
- **호출 시점**: 메뉴가 "회원 관리"이고 필터된 회원 목록이 있을 때, 해당 회원 ID마다 `fetchUserQuestionCount(uid)` 호출.

## 코드 흐름

1. **Admin.tsx**
   - `menu === 'users'` 이고 `filteredUsers.length > 0`일 때만 `useEffect` 실행.
   - `filteredUserIds`(쉼표 구분 ID 문자열)를 기준으로 각 uid에 대해 `fetchUserQuestionCount(id)` 호출.
   - 결과를 `questionCounts[uid]`에 저장. 실패 시 해당 uid는 `0`으로 설정.

2. **adminService.fetchUserQuestionCount(uid)**
   - `users/{uid}/exam_results` 쿼리: `orderBy('submittedAt', 'desc')`, `limit(500)`.
   - 각 문서에서 `totalQuestions`를 합산. 없으면 `answers` 배열 길이로 대체(레거시 문서 대비).
   - 쿼리 실패 시 `console.error` 후 `0` 반환.

3. **표시**
   - 테이블: `row.user.id in questionCounts`일 때만 `"${questionCounts[row.user.id]}개"`, 아니면 `"-"`.
   - 상세 패널: `questionCounts[targetUser.id]`가 있으면 "N개", 없으면 "로딩 중...".

## 실서버에서 안 보일 때 점검 사항

### 1. Firestore 규칙

- 규칙상으로는 관리자만 다른 사용자 서브컬렉션을 읽을 수 있음.
- `match /users/{userId}/{document=**}` → `read` 조건에 `get(..., users/$(request.auth.uid)).data.get('isAdmin', false) == true` 포함되어 있으면, 로그인한 관리자는 `users/{userId}/exam_results` 읽기 가능.

**확인**: 실서버 Firestore 규칙이 위와 같이 배포되어 있는지, 그리고 **실제 로그인한 계정의 `users/{uid}` 문서에 `isAdmin: true`** 인지 확인.

### 2. 쿼리 실패(인덱스 등)

- `orderBy('submittedAt', 'desc')`만 사용하는 단일 필드 정렬은 보통 Firestore가 자동 인덱스로 처리.
- 인덱스 부족이면 쿼리 시 에러가 나고, `fetchUserQuestionCount`가 catch에서 `0`을 반환.

**확인**: 회원 관리 화면을 연 상태에서 브라우저 개발자 도구 → Console 탭에서  
`[adminService] fetchUserQuestionCount 실패 (uid: ...)` 로그가 있는지 확인.  
- `code: 'failed-precondition'` 등이면 인덱스 부족 가능성. 콘솔/이메일에 나온 인덱스 생성 링크로 인덱스 생성 후 재시도.

### 3. 데이터 존재 여부

- 실서버에서 해당 회원이 퀴즈를 제출한 적이 있어야 `exam_results` 문서가 있음.
- 각 문서에는 `gradingService.submitQuizResult`에서 `totalQuestions: sessionHistory.length`로 저장됨. 예전 문서는 `totalQuestions`가 없을 수 있어, 코드에서는 `answers.length`로 폴백하도록 수정해 둠.

**확인**: Firestore 콘솔에서 `users` → (특정 회원 uid) → `exam_results` 서브컬렉션에 문서가 있는지, 문서에 `totalQuestions` 또는 `answers` 필드가 있는지 확인.

### 4. 회원 목록/메뉴 상태

- 회원 목록이 비어 있으면(`filteredUsers.length === 0`) 푼 문제 수를 요청하는 effect가 아예 실행되지 않음.
- "회원 관리" 메뉴가 아닌 다른 메뉴에서는 effect가 실행되지 않음.

**확인**: 실서버에서 "회원 관리"를 클릭했을 때 회원 목록이 정상적으로 로드되는지 확인.

## 적용한 코드 변경

- **adminService.fetchUserQuestionCount**
  - `totalQuestions`가 없는 레거시 문서는 `answers` 배열 길이로 개수 산출하도록 폴백 추가.  
  - 이전에 사용하던 `docCount`, `missingTotalQuestions` 변수는 제거(미사용).

## 요약

| 현상 | 가능 원인 | 확인 방법 |
|------|-----------|-----------|
| 모두 "-" 또는 "0개" | 쿼리 실패(권한/인덱스) | Console에 `fetchUserQuestionCount 실패` 로그 확인 |
| 모두 "-" | effect 미실행 | 회원 목록 로드 여부, 메뉴가 "회원 관리"인지 확인 |
| 특정 회원만 0 | 해당 회원에게 exam_results 없음 또는 필드 없음 | Firestore에서 해당 uid의 exam_results 확인 |
| 일부만 숫자 | 권한/인덱스는 통과, 데이터 있는 회원만 숫자 표시 | 위 1~3 항목 순서로 점검 |

실서버에서는 위 1~4를 순서대로 확인한 뒤, Console 로그와 Firestore 데이터를 함께 보면 원인 특정이 가능합니다.
