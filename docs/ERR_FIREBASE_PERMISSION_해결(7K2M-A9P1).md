# 7K2M-A9P1 (ERR_FIREBASE_PERMISSION) 해결 가이드

게스트/회원이 **문제풀기** 시작 시 "Missing or insufficient permissions" 가 나올 때 확인할 것.

**규칙을 이미 올바르게 배포했는데도 계속 나오면** → 아래 **0번**으로 어디서 실패하는지 확인한 뒤, **3번 App Check**를 꼭 확인하세요.

---

## 0. 어디서 실패하는지 먼저 확인 (브라우저 개발자 도구)

1. 브라우저에서 **F12** → **Console** 탭 연다.
2. 문제풀기 시작 버튼 눌러서 오류를 다시 낸다.
3. 콘솔에 다음 중 어떤 로그가 찍히는지 확인한다.
   - **`[getQuestionsForRound] getDoc(static_exams) 실패`**  
     → `certifications/{certCode}/static_exams/Round_X` 읽기 실패. 규칙 또는 App Check 확인.
   - **`[getQuestionsForRound] fetchQuestionsFromPools(collectionGroup questions) 실패`**  
     → collection group `questions` 쿼리 실패. 규칙 또는 인덱스 확인.

어느 단계에서 실패하는지 알면 아래에서 해당 부분만 집중해서 보면 된다.

---

## 1. 배포한 프로젝트가 앱과 같은지 확인

앱은 **projectId: aibt-99bc6** 를 사용합니다 (`src/firebase.ts`).

```bash
# 현재 CLI가 바라보는 프로젝트 확인
firebase use

# aibt-99bc6 이 아니면 전환
firebase use aibt-99bc6

# 규칙만 다시 배포
firebase deploy --only firestore:rules
```

배포가 끝나면 터미널에 **Project Console:** 와 **Firestore rules** URL이 나옵니다. 그 콘솔에서 규칙이 갱신됐는지 확인하세요.

---

## 2. Firebase 콘솔에서 규칙 직접 확인

1. https://console.firebase.google.com/project/aibt-99bc6/firestore/rules
2. **규칙** 탭에 아래와 비슷한 블록이 **실제로 올라와 있는지** 확인:

   ```
   match /certifications/{path=**} {
     allow read: if true;
     allow write: if false;
   }
   ```

3. **게시** 버튼으로 저장된 규칙이 최신인지 확인. (로컬에서 deploy 했다면 이미 반영돼 있어야 함.)

---

## 3. App Check (가장 흔한 원인)

**Firestore에 App Check가 켜져 있으면**, 규칙과 상관없이 **App Check 토큰이 없는 요청은 전부 거부**되고, 오류 메시지는 권한 오류(permission-denied)처럼 나옵니다.

### 확인 방법

1. Firebase 콘솔: **빌드 > App Check** (또는 **앱 검사**)
2. **Firestore** 행에서 “적용됨” / “Enforced” 인지 확인

### 해결

- **테스트용**: Firestore 행에서 **관찰(Monitor) 모드**로 두거나, **Enforce**를 끄고 저장 후 다시 문제풀기 시도.
- **운영용**: 웹 앱을 App Check에 등록(reCAPTCHA v3 등)하고, 앱에서 토큰을 붙여서 요청하도록 구현.

규칙을 올바르게 배포했는데도 7K2M-A9P1 이 계속 나오면 **App Check 적용 여부를 반드시 확인**하세요.

---

## 4. 규칙 요약 (현재 로컬 기준)

- **certifications** 아래 전체: `match /certifications/{path=**}` → `allow read: if true` (게스트 포함)
- **users**: 로그인한 본인만 읽기/쓰기, 관리자는 users 목록 읽기 가능
- **daily_visits**: 로그인 사용자만 본인 문서 쓰기

`firebase deploy --only firestore:rules` 한 번 더 실행한 뒤, 브라우저 **강력 새로고침(Ctrl+Shift+R 또는 Cmd+Shift+R)** 하고 다시 문제풀기 들어가서 시도해 보세요.
