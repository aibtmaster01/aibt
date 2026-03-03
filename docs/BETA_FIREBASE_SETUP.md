# 베타 사이트 Firebase 설정 (aibt-beta.web.app)

베타는 **호스팅만** aibt-beta 프로젝트에 배포되고, **Auth·Firestore·Storage는 aibt-99bc6**를 사용합니다.

## 1. OAuth 허용 도메인 추가 (필수)

구글 로그인 시 "The current domain is not authorized for OAuth operations" 를 없애려면:

1. [Firebase Console](https://console.firebase.google.com/) → 프로젝트 **aibt-99bc6** 선택
2. **Authentication** → **Settings** 탭 → **Authorized domains**
3. **Add domain** 클릭 후 `aibt-beta.web.app` 추가 (필요 시 `aibt-beta.firebaseapp.com` 도 추가)

저장 후 구글 로그인을 다시 시도하세요.

---

## 2. index.json (질문 인덱스) – CORS 없이 동작

**베타 빌드에서는 Storage를 쓰지 않고, Firestore에서만 index를 불러오도록 되어 있습니다.**  
따라서 **Google Cloud Console에서 CORS 설정할 필요 없습니다.**

필요한 것: **Firestore에 인덱스 문서가 있어야 합니다.**

- 경로: `certifications` / `BIGDATA` / `public` / `index`
- 문서 필드 예: `items` (배열), `updatedAt` (타임스탬프)

Storage에 올려 둔 `assets/BIGDATA/index.json` 내용을 위 Firestore 문서로 한 번 넣어 두면, 베타에서 CORS 없이 동작합니다. (실서버는 계속 Storage → 실패 시 Firestore 폴백.)

---

## (참고) Storage CORS를 꼭 쓰고 싶을 때

Firebase 콘솔에는 CORS 설정 메뉴가 없습니다. **Google Cloud Console**에서 해야 합니다.

1. [Google Cloud Console](https://console.cloud.google.com/) 접속
2. 상단 프로젝트 선택에서 **aibt-99bc6** 선택 (Firebase와 같은 프로젝트)
3. 왼쪽 햄버거 메뉴 → **Storage** 또는 **Cloud Storage** → **Buckets**
4. 해당 버킷 선택 후 CORS 설정 (상세는 gsutil 또는 버킷 설정 참고)

베타는 위 2번 대로 Firestore만 쓰면 되므로, 이 단계는 선택 사항입니다.
