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

- **core_concepts_list.json** — 코어컨셉 목록 (시드 시 사용)
- **1000_final.json** — 문제 1000제 (업로드 소스)
- **bigdata_certification_config.py** — 자격증 설정 (과목, 합격 기준, core_concepts 로드)
- **upload_1000.py** — 1000제를 Firestore question_pools + static_exams(Round_1~5)로 업로드

```bash
cd backend
python3 BIGDATA/upload_1000.py
# 확인 후 'DELETE' 입력 시 기존 BIGDATA 데이터 삭제 후 1000_final.json 기준으로 재업로드
```

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

### v5.0 Firestore 스키마 (users 컬렉션)

- `email`, `name`, `isAdmin`
- `is_verified`: boolean
- `registered_devices`: string[] (빈 배열로 초기화)
- `memberships`: `{ [certCode]: { tier: "PREMIUM"|"FREE", expiry_date?: "YYYY-MM-DD" } }`

### 생성되는 계정

| 이메일 | 비밀번호 | 설명 |
|--------|----------|------|
| paid_bigandsqldstudent@aaa.com | abc123456 | BIGDATA+SQLD 유료 (2026 만료) |
| paid_bigdatastudent@aaa.com | abc123456 | 빅분기만 유료 |
| halfpaid_student@aaa.com | abc123456 | 빅분기 유료, SQLD 무료 |
| free_bigdatastudent@aaa.com | abc123456 | 빅분기 무료 |
| free_nothingstudent@aaa.com | abc123456 | 신규 (memberships 빈 객체) |
| expired_student@aaa.com | abc123456 | BIGDATA 만료 |
| admin@aaa.com | abc123456 | 관리자 |
