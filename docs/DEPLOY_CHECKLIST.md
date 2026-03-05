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
