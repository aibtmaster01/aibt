# Services

프론트엔드 비즈니스 로직·API·Firestore 연동 서비스.

---

## 서비스 목록

| 파일 | 목적 |
|------|------|
| [authService.ts](./authService.ts) | 인증·회원 — 로그인/회원가입/로그아웃, 비밀번호 변경·재설정, 기기 수 제한. Firebase Auth + Firestore users 연동. |
| [examService.ts](./examService.ts) | 시험 문제 — Round 1~3 static_exams, Round 4+ aiRoundCurationService, 집중학습(과목/유형/개념), 접근 제어, 등급별 마스킹. |
| [aiRoundCurationService.ts](./aiRoundCurationService.ts) | Round 4+ 맞춤 큐레이션 — Zone A/B, 과목별 배분, 20/80문제 생성. |
| [gradingService.ts](./gradingService.ts) | 채점·통계 — 과목별 점수·합격 판정, exam_results 저장, stats 3차원 갱신, Elo 업데이트. |
| [statsService.ts](./statsService.ts) | 대시보드 통계 — stats·exam_results 조회, 레이더·약점·트렌드 포맷 변환. |
| [statsServiceWithCache.ts](./statsServiceWithCache.ts) | 마이페이지 캐시 래퍼 — statsService 결과 캐싱. |
| [adminService.ts](./adminService.ts) | 관리자 — admin_users, memberships, 회원 목록/상세, 에러 로그. |
| [adminQuestionService.ts](./adminQuestionService.ts) | 관리자 문제 CRUD — 문제 조회/수정/삭제. |
| [errorLogService.ts](./errorLogService.ts) | 클라이언트 에러 로깅 — Firestore에 에러 기록. |
| [db/localCacheDB.ts](./db/localCacheDB.ts) | IndexedDB 캐시 — 문제 인덱스 로컬 저장·동기화. |

---

## 데이터 흐름 요약

```
[인증]     authService             → 로그인/회원·멤버십
[문제 선정] examService             → 라운드별·약점·큐레이션 진입점
[큐레이션] aiRoundCurationService   → Round 4+ 문제 선정(Zone A/B)
[채점]     gradingService          → 제출 답 채점·통계·Elo 반영
[대시보드] statsService            → 통계 조회·포맷팅
[관리]     adminService            → 관리자 회원/멤버십/통계
```
