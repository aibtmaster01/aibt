# Firebase 이메일 인증 템플릿 설정 (한국어, 스팸 회피용)

구글 로그인·이메일 가입 시 발송되는 **이메일 인증 메일**이 스팸으로 분류되지 않도록, 제목과 본문을 **한국어**로 바꾸고 **핀셋(FINSET)·인증** 맥락으로 작성합니다.

## 설정 위치

1. [Firebase Console](https://console.firebase.google.com) → 프로젝트 선택
2. **Authentication** → **Templates** 탭
3. **Email address verification** (이메일 주소 인증) 행에서 **연필 아이콘(편집)** 클릭

## 사용 가능한 치환 변수

| 변수 | 설명 |
|------|------|
| `%DISPLAY_NAME%` | 수신자 표시 이름 |
| `%APP_NAME%` | 앱 이름 (Firebase 프로젝트 설정) |
| `%LINK%` | 인증 링크 URL |
| `%EMAIL%` | 수신자 이메일 주소 |

---

## 권장: 제목 (Subject)

아래 중 하나를 그대로 복사해 **제목**란에 넣으세요.

```
[%APP_NAME%] 합격을 응원해요 – 이메일 인증을 완료해 주세요
```

또는 더 짧게:

```
[%APP_NAME%] 핀셋 – 이메일 인증만 완료해 주세요
```

---

## 권장: 본문 (Message body)

아래를 **본문**란에 넣고, 필요하면 앱 이름 등을 수정하세요.

```
안녕하세요, %DISPLAY_NAME%님.

%APP_NAME%에서 합격을 응원합니다.
학습 기록과 맞춤 모의고사를 이용하려면 아래 버튼을 눌러 이메일 인증을 완료해 주세요.

다음 링크를 클릭하면 인증이 완료됩니다:
%LINK%

(이 링크는 한 번만 사용할 수 있으며, 24시간 후에는 만료됩니다.)

인증을 요청하지 않으셨다면 이 메일을 무시하셔도 됩니다.

감사합니다.
%APP_NAME% 드림
```

---

## 인증 메일이 안 올 때 (사용자·운영 체크리스트)

- **스팸함·프로모션함 확인**: Gmail/네이버 등에서는 기본 받은편지함이 아닌 스팸/프로모션 탭으로 갈 수 있습니다.
- **1~2분 대기**: 발송 후 도착까지 1~2분 걸릴 수 있으니, 재발송은 **90초 간격**으로만 가능합니다. 앱에서 "인증 메일 재발송"은 **세션당 최대 5번**까지 가능합니다.
- **Authorized domains**: Firebase Console → Authentication → Settings → **Authorized domains**에 사용 중인 도메인이 포함되어 있어야 합니다 (예: `aibt-99bc6.web.app`, 로컬 개발 시 `localhost`).
- **템플릿 설정**: 위의 제목·본문처럼 한국어로 설정해 두면 스팸 분류가 줄어듭니다. 미설정 시 기본 영어 메일이 갈 수 있습니다.
- **Firebase 할당량**: 같은 이메일/IP에 대해 Firebase가 `auth/too-many-requests`를 반환할 수 있습니다. 이 경우 앱에서 "90초 간격으로 최대 5번까지 가능합니다" 안내를 표시합니다.

## 요약

- **제목**: `[앱이름] 핀셋 – 이메일 인증만 완료해 주세요` 형태로, “핀셋·인증” 느낌으로 작성하면 스팸 필터 완화에 도움이 됩니다.
- **본문**: 한국어로, 합격 응원 + 인증 링크 설명만 담고, 짧고 정중하게 유지합니다.
- 실제 메일 내용 변경은 **Firebase Console → Authentication → Templates** 에서만 가능하며, 앱 코드의 `sendEmailVerification()` 호출만으로는 제목/본문을 바꿀 수 없습니다.

---

## 인증 메일이 안 올 때 확인할 것

1. **Firebase Console → Authentication → Templates**  
   - **Email address verification** 템플릿이 사용 설정되어 있는지 확인.
   - **발신자**가 Firebase 프로젝트 기본 이메일이거나, **Customize action URL** 등으로 도메인이 허용 목록에 있는지 확인.

2. **Authorized domains**  
   - **Authentication → Settings → Authorized domains**에 `localhost`, `aibt-99bc6.web.app` 등 앱 도메인이 포함되어 있어야 인증 링크가 동작합니다.

3. **스팸함·프로모션함**  
   - Gmail 등에서는 스팸/프로모션 탭에 들어갈 수 있으니 확인.

4. **제한/할당량**  
   - 같은 주소로 짧은 시간에 여러 번 재발송하면 `auth/too-many-requests`가 날 수 있습니다. 1분 이상 간격 두고 재발송해 보세요.

5. **앱에서 사용하는 옵션**  
   - 이 프로젝트는 `sendEmailVerification(user, { url: continueUrl, handleCodeInApp: true })`로 호출합니다.  
   - `continueUrl`은 인증 후 돌아올 앱 URL이며, 반드시 Authorized domains에 등록된 도메인이어야 합니다.

---

## 미인증 유저 10분 후 자동 삭제 (선택)

회원가입 후 "이메일 수정"으로 다른 주소로 다시 가입할 때, 이전에 생성된 **미인증** 계정을 정리하려면 Firebase Cloud Functions로 주기적으로 삭제할 수 있습니다.

- **동작**: 5분마다 실행되는 스케줄 함수가, 가입 후 **10분이 지난** 이메일 미인증 유저를 Authentication과 Firestore `users/{uid}`에서 삭제합니다.
- **구현**: `functions/` 폴더에 Node 18 기반 함수를 두고, `firebase deploy --only functions`로 배포합니다.  
  - `firebase-admin`: `auth().listUsers()`, `auth().deleteUser(uid)`  
  - `firestore.doc('users', uid).delete()`  
  - 생성 시각(`userRecord.metadata.creationTime`)이 10분 초과이고 `emailVerified === false`인 경우만 삭제
- **firebase.json**에 `"functions": { "source": "functions" }`가 있으면 해당 폴더가 함수 소스로 사용됩니다.

**예시 코드** (`functions/index.js`):

```js
const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();

const MAX_AGE_MS = 10 * 60 * 1000; // 10분

exports.deleteUnverifiedUsersAfter10Min = functions.pubsub
  .schedule('every 5 minutes')
  .onRun(async () => {
    const auth = admin.auth();
    const firestore = admin.firestore();
    let pageToken;
    do {
      const listResult = await auth.listUsers(1000, pageToken);
      const now = Date.now();
      for (const u of listResult.users) {
        if (u.emailVerified) continue;
        const created = u.metadata.creationTime ? new Date(u.metadata.creationTime).getTime() : 0;
        if (now - created < MAX_AGE_MS) continue;
        try { await firestore.doc('users/' + u.uid).delete(); } catch (_) {}
        try { await auth.deleteUser(u.uid); } catch (e) { console.warn(e.message); }
      }
      pageToken = listResult.pageToken;
    } while (pageToken);
    return null;
  });
```

`functions/package.json`에는 `firebase-admin`, `firebase-functions` 의존성과 `"main": "index.js"`를 두고, 배포 전에 `npm install` 후 `firebase deploy --only functions`를 실행하면 됩니다.
