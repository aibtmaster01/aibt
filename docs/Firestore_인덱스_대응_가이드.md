# Firestore 인덱스 에러 대응 가이드

## 1. 단일 필드 인덱스 (q_id) — 콘솔에서만 생성

**에러 예시:**  
`The query requires a COLLECTION_GROUP_ASC index for collection questions and field q_id`

**원인:**  
1~4회차 문제 로딩 시 `collectionGroup('questions')` + `where('q_id', 'in', chunk)` 쿼리 사용. 단일 필드 인덱스는 `firestore.indexes.json`으로 정의할 수 없음.

**해결 (파이어베이스 콘솔에서 할 일):**

1. 아래 링크를 **브라우저**에서 연다.  
   **프로젝트: aibt-99bc6**

   ```
   https://console.firebase.google.com/v1/r/project/aibt-99bc6/firestore/indexes?create_exemption=Ck5wcm9qZWN0cy9haWJ0LTk5YmM2L2RhdGFiYXNlcy8oZGVmYXVsdCkvY29sbGVjdGlvbkdyb3Vwcy9xdWVzdGlvbnMvZmllbGRzL3FfaWQQAhoICgRxX2lkEAE
   ```

2. 열린 페이지에서 **「인덱스 생성」** (또는 **Create index**) 버튼을 클릭한다.

3. 인덱스 상태가 **Building** → **Enabled**로 바뀔 때까지 1~2분 정도 기다린다.

4. **Enabled**가 되면 앱에서 다시 문제풀기를 시도한다.

---

## 2. 복합 인덱스 (5회차 AI 출제) — 배포로 반영

**에러 예시:**  
`The query requires an index. You can create it here: ...` (cert_id, random_id 또는 cert_id, topic 관련)

**해결:**  
프로젝트 루트의 `firestore.indexes.json`에 이미 아래 복합 인덱스가 정의되어 있음.

- `questions` (collection group): `cert_id` ASC + `random_id` ASC  
- `questions` (collection group): `cert_id` ASC + `random_id` DESC  
- `questions` (collection group): `cert_id` ASC + `topic` ASC  

**배포:**

```bash
npx firebase-tools deploy --only firestore:indexes
```

배포 후 Firebase 콘솔 → Firestore → 인덱스 탭에서 **Enabled** 될 때까지 대기.

---

## 요약: 파이어베이스 콘솔에서 누를 버튼

| 상황 | 할 일 |
|------|--------|
| **q_id 인덱스 에러** (1~4회차 문제 로딩 시) | 위 **1번 링크** 열기 → **「인덱스 생성」** 버튼 클릭 → Enabled 대기 |
| **cert_id + random_id 등 복합 인덱스 에러** (5회차) | `npx firebase-tools deploy --only firestore:indexes` 실행 후 콘솔에서 인덱스 상태 확인 |
