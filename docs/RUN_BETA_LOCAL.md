# 베타 로컬 실행 방법

## 1. 프론트엔드 (로컬에서 베타 모드로 실행)

프로젝트 루트에서:

```bash
# 방법 A: npm 스크립트 (권장)
npm run dev:beta
```

또는

```bash
# 방법 B: 환경 변수 직접 지정
VITE_APP_BRAND=AiBT VITE_FEATURE_COUPON=true npm run dev
```

Windows (PowerShell) 예시:

```powershell
$env:VITE_APP_BRAND="AiBT"; $env:VITE_FEATURE_COUPON="true"; npm run dev
```

실행 후 브라우저에서 표시되는 주소(예: `http://localhost:5173`)로 접속하면 베타 로컬로 동작합니다.

---

## 2. Firebase에 레벨드 인덱스/문항 업로드 (최초 1회 또는 인덱스 수정 후)

베타 로컬에서 **진단 40문항·맞춤형** 문항을 쓰려면 `certifications_beta` 에 데이터가 있어야 합니다.

```bash
# 프로젝트 루트가 아닌 backend 쪽에서 실행할 때
cd backend
python3 Contents/Bigdata/upload_leveled_contents_and_index.py
```

또는 스크립트가 있는 폴더에서:

```bash
cd backend/Contents/Bigdata
python3 upload_leveled_contents_and_index.py
```

**필요 조건**

- 같은 폴더에 `Bigdata_Index_Leveled.json`, `Final_Bigdata_Contents.json` 존재
- Firebase 서비스 계정 키: `backend/` 또는 프로젝트 루트에 `serviceAccountKey.json`  
  또는 환경 변수 `GOOGLE_APPLICATION_CREDENTIALS` 에 JSON 경로 지정

---

## 3. 레벨드 인덱스 재생성 (roundre 변경 후)

라운드/난이도/시각화 규칙을 바꾼 뒤 인덱스를 다시 만들 때:

```bash
cd backend/Contents/Bigdata
python3 roundre_leveled.py
```

생성된 `Bigdata_Index_Leveled.json` 을 2번처럼 업로드하면 됩니다.

---

## 4. 요약

| 목적 | 명령 |
|------|------|
| **베타 로컬 앱 실행** | `npm run dev:beta` |
| **레벨드 데이터 Firebase 업로드** | `cd backend && python3 Contents/Bigdata/upload_leveled_contents_and_index.py` |
| **레벨드 인덱스만 재생성** | `cd backend/Contents/Bigdata && python3 roundre_leveled.py` |
