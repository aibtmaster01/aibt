# Bigdata_Index_Leveled → 로컬 베타 전용 Firebase 업로드

## 1. 인덱스 / 컨텐츠 구분

| 구분 | 파일 | 내용 | 업로드 대상 |
|------|------|------|-------------|
| **인덱스** | `Bigdata_Index_Leveled.json` | `q_id`, `metadata`(round: l_1~h_3, 99), `stats` 등 메타만 | Firestore `certifications_beta/BIGDATA/public/index_leveled` + Storage `assets/BIGDATA/beta/index_leveled.json` |
| **컨텐츠** | `Final_Bigdata_Contents.json` | `q_id` → `question_text`, `options`, `explanation`, `image` 등 본문 | Firestore `certifications_beta/BIGDATA/question_pools/contents_1681/questions/{q_id}` |

- **나눈 것**: 이미 두 파일로 나뉘어 있음. 인덱스는 “어떤 문제가 어떤 라운드/과목인지”만, 컨텐츠는 “문제 본문”만 담음.
- **분리만 하고 싶을 때**: `--split-only` 옵션으로 업로드용 인덱스 파일만 따로 저장 가능 (`Index_Leveled_ForUpload.json`). 컨텐츠는 기존 파일 그대로 사용.

## 2. Firebase에 어떻게 올리나요?

### 사전 준비

1. **서비스 계정 키**  
   Firebase 콘솔 → 프로젝트 설정 → 서비스 계정 → 키 생성 → JSON 다운로드  
   → 프로젝트 루트 또는 `backend/` 에 `serviceAccountKey.json` 으로 저장  
   (또는 `GOOGLE_APPLICATION_CREDENTIALS` 환경 변수로 해당 JSON 경로 지정)

2. **필요 파일 확인**  
   같은 폴더에 다음이 있어야 합니다.  
   - `Bigdata_Index_Leveled.json` (레벨드 인덱스)  
   - `Final_Bigdata_Contents.json` (문항 본문)  
   - 인덱스는 `roundre_leveled.py` 실행으로 생성 가능.

### 업로드 실행

```bash
# backend 폴더 기준
cd backend
python3 Contents/Bigdata/upload_leveled_contents_and_index.py
```

또는 스크립트가 있는 폴더에서:

```bash
cd backend/Contents/Bigdata
python3 upload_leveled_contents_and_index.py
```

(이때 `Final_Bigdata_Contents.json`, `Bigdata_Index_Leveled.json` 이 **현재 작업 디렉터리**에 있도록 하거나, 스크립트가 `SCRIPT_DIR` 기준으로 이 파일들을 찾을 수 있어야 합니다. 스크립트는 자신이 있는 디렉터리를 기준으로 경로를 잡습니다.)

### 업로드되는 위치 (로컬 베타 전용, 실서버와 분리)

| 대상 | 경로 |
|------|------|
| 문항 문서 | Firestore `certifications_beta` → `BIGDATA` → `question_pools` → `contents_1681` → `questions` → `{q_id}` |
| 인덱스 (앱에서 사용) | Firestore `certifications_beta` → `BIGDATA` → `public` → 문서 ID `index_leveled` |
| 인덱스 (Storage 백업) | Storage `assets/BIGDATA/beta/index_leveled.json` |

실서버는 `certifications` / `question_pools` 를 쓰고, 베타는 `certifications_beta` 만 쓰므로 실서버에는 영향 없음.

### 분리만 할 때 (업로드 안 함)

```bash
python3 Contents/Bigdata/upload_leveled_contents_and_index.py --split-only
```

- `Index_Leveled_ForUpload.json` 이 생성되고, 컨텐츠는 기존 `Final_Bigdata_Contents.json` 그대로 사용하면 됨.
