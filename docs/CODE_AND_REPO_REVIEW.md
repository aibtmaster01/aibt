# 코드·저장소 검토 (푸시 전 점검)

> Git 연동 후 첫 푸시 전 검토 요약. 불필요 코드·문서 이동 시 참고.

---

## 1. .gitignore 상태 ✅

- **적용됨:** `node_modules/`, `dist/`, `*.local`, `.env`, `.env.*`(단, `!.env.example`), `**/serviceAccountKey.json`, `**/*-firebase-adminsdk*.json`
- **추가됨:** Python `.venv/`, `venv/`, `__pycache__/`, `*.py[cod]`, `backend/.env`, `backend/.venv/`
- **확인 권장:** `backend/.venv`가 이미 커밋된 이력이 있으면 `git rm -r --cached backend/.venv` 후 재커밋.  
  `backend/serviceAccountKey.json`, `backend/.env`도 마찬가지로 한 번 확인.

---

## 2. README

- 루트 **README.md**를 AI Studio 템플릿에서 **AIBT(합격해) 프로젝트용**으로 교체함.
- 실행 방법, 구조 요약, `docs/` 정책 문서 링크 포함.

---

## 3. 쓰이지 않거나 옮겨둘 만한 코드

| 항목 | 위치 | 설명 |
|------|------|------|
| **Layout** | `src/components/Layout.tsx` | 현재 앱에서 import되지 않음. 로그인/헤더는 `DashboardSidebar` + `LoginModal` 사용. **옮기기:** `_archive/` 또는 `components/legacy/` 등으로 이동 후 필요 시 복원. |
| **Login 페이지** | `src/pages/Login.tsx` | 라우트에 `/login` 케이스 없음 → `/login` 이동 시 404. 실제 로그인은 `LoginModal` 사용. **선택:** `/login` 진입 시 `Login` 렌더하도록 라우트 추가하거나, 페이지 제거 후 모달만 사용. |
| **GEMINI_API_KEY** | `vite.config.ts`, `.env.local` | `define`으로 주입되나 `src/`에서 사용처 없음. 레거시/향후 AI 기능용이면 유지, 아니면 제거 검토. |

---

## 4. 문서 정리 (다른 곳으로 옮기려면)

- **외부 전달용:** `docs/외부개발자_현재이슈_전달.md`, `docs/AIBT_마스터_리포트_예창패_요청사항.md` 등 → 팀 드라이브/위키로 옮기고 링크만 남기기.
- **목업/데이터:** `docs/목업_회원_목록.md` → 운영/기획용이면 별도 폴더(`docs/ops/` 등)로.
- **에러 해결기:** `docs/ERR_FIREBASE_PERMISSION_해결(7K2M-A9P1).md` → 이슈 해결 후 `docs/runbooks/` 같은 곳으로 정리 권장.
- **핵심 유지:** `CURATION_POLICY.md`, `FIREBASE_READ_AUDIT.md`, `디렉터리_구조_가이드.md`, `ToDo_List.md`는 저장소에 두는 것이 좋음.

---

## 5. 정책 문서 확인

- **CURATION_POLICY.md** — 게스트/무료/유료 회차 제한, UserRound, Zone 큐레이션 정리됨.
- **FIREBASE_READ_AUDIT.md** — 읽기 경로·보안 규칙 점검용.
- **디렉터리_구조_가이드.md** — 백엔드에 `Contents/Default/`, `Contents/SQLD_raw/` 등 언급되어 있음. 실제 폴더가 없으면 문서만 추후 수정.

---

## 6. 푸시 전 체크리스트

- [ ] `git status`로 `.venv`, `serviceAccountKey.json`, `.env` 등이 추적되지 않는지 확인
- [ ] 루트 README가 현재 프로젝트 기준인지 확인
- [ ] 불필요한 대용량 파일(예: `backend/BIGDATA/Final_1260.json`)을 저장소에 넣을지 결정. 넣지 않으려면 `.gitignore`에 `backend/BIGDATA/*.json`(또는 해당 파일) 추가
