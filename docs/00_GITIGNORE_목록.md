# .gitignore 목록

> 프로젝트 루트 `.gitignore`에 정의된 제외 항목. 배포·협업 시 참고.  
> 실제 내용은 루트 `/.gitignore` 파일과 동기화됨.

---

## 로그·빌드

| 패턴 | 설명 |
|------|------|
| `logs`, `*.log` | 로그 파일 |
| `npm-debug.log*`, `yarn-debug.log*`, `pnpm-debug.log*`, `lerna-debug.log*` | 패키지 매니저 디버그 로그 |
| `node_modules` | npm 의존성 (저장소 미포함) |
| `dist`, `dist-ssr` | Vite 빌드 산출물 (배포 시 `npm run build`로 생성) |
| `*.local` | 로컬 설정 파일 |

---

## 환경·비밀 정보

| 패턴 | 설명 |
|------|------|
| `.env`, `.env.*` | 환경 변수 (Firebase 키 등). 단, `!.env.example` 제외 |
| `**/serviceAccountKey.json` | Firebase 서비스 계정 키 (모든 경로) |
| `**/*-firebase-adminsdk*.json` | Firebase Admin SDK 키 파일 |
| `backend/.env`, `backend/.venv/` | 백엔드 전용 환경·가상환경 |

---

## Python

| 패턴 | 설명 |
|------|------|
| `.venv/`, `venv/` | Python 가상환경 |
| `__pycache__/`, `*.py[cod]`, `*.pyo`, `*.so`, `.Python` | 캐시·컴파일 산출물 |

---

## 대용량·외부 데이터 (미포함)

| 패턴 | 설명 |
|------|------|
| `backend/BIGDATA/Final_*.json` | 빅데이터 최종 JSON |
| `backend/BIGDATA/*_final.json` | 빅데이터 파이널 파일 |
| `backend/BIGDATA/*1000*.json`, `*1260*.json` | 대용량 문제 데이터 (1000제 등) |
| `google-cloud-sdk/` | Google Cloud SDK 로컬 설치 디렉터리 (용량 큼) |

---

## 에디터·OS

| 패턴 | 설명 |
|------|------|
| `.vscode/*` (단, `!.vscode/extensions.json` 제외) | VSCode 설정 |
| `.idea`, `*.suo`, `*.ntvs*`, `*.njsproj`, `*.sln`, `*.sw?` | IDE·임시 파일 |
| `.DS_Store` | macOS 시스템 파일 |
