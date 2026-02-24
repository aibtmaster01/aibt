# 오류 코드 대조표 (내부용)

유저에게는 **표시 코드**만 보입니다. 유저가 "오류코드: 7K2M-A9P1 이 떴어요"라고 알려주면 아래 표에서 **표시 코드**로 찾아 **내부 코드**와 원인을 확인하세요.

| 유저에게 보이는 코드 (표시 코드) | 내부 코드 | 원인 / 조치 |
|--------------------------------|-----------|-------------|
| 7K2M-A9P1 | ERR_FIREBASE_PERMISSION | Firestore 권한 부족. **해결:** `docs/ERR_FIREBASE_PERMISSION_해결(7K2M-A9P1).md` 참고. (배포 프로젝트 일치, 콘솔 규칙 확인, App Check 여부) |
| B4N8-C3Q6 | ERR_LOAD_QUESTIONS | 문제 로딩 실패. 문제 데이터 없음 또는 네트워크/경로 이슈. |
| D1R5-E8T2 | ERR_ACCESS_DENIED | 접근 제한(회차 잠금, 준비중 과목 등). checkExamAccess 사유 확인. |
| F6W9-G0Y4 | ERR_EXAM_CONFIG | 시험 장부 없음/비정상. static_exams 또는 question_refs 확인. |
| H2U7-J5I3 | ERR_CERT_NOT_FOUND | 해당 자격증 없음. certId / CERTIFICATIONS 매칭 확인. |
| L8O0-M3S6 | ERR_NETWORK | 네트워크 오류. fetch 실패 등. |
| P4V1-Z9X2 | ERR_UNKNOWN | 위에 해당하지 않는 기타 오류. 메시지/스택으로 추가 원인 파악. |

- **표시 코드**는 `src/utils/errorCodes.ts`의 `INTERNAL_TO_DISPLAY`와 동기화되어 있습니다.
- 새 내부 코드 추가 시 해당 파일과 이 표를 함께 수정하세요.
