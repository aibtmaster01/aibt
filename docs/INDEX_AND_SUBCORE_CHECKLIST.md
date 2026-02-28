# index.json + sub_core_id 반영 후 해야 할 일

구현된 내용을 배포·운영하려면 아래를 진행하세요.

---

## 1. Firebase Storage에 index.json 올리기 (수동 아님 → 스크립트로 자동)

- **직접 Firebase 콘솔에 올릴 필요 없습니다.** 아래 업로드 스크립트 한 번 실행하면 **Firestore(문제 문서) + Storage(index.json)** 둘 다 올라갑니다.
- **실행 방법** (backend 폴더 기준):
  ```bash
  cd backend && python3 Contents/Bigdata/upload_contents_and_index.py
  ```
- **필요 조건**: `serviceAccountKey.json`(또는 `GOOGLE_APPLICATION_CREDENTIALS`)이 있고, 해당 서비스 계정에 **Firebase Storage** 권한이 있어야 합니다.
- **동작**:
  - **문제 소스**: `backend/Contents/Bigdata/Bigdata_contents_1681.json` (q_id → 본문/옵션/해설 등)
  - **인덱스**: 같은 폴더의 `Bigdata_Index.json`(또는 `Index.json`)이 있으면 그 배열을 그대로 Storage `assets/BIGDATA/index.json`으로 업로드. **없으면** `Bigdata_contents_1681.json`의 키(q_id 목록)만으로 최소 인덱스를 만들어 업로드합니다.
- 앱은 기동 시 `syncQuestionIndex('BIGDATA')`로 이 파일을 받아 로컬 버전과 **서버 파일 수정 시각**을 비교해, 서버가 더 최신일 때만 다운로드·저장합니다.
- index 항목 형식(권장): `{ "q_id": "...", "metadata": { "core_id", "subject", "problem_type", "tags", "round", "sub_core_id" }, "stats": { ... } }` — `sub_core_id`가 있으면 큐레이션·통계에 활용됩니다.

---

## 2. Firestore 문제 문서에 sub_core_id 넣기

- **경로**: `certifications/BIGDATA/question_pools/contents_1681/questions/{q_id}`
- 업로드 스크립트가 **Index 파일**(`Bigdata_Index.json` 등)의 `metadata.sub_core_id`를 읽어 각 문제 문서에 `sub_core_id` 필드로 저장합니다.
- **할 일**: `Bigdata_Index.json`에 `sub_core_id`가 들어 있는 상태로 위 스크립트를 실행하면 Firestore + Storage가 한 번에 갱신됩니다.  
  (인덱스 파일 없이 `Bigdata_contents_1681.json`만 있으면, q_id에서 추정한 최소 메타데이터만 들어가고 `sub_core_id`는 비어 있을 수 있음)

---

## 3. core_concepts_list.json 새 형식 (이미 반영됨)

- **위치**: `backend/BIGDATA/core_concepts_list.json`
- **새 형식**: `{ "1": { "concept": "빅데이터의 특징", "keywords": [...] }, "2": { ... }, ... }`
- 업로드 스크립트는 이 형식을 읽어 `concept` 이름으로 문제의 `core_concept`를 채우도록 수정되어 있습니다.  
  별도 수정 없이 해당 파일만 새 형식으로 두면 됩니다.

---

## 4. 앱 배포

- 프론트를 배포하면 앱 기동 시 자동으로 `syncQuestionIndex('BIGDATA')`가 호출됩니다.
- 사용자 기기에는 IndexedDB `questionIndexCache`에 index가 저장되며, Round 4·5 맞춤형은 이 index 기반 3 Zone(약점/강점/랜덤) 선발 + getDoc 병렬 조회로 동작합니다.

---

## 5. 다른 자격증을 쓸 때

- **Storage 경로**: `src/services/db/localCacheDB.ts`의 `INDEX_STORAGE_PATH_BY_CERT`에 `{ CERT_CODE: 'assets/CERT_CODE/index.json' }` 추가.
- **풀 ID**: `src/services/aiRoundCurationService.ts`의 `QUESTION_POOL_ID_BY_CERT`에 `{ CERT_CODE: '풀ID' }` 추가.
- 해당 자격증용 index.json을 Storage에 올리고, 앱에서 동일하게 `syncQuestionIndex(certCode)`를 호출하도록 하면 됩니다.

---

## 요약 체크리스트

- [ ] **업로드 스크립트 1회 실행**: `cd backend && python3 Contents/Bigdata/upload_contents_and_index.py` → Firestore + Storage 자동 업로드 (콘솔에 수동 올리지 않음)
- [ ] 인덱스에 `metadata.sub_core_id` 넣으려면 `Bigdata_Index.json`을 같은 폴더에 두고 스크립트 실행
- [ ] `backend/BIGDATA/core_concepts_list.json`은 새 형식(`"n": { "concept", "keywords" }`) 유지
- [ ] 프론트 배포 후 앱 기동 시 index 동기화·Round 4·5 동작 확인
