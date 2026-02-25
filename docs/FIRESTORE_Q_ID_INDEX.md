# Firestore: collection group `questions` + `q_id` 인덱스 (오류 P4V1-Z9X2)

## 오류 메시지

`The query requires a COLLECTION_GROUP_ASC index for collection questions and field q_id`

- **오류코드**: P4V1-Z9X2
- **원인**: `collectionGroup('questions')` + `where('q_id', 'in', ...)` 쿼리에 필요한 **단일 필드(컬렉션 그룹) 인덱스**가 없음.

---

## 해결 방법

### 1) 인덱스 배포 시도 (fieldOverrides)

프로젝트 루트에서:

```bash
firebase deploy --only firestore:indexes
```

`firestore.indexes.json`에 `fieldOverrides`로 `questions` 컬렉션 그룹의 `q_id` ASC 인덱스를 넣어 두었습니다. 위 배포가 성공하면 인덱스가 생성되고, **Building → Enabled** 될 때까지 몇 분 기다리면 됩니다.

---

### 2) 배포가 안 되거나 인덱스가 안 생기면: 콘솔에서 직접 생성

아래 링크를 **브라우저로 연 뒤**, Firebase 프로젝트(aibt-99bc6)로 로그인되어 있는지 확인하고, **인덱스 생성(또는 단일 필드 제외 설정) 버튼**을 클릭하세요.

**링크:**

https://console.firebase.google.com/v1/r/project/aibt-99bc6/firestore/indexes?create_exemption=Ck5wcm9qZWN0cy9haWJ0LTk5YmM2L2RhdGFiYXNlcy8oZGVmYXVsdCkvY29sbGVjdGlvbkdyb3Vwcy9xdWVzdGlvbnMvZmllbGRzL3FfaWQQAhoICgRxX2lkEAE

- Firestore → 인덱스 탭으로 이동한 뒤, `questions` 컬렉션 그룹 + `q_id` 단일 필드 인덱스가 **Enabled**가 될 때까지 대기(보통 1~5분).

---

## 확인

인덱스가 **Enabled**가 되면, 1회차 등 static_exams 기반 문제 로딩 시 해당 오류는 더 이상 발생하지 않아야 합니다.
