# 배포 체크리스트 (코드/규칙 반영 시)

변경사항을 **Git**, **로컬 확인**, **베타**, **실서버**에 반영할 때 순서대로 진행하세요.

## 1. Git

```bash
git add .
git status   # 변경 파일 확인
git commit -m "메시지"
git push
```

## 2. 로컬 확인

```bash
npm run build      # 프로덕션 빌드
# 또는
npm run dev        # 개발 서버로 동작 확인
```

### 로컬에서 베타 버전으로 보기

베타 전용 UI(강제 로그인, 오티 팝업, 쿠폰 입력 등)를 로컬에서 확인하려면:

```bash
npm run dev:beta
```

브라우저에서 **http://localhost:5173** (또는 터미널에 뜬 주소)로 접속하면 베타 모드로 동작합니다.  
`npm run dev`만 쓰면 실서버(핀셋) 설정으로 뜹니다.

## 3. Firestore 규칙 (실서버/베타 공통 DB 사용 시)

Auth·Firestore는 **aibt-99bc6**를 쓰므로, 규칙을 바꿨다면 **한 번만** 기본 프로젝트에 배포합니다.

```bash
firebase use default
npm run deploy:rules
```

## 4. 베타 배포 (aibt-beta.web.app)

```bash
npm run deploy:beta
```

## 5. 실서버 배포 (aibt-99bc6.web.app)

```bash
npm run deploy:prod
```

- `deploy:prod`: 기본 프로젝트로 전환 → 빌드 → **Firestore 규칙 + 호스팅** 한 번에 배포

---

**요약**: Git 푸시 → 로컬 빌드 확인 → `deploy:rules` (규칙 변경 시) → `deploy:beta` → `deploy:prod`

---

## 문구(카피) 위치

| 문구 | 파일 | 위치(줄 근처) |
|------|------|----------------|
| 로그인 후 이용해 주세요. | `src/App.tsx` | 913 |
| 🚀 FINSET 핵심 기능 가이드 (오티 헤더) | `src/components/OrientationPopup.tsx` | 118 |
| 1페이지: 안녕하세요! AiBT 베타테스터… | `src/components/OrientationPopup.tsx` | 15–21 (`SLIDES[0].content`) |
| 2~4페이지 제목·본문 | `src/components/OrientationPopup.tsx` | 23–51 (`SLIDES` 배열) |
| 5페이지: 카카오톡 메신저… 쿠폰번호… @aibt_beta | `src/components/OrientationPopup.tsx` | 141, 154–156, 162 |
| 로그인 모달 베타 문구(구글+쿠폰 안내) | `src/components/LoginModal.tsx` | 404, 431줄 근처 |
