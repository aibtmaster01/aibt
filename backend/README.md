# Backend - 시드 스크립트

## seed_certification_info.py

자격증 정보(과목 수, 과목명, 문항 수, 합격 기준, 시험 시간)를 Firestore `certifications/BIGDATA/certification_info/config` 에 저장합니다.  
(빅데이터 필기: 4과목 각 20문항, 평균 60점·과목별 40점 이상 합격, 120분)  
자격증 설정은 **backend/BIGDATA** 폴더의 `core_concepts_list.json`·`bigdata_certification_config.py`를 사용합니다.

```bash
cd backend
python3 seed_certification_info.py
# BIGDATA만 시드: python3 seed_certification_info.py BIGDATA
```

---

## backend/BIGDATA (빅데이터 자격증 데이터)

- **core_concepts_list.json** — 코어컨셉 목록 (시드·업로드 시 사용)
- **bigdata_certification_config.py** — 자격증 설정 (과목, 합격 기준, core_concepts 로드)

---

## backend/Contents/Bigdata (콘텐츠·인덱스 업로드, 현재 운영)

- **upload_contents_and_index.py** — Bigdata_contents_1681.json → Firestore `question_pools/contents_1681/questions/{q_id}`, 인덱스 파일 → Storage `assets/BIGDATA/index.json` + Firestore `certifications/BIGDATA/public/index`
- **필요 파일:** 같은 디렉터리에 `Bigdata_contents_1681.json`, `Bigdata_Index.json`(또는 `Index.json`). 선택 시 `Bigdata_Index_Rebalanced.json` 사용 가능.
- **실행:**  
  ```bash
  cd backend
  export GOOGLE_APPLICATION_CREDENTIALS="/path/to/serviceAccountKey.json"
  python3 Contents/Bigdata/upload_contents_and_index.py
  ```
- 서비스 계정에 Firestore + Storage 권한 필요. 상세: `docs/08_로직_문제생성로직.md`.

---

## seed_users.py

Firebase Admin SDK로 테스트용 계정을 일괄 생성합니다.

### 사전 요구사항

1. Firebase 프로젝트 서비스 계정 키(JSON) 다운로드
2. 환경변수 설정:
   ```bash
   export GOOGLE_APPLICATION_CREDENTIALS="/path/to/serviceAccountKey.json"
   ```

### 설치 및 실행

```bash
cd backend
pip3 install -r requirements.txt
python3 seed_users.py
```

### Firestore users 컬렉션 (요약)

- `email`, `name`, `isAdmin`, `is_verified`, `registered_devices`, `memberships`
- 앱에서는 `isPremium`, `paidCertIds`, `subscriptions`, `targetExamDateByCert` 등도 사용.  
  실제 스키마는 `authService`·`adminService`의 Firestore 읽기/쓰기와 동기화.

### seed_users.py 생성 계정

테스트용 계정 예시. 실행 전 `GOOGLE_APPLICATION_CREDENTIALS` 설정 필요.  
생성되는 이메일·역할은 스크립트 내 정의를 참고.
