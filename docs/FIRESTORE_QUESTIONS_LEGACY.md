# 루트 `questions` 컬렉션 (폐기/정리)

## 요약

Firestore **루트**에 있는 `questions` 컬렉션(`q_1_1`, `q_1_2` 등)은 예전에 쓰이던 문제 저장소입니다.  
**현재 앱은 이 컬렉션을 사용하지 않습니다.**

- **실제 사용 경로**: `certifications / {자격증코드} / question_pools / {풀ID} / questions / {q_id}`
- **앱 로직**: `examService.getQuestionsForRound()` → `static_exams`의 `question_refs` + `fetchQuestionsFromPools()` (collectionGroup `questions`)
- **레거시**: `quizService.getQuestions()` / `fetchStaticQuestions()` 만 루트 `questions`를 참조하며, **이 함수들은 앱 어디에서도 호출되지 않음**

## 삭제해도 되는지

**네.** 루트 `questions` 컬렉션 전체를 삭제해도 현재 서비스 동작에는 영향 없습니다.

## 삭제 방법

1. **Firebase Console**  
   [Firestore](https://console.firebase.google.com/project/aibt-99bc6/firestore) → 루트에 있는 `questions` 컬렉션 선택 → 문서 전체 삭제 후, (선택) 컬렉션 비우기/삭제

2. **스크립트로 일괄 삭제**  
   백엔드에서 `questions` 컬렉션을 배치로 읽어서 `delete()` 하는 스크립트를 돌려도 됩니다. (기존 `delete_collection` 패턴 참고)

삭제 후에는 예전에 만들어진 폐기 문제들이 자리만 차지하던 부분이 정리됩니다.
