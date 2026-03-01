# 기타: Firestore 인덱스 가이드

> 문제풀기 시 인덱스 관련 에러 대응.  
> 오류 코드는 `09_기타_오류코드대조표.md` 참고.

---

## 1. q_id 단일 필드 인덱스 (컬렉션 그룹)

**에러 예시:**  
`The query requires a COLLECTION_GROUP_ASC index for collection questions and field q_id`

**원인:**  
`collectionGroup('questions')` + `where('q_id', 'in', chunk)` 쿼리 사용 시 필요 (BIGDATA는 직접 경로 getDoc으로 조회하므로 해당 경로에서는 미사용. SQLD 등 다른 cert에서 collectionGroup 사용 시 필요). 단일 필드 컬렉션 그룹 인덱스는 `firestore.indexes.json`로 정의 불가.

**해결 (콘솔에서):**

1. 에러 메시지에 포함된 **create_exemption** 링크를 브라우저로 열기 (프로젝트 aibt-99bc6).  
   또는 `examService.ts` 상단 주석에 있는 q_id 인덱스 링크 사용.
2. "인덱스 생성" 버튼 클릭.
3. Building → Enabled까지 1~2분 대기.

---

## 2. 복합 인덱스 (맞춤형·랜덤 문항 등)

**에러 예시:**  
`The query requires an index. You can create it here: ...` (cert_id, random_id, topic 등)

**원인:**  
`collectionGroup('questions')` + `where('cert_id', '==', ...)` + `orderBy('random_id')` 등 복합 쿼리.

**해결:**  
프로젝트 루트 `firestore.indexes.json`에 이미 정의됨. 배포:

```bash
cd /path/to/aibt_cursor
npx firebase deploy --only firestore:indexes
```

배포 후 Firebase 콘솔 → Firestore → 색인 탭에서 상태가 "사용 설정됨"이 될 때까지 대기.

---

## 3. 요약

| 상황 | 할 일 |
|------|--------|
| q_id 컬렉션 그룹 인덱스 | 콘솔에서 create_exemption 링크로 인덱스 생성 → Enabled 대기 |
| cert_id+random_id, cert_id+topic 등 복합 인덱스 | `npx firebase deploy --only firestore:indexes` 후 콘솔에서 확인 |
