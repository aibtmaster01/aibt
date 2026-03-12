# AiBT / 핀셋 — AI 기반 자격증 모의고사 플랫폼

데이터 자격증(빅데이터분석기사, SQLD, ADsP) 수험생을 위한 **AI 맞춤형 모의고사·약점 분석** 서비스.  
Firebase 인증/Firestore, React + Vite 프론트엔드, Python 백엔드(시드/문제 업로드) 구성.

---

## 버전·환경 구분

| 환경 | 용도 | 빌드/실행 | 호스팅 |
|------|------|-----------|--------|
| **실서버(프로덕션)** | 정식 서비스 (aibt-99bc6) | `npm run build` / `npm run dev` | aibt-99bc6.web.app |
| **베타** | 테스트(강제 로그인·오티·쿠폰·레벨 선택 등) | `npm run build:beta` / `npm run dev:beta` | aibt-beta.web.app |

- **베타 전용 기능**(난이도 선택, 업데이트 안내·오티 통합, 쿠폰 인증, 온보딩 상태 등)은 **실서버에 추후 구현 예정**으로, 실서버 문서에 "(추후 구현 예정)"으로 표기되어 있습니다.
- 상세 문서·화면정의·기능정의·회원정책: **`docs/README.md`** 및 `docs/` 내 개별 문서 참고.

---

## 실행 방법

**필수:** Node.js 18+

### 프론트엔드

```bash
npm install
npm run dev
```

- 로컬(실서버 설정): http://localhost:5173 (또는 3000)
- 베타 로컬: `npm run dev:beta` → 베타 전용 UI(로그인 강제·오티·쿠폰 등) 확인
- 환경 변수: `.env.local` 또는 `.env.beta`에 Firebase 등 설정. `.env*`는 git 제외.

### 백엔드 (Python 시드/업로드)

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

- Firestore 시드: `backend/README.md` 참고  
- 서비스 계정 키: `GOOGLE_APPLICATION_CREDENTIALS` 지정 (키 파일 **저장소에 올리지 말 것**)

---

## 프로젝트 구조

| 경로 | 설명 |
|------|------|
| `src/` | 프론트엔드 (React, 페이지/서비스/컴포넌트) |
| `backend/` | Python 스크립트 (시드, 문제 업로드, AI-Gen 파이프라인) |
| `docs/` | 설계·정책·가이드·**화면정의서·기능정의서·회원정책** (AI/디자인용 포함) |

---

## 문서 (docs/)

- **인덱스**: `docs/README.md` — 문서 목록·역할·실서버 vs 베타(추후 구현) 구분
- **AI/디자인용**: `docs/화면정의서.md`, `docs/기능정의서.md`, `docs/회원정책.md` — 화면 목록·기능·로직·이동 경로·정책을 구체적으로 기술하여, 해당 문서만으로도 UI/플로우 재구현 가능하도록 작성됨
- **정책**: 결제·회원관리·유저플로우
- **로직**: 모의고사 큐레이션, 채점·stats·Elo, 집중학습, 문제 생성
- **배포**: `docs/DEPLOY_CHECKLIST.md`

---

## Git

- 비밀값·빌드 산출물은 커밋하지 않습니다.  
  `.gitignore`: `node_modules/`, `dist/`, `.env*`, `**/serviceAccountKey.json`, `backend/.venv/` 등.
- 푸시 전 `git status`로 추적 파일 확인 권장.
