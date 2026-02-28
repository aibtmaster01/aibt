# Storage CORS 근본 해결 (index.json fetch 오류)

## 오류 원인

- 브라우저가 `http://localhost:3000`에서 Firebase Storage URL로 `fetch()` 할 때, **응답에 `Access-Control-Allow-Origin` 헤더가 없으면** CORS 정책 때문에 막힙니다.
- **근본 해결**: 해당 파일이 들어 있는 **Google Cloud Storage 버킷에 CORS 설정**을 넣어 주면 됩니다. (Firebase 콘솔에는 CORS 메뉴가 없고, **GCP에서 버킷 CORS만 설정**하면 됩니다.)

---

## 1단계: 버킷 이름 확인

1. [Google Cloud Console](https://console.cloud.google.com/) 접속 후 프로젝트 **aibt-99bc6** 선택.
2. 왼쪽 메뉴 **스토리지** → **버킷** 이동.
3. 목록에서 **이름**이 아래 둘 중 하나인 버킷을 찾습니다.
   - `aibt-99bc6.appspot.com`
   - `aibt-99bc6.firebasestorage.app`  
   (표시 이름이 조금 다를 수 있으니, 목록에 보이는 **버킷 이름**을 그대로 적어 둡니다.)

---

## 2단계: CORS 설정 파일 위치

프로젝트 안에 이미 CORS 설정 파일이 있습니다.

- **경로**: `backend/Contents/Bigdata/storage-cors.json`
- **내용**: `localhost:3000`, `127.0.0.1:3000`, Firebase 호스팅 도메인 등에서 GET/HEAD 허용.

추가로 허용할 도메인이 있으면 이 파일의 `origin` 배열에 넣으면 됩니다.

---

## 3단계: CORS 적용

### 방법 0: 스크립트로 한 번에 시도 (권장)

프로젝트에 CORS 적용 스크립트가 있습니다. **gcloud CLI가 설치·로그인**되어 있으면 아래만 실행하면 됩니다.

```bash
cd /Users/syun/Downloads/aibt_cursor
gcloud config set project aibt-99bc6
./backend/Contents/Bigdata/apply-storage-cors.sh
```

버킷 이름을 이미 알고 있으면 인자로 넘깁니다.

```bash
./backend/Contents/Bigdata/apply-storage-cors.sh aibt-99bc6.appspot.com
```

---

### 방법 A: 로컬에서 gcloud/gsutil 직접 사용

**Google Cloud SDK(gcloud) 설치 및 로그인**이 되어 있어야 합니다.

```bash
# 1) 프로젝트 루트로 이동
cd /Users/syun/Downloads/aibt_cursor

# 2) 프로젝트 선택
gcloud config set project aibt-99bc6

# 3) 버킷에 CORS 적용 (버킷 이름은 1단계에서 확인한 값으로 바꿈)
# appspot.com 버킷인 경우:
gcloud storage buckets update gs://aibt-99bc6.appspot.com --cors-file=backend/Contents/Bigdata/storage-cors.json

# firebasestorage.app 버킷인 경우:
gcloud storage buckets update gs://aibt-99bc6.firebasestorage.app --cors-file=backend/Contents/Bigdata/storage-cors.json
```

**gsutil**만 있는 경우:

```bash
gsutil cors set backend/Contents/Bigdata/storage-cors.json gs://aibt-99bc6.appspot.com
# 또는
gsutil cors set backend/Contents/Bigdata/storage-cors.json gs://aibt-99bc6.firebasestorage.app
```

### 방법 B: Google Cloud Shell에서 실행

1. [Google Cloud Console](https://console.cloud.google.com/) → 상단 **>_** (Cloud Shell) 클릭.
2. 프로젝트가 `aibt-99bc6`인지 확인.
3. 아래 중 **버킷 이름에 맞는 명령 하나**만 실행 (파일 내용은 직접 만들거나 프로젝트에서 복사).

**cors.json을 직접 만들 때:**

```bash
cat > cors.json << 'EOF'
[{"origin":["http://localhost:3000","http://127.0.0.1:3000","https://aibt-99bc6.web.app","https://aibt-99bc6.firebaseapp.com"],"method":["GET","HEAD"],"responseHeader":["Content-Type","Content-Length"],"maxAgeSeconds":3600}]
EOF
```

**appspot.com 버킷인 경우:**

```bash
gcloud storage buckets update gs://aibt-99bc6.appspot.com --cors-file=cors.json
```

**firebasestorage.app 버킷인 경우:**

```bash
gcloud storage buckets update gs://aibt-99bc6.firebasestorage.app --cors-file=cors.json
```

---

## 4단계: 적용 확인

- 브라우저에서 앱(`http://localhost:3000`) 새로고침 후 Round 1 등 다시 시도.
- 개발자 도구 **네트워크** 탭에서 `index.json` 요청 선택 → **응답 헤더**에 `Access-Control-Allow-Origin: http://localhost:3000` 이 있으면 CORS 적용된 것입니다.

---

## 그래도 안 될 때 (대안)

- CORS를 설정할 수 없는 환경이면, 앱은 **Storage 실패 시 Firestore**에서 index를 읽도록 되어 있습니다.
- `certifications/BIGDATA/public/index` 문서에 index가 있으면 동작하므로, 업로드 스크립트(`upload_contents_and_index.py`)를 한 번 실행해 두면 Firestore로도 사용할 수 있습니다.
