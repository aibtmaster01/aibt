# 핀셋 FINSET — AI 기반 자격증 모의고사 플랫폼

자격증 대비 모의고사·진단평가 서비스. Firebase 인증/Firestore, React + Vite 프론트엔드, Python 백엔드(시드/문제 업로드) 구성. 팀: 반지고리.

## 실행 방법

**필수:** Node.js 18+

### 프론트엔드

```bash
npm install
npm run dev
```

- 로컬: http://localhost:3000
- 환경 변수: `.env.local`에 Firebase 등 필요한 키 설정 (참고: `.env.example`이 있다면 복사 후 값 채우기).  
  `.env*` 파일은 git에 포함되지 않습니다.

### 백엔드 (Python 시드/업로드)

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

- Firestore 시드: `backend/README.md` 참고  
- 서비스 계정 키: `GOOGLE_APPLICATION_CREDENTIALS`로 지정 (키 파일은 **저장소에 올리지 말 것**)

## 프로젝트 구조

| 경로 | 설명 |
|------|------|
| `src/` | 프론트엔드 (React, 페이지/서비스/컴포넌트) |
| `backend/` | Python 스크립트 (시드, 문제 업로드, AI-Gen 파이프라인) |
| `docs/` | 설계·정책·가이드 문서 |

상세 문서·목록은 **`docs/README.md`** 참고.

## 정책·설계 문서 (docs/)

문서 인덱스는 **`docs/README.md`** 참고.

- **정책**: 결제·회원관리·유저플로우
- **로직**: 모의고사 큐레이션, 채점·stats 업데이트, 집중학습, 문제 생성
- **기타**: 오류 코드 대조표, Firestore 인덱스 가이드

## Git

- 비밀값·빌드 산출물은 커밋하지 않습니다.  
  `.gitignore`에 `node_modules/`, `dist/`, `.env*`, `**/serviceAccountKey.json`, `backend/.venv/`, `google-cloud-sdk/` 등이 포함되어 있습니다.
- 푸시 전 `git status`로 추적 파일 한 번 확인 권장.
