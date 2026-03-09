# 배포 체크리스트 (코드/규칙 반영 시)

변경사항을 **Git**, **로컬 확인**, **베타**, **실서버**에 반영할 때 순서대로 진행하세요.

**다른 AI 에이전트를 위한 설명**: 배포는 `package.json`의 scripts와 Firebase 프로젝트(`firebase use default` / `firebase use beta`)로 수행합니다. 실서버 = 기본 프로젝트(aibt-99bc6) 호스팅, 베타 = aibt-beta 호스팅. Auth·Firestore·Storage는 **aibt-99bc6 한 프로젝트**를 공유합니다.

## 1. Git

```bash
git add .
git status   # 변경 파일 확인
git commit -m "메시지"
git push
```

## 2. 로컬 확인

```bash
npm run build      # 실서버용 프로덕션 빌드 (기본값 = 핀셋)
# 또는
npm run dev        # 개발 서버로 동작 확인 (실서버 설정)
```

- **빌드 산출물**: `dist/`. 베타 빌드는 `npm run build:beta`(아래 4절 참고).

### 로컬에서 베타 버전으로 보기

베타 전용 UI(강제 로그인, 오티 팝업, 쿠폰 입력 등)를 로컬에서 확인하려면:

```bash
npm run dev:beta
```

- **동작**: `VITE_APP_BRAND=AiBT`, `VITE_FEATURE_COUPON=true`로 Vite 실행. **http://localhost:5173** 접속 시 베타 모드.  
- `npm run dev`만 쓰면 실서버(핀셋) 설정으로 뜹니다.

## 3. Firestore 규칙 (실서버/베타 공통 DB 사용 시)

Auth·Firestore는 **aibt-99bc6**를 쓰므로, `firestore.rules` 수정 후 **기본 프로젝트**에 배포합니다.

```bash
firebase use default
firebase deploy --only firestore:rules
# 또는
npm run deploy:rules
```

## 4. 베타 배포 (aibt-beta.web.app)

```bash
npm run deploy:beta
```

- **의미**: `vite build --mode beta` 후 Firebase 프로젝트 beta로 전환해 **호스팅만** 배포. DB는 aibt-99bc6 공유.

## 5. 실서버 배포 (aibt-99bc6.web.app)

```bash
npm run deploy:prod
```

- **의미**: `firebase use default` → `npm run build` → **Firestore 규칙 + 호스팅** 한 번에 배포.

---

**요약**: Git 푸시 → 로컬 빌드 확인 → `deploy:rules` (규칙 변경 시) → `deploy:beta` → `deploy:prod`

---

## 문구(카피) 위치

사용자에게 보이는 문구가 **어느 파일·어디 근처**에 있는지 참고용입니다. 줄 번호는 코드 수정으로 바뀔 수 있으므로, **문구 일부나 컴포넌트 이름으로 검색**하는 것이 안전합니다.

| 문구 | 파일 | 위치(참고) |
|------|------|-------------|
| 로그인 후 이용해 주세요. | `src/App.tsx` | `isBeta && !user`일 때 렌더하는 div. "로그인 후"로 검색. |
| 오티(OT) 헤더 제목 | `src/components/OrientationPopup.tsx` | 고정 헤더 `h2` (예: AiBT 베타테스터 핵심 기능 가이드). |
| 1페이지: 안녕하세요! AiBT 베타테스터… | `src/components/OrientationPopup.tsx` | `SLIDES[0].title`, `SLIDES[0].content` |
| 2~4페이지 제목·본문 | `src/components/OrientationPopup.tsx` | `SLIDES` 배열 인덱스 1, 2, 3 |
| 5페이지: 카카오톡… 쿠폰… @aibt_beta | `src/components/OrientationPopup.tsx` | 5페이지(slide.content === null) 쿠폰 입력 블록. "카카오톡", "@aibt_beta"로 검색. |
| 로그인 모달 베타 문구(구글+쿠폰) | `src/components/LoginModal.tsx` | 쿠폰 입력 단계 UI. "쿠폰 번호" 위 안내 텍스트. |
