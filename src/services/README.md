# Services

프론트엔드 비즈니스 로직·API·Firestore 연동 서비스.

---

## 서비스 목록

| 파일 | 목적 |
|------|------|
| [authService.ts](./authService.ts) | **인증·회원** — 로그인/회원가입/로그아웃, 비밀번호 변경·재설정, 기기 수 제한(MAX_DEVICES). Firebase Auth + Firestore `users` 연동, 멤버십 → subscriptions/paidCertIds/expiredCertIds 변환. |

| [adminService.ts](./adminService.ts) | **관리자** — Firestore `admin_users`, `memberships` 조회·동기화, 회원 목록/상세, 비밀번호 재설정 메일, 퀴즈 완료 데이터(`exam_results`) 기준 통계 등. (Admin SDK 없이 Firestore만 사용) |

| [gradingService.ts](./gradingService.ts) | **채점·통계** — 퀴즈 제출 시 `certification_info` 기반 과목별 점수·합격 판정, `exam_results` 저장, `users/{uid}/stats/{certCode}`의 core_concept/problem_type/subject 3차원 통계(increment, confused 포함), Elo 업데이트. 레이더/과목 통계 조회. |

| [examService.ts](./examService.ts) | **시험 문제 조회** — 1~3회차: 고정(round 1,2,3). 맞춤형: aiRoundCurationService 호출(**라운드 99 풀** 사용, stats 기반·실전 대비형/약점 강화형). 회원 등급별 마스킹, 약점 다시풀기(stats.problem_type_stats). |

| [aiRoundCurationService.ts](./aiRoundCurationService.ts) | **맞춤형 큐레이션(라운드 99)** — 인덱스 **라운드 99** 풀에서 4과목×20문항(`selectQuestionIdsBy3ZonesPerSubject`). 과목별 `selectForSubject`: 1구역 12 + 2구역 8, 동일 개념 중복 제한(MAX_PER_CORE_ID/MAX_PER_SUB_CORE_ID). `getAnalysisContext`·`getTopWeakTags`는 stats 기반. |

| [statsService.ts](./statsService.ts) | **대시보드 통계** — `users/{uid}/stats/{certCode}` 및 `exam_results` 조회 후 UI용 포맷 변환(레이더, 과목별 점수, 약점 Top2, 최근 시험 트렌드 등). |

---

## 데이터 흐름 요약

```
[인증]     authService        → 로그인/회원·멤버십
[문제 선정] examService        → 라운드별·약점·큐레이션 진입점
[큐레이션] aiRoundCurationService → 라운드 99 풀에서 4과목×20문항 선정(커버리지·약점 구역, 개념 중복 제한, 제외 윈도우)
[채점]     gradingService     → 제출 답 채점·통계·Elo 반영
[대시보드] statsService       → 통계 조회·포맷팅
[관리]     adminService       → 관리자 회원/멤버십/통계
```
