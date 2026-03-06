# 관리자 계정(admin@aibt.com) 복구 방법

## 방법 1: Python 스크립트로 올리기 (권장)

프로젝트에 이미 스크립트가 있습니다. **서비스 계정 키**만 준비한 뒤 실행하면 됩니다.

### 1. 서비스 계정 키 준비

1. [Firebase Console](https://console.firebase.google.com/) → 프로젝트 **aibt-99bc6** → 톱니바퀴 → **프로젝트 설정**
2. **서비스 계정** 탭 → **새 비공개 키 생성** → JSON 다운로드
3. 다운로드한 파일을 프로젝트에 넣기:
   - `backend/serviceAccountKey.json`  
   또는  
   - `backend/aibt-99bc6-firebase-adminsdk.json`

### 2. 스크립트 실행

```bash
cd backend
python scripts/create_admin_account.py
```

- **Auth**: `admin@aibt.com` 계정이 없으면 생성, 있으면 비밀번호만 갱신
- **Firestore**: `users/{uid}` 문서를 생성/업데이트하고 `isAdmin: true` 설정

비밀번호를 바꾸려면 `backend/scripts/create_admin_account.py` 안의 `ADMIN_PASSWORD` 값을 수정한 뒤 다시 실행하면 됩니다.

---

## 방법 2: Firebase 콘솔에서 수동 추가

스크립트를 쓰지 않을 때만 아래 순서로 진행하세요.

---

## 1단계: Authentication에 사용자 추가

1. [Firebase Console](https://console.firebase.google.com/) → 프로젝트 **aibt-99bc6** 선택
2. **Authentication** → **Users** 탭 → **Add user** 클릭
3. 입력:
   - **Email**: `admin@aibt.com`
   - **Password**: 원하는 비밀번호 (6자 이상)
4. **Add user** 클릭
5. 생성된 사용자의 **UID**를 복사해 둡니다 (예: `abc123xyz...`). Firestore 문서 ID로 씁니다.

---

## 2단계: Firestore에 사용자 문서 추가

1. **Firestore Database** → **데이터** 탭
2. 컬렉션 **users** 선택 (없으면 생성)
3. **문서 추가** 클릭
4. **문서 ID**: 1단계에서 복사한 **UID** 그대로 입력
5. 아래 필드들을 추가:

| 필드 | 타입 | 값 |
|------|------|-----|
| `email` | string | `admin@aibt.com` |
| `isAdmin` | boolean | `true` |
| `name` | string | `관리자` (원하는 이름) |
| `familyName` | string | `관리` |
| `givenName` | string | `자` |
| `is_verified` | boolean | `true` (이메일 인증 생략 시) |
| `registered_devices` | array | 빈 배열 `[]` |
| `memberships` | map | 빈 객체 `{}` |
| `created_at` | string | `2025-03-04T00:00:00.000Z` (현재 시각 등) |

6. **저장** 클릭

---

## 3단계: 확인

- 실서버(https://aibt-99bc6.web.app) 또는 로컬에서 `admin@aibt.com`으로 로그인
- 관리자 메뉴(회원 관리, 쿠폰 등)가 보이면 복구 완료

---

**요약**: Auth에 사용자 추가 → UID 복사 → Firestore `users/{uid}` 문서 생성 후 `isAdmin: true` 포함해서 저장
