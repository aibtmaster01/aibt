# .gitignore 목록

> 프로젝트 루트 `.gitignore`에 정의된 제외 항목. 배포·협업 시 참고.

---

## 로그·빌드

| 패턴 | 설명 |
|------|------|
| `logs`, `*.log` | 로그 파일 |
| `npm-debug.log*`, `yarn-debug.log*`, `pnpm-debug.log*`, `lerna-debug.log*` | 패키지 매니저 디버그 로그 |
| `dist`, `dist-ssr` | 빌드 산출물 |
| `*.local` | 로컬 설정 |

---

## 환경·비밀 정보

| 패턴 | 설명 |
|------|------|
| `.env`, `.env.*` | 환경 변수 (단, `!.env.example` 제외) |
| `**/serviceAccountKey.json` | Firebase 서비스 계정 키 |
| `**/*-firebase-adminsdk*.json` | Firebase Admin SDK 키 |
| `backend/.env`, `backend/.venv/` | 백엔드 전용 환경·가상환경 |

---

## Python

| 패턴 | 설명 |
|------|------|
| `.venv/`, `venv/` | 가상환경 |
| `__pycache__/`, `*.py[cod]`, `*.pyo`, `*.so`, `.Python` | 캐시·컴파일 산출물 |

---

## 대용량 데이터 (미포함)

| 패턴 | 설명 |
|------|------|
| `backend/BIGDATA/Final_*.json` | 최종 빅데이터 JSON |
| `backend/BIGDATA/*_final.json` | |
| `backend/BIGDATA/*1000*.json`, `*1260*.json` | 대용량 문제 데이터 |

---

## 에디터·OS

| 패턴 | 설명 |
|------|------|
| `.vscode/*` (단, `!.vscode/extensions.json` 제외) | VSCode 설정 |
| `.idea`, `*.suo`, `*.ntvs*`, `*.njsproj`, `*.sln`, `*.sw?` | IDE·임시 파일 |
| `.DS_Store` | macOS 시스템 파일 |
