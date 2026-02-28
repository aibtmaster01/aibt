# 기타: Firestore 인덱스 가이드

> 문제풀기 시 인덱스 관련 에러 대응.  
> 오류 코드는 `09_기타_오류코드대조표.md` 참고.

---

## 1. q_id 단일 필드 인덱스 (1~4회차)

**에러 예시:**  
`The query requires a COLLECTION_GROUP_ASC index for collection questions and field q_id`

**원인:**  
`collectionGroup('questions')` + `where('q_id', 'in', chunk)` 쿼리. 단일 필드 인덱스는 `firestore.indexes.json`로 정의 불가.

**해결 (콘솔에서):**

1. 아래 링크 브라우저로 열기 (프로젝트 aibt-99bc6):  
   ```
   https://console.firebase.google.com/v1/r/project/aibt-99bc6/firestore/indexes?create_exemption=...
   ```
2. "인덱스 생성" 버튼 클릭
3. Building → Enabled까지 1~2분 대기

---

## 2. 복합 인덱스 (5회차 AI 출제)

**에러 예시:**  
`The query requires an index. You can create it here: ...` (cert_id, random_id 또는 topic 관련)

**해결:**  
`firestore.indexes.json`에 이미 정의됨. 배포:

```bash
npx firebase-tools deploy --only firestore:indexes
```

배포 후 콘솔에서 Enabled 대기.

---

## 3. 요약

| 상황 | 할 일 |
|------|--------|
| q_id 인덱스 (1~4회차) | 콘솔 링크 열기 → 인덱스 생성 → Enabled 대기 |
| cert_id+random_id 등 (5회차) | `firebase deploy --only firestore:indexes` 후 확인 |
