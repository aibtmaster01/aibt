# 프로젝트 문서 인덱스 (docs)

> 다른 AI 에이전트나 개발자가 **파일 이름만이 아니라 역할·흐름**을 이해할 수 있도록 정리한 문서 목록입니다.  
> **실서버**(aibt-99bc6)와 **베타**(aibt-beta)는 동일 코드베이스이며, `VITE_APP_BRAND`·`VITE_FEATURE_COUPON` 등 환경변수로 구분합니다.  
> **베타 전용 기능**(강제 로그인·오티·쿠폰·난이도 선택·온보딩 상태 등)은 **실서버에 추후 구현 예정**으로, 실서버용 문서에는 "(추후 구현 예정)"으로 표기합니다.

---

## 0. AI/디자인용 통합 문서 (화면·기능·정책)

| 문서 | 내용 | 용도 |
|------|------|------|
| [화면정의서.md](./화면정의서.md) | **전체 화면 목록**: 랜딩·모의고사 목록·퀴즈·결과·대시보드·관리자 등. 각 화면의 정의·목적·필수 기능·주요 UI 요소. | AI 에이전트가 UI/와이어프레임을 생성할 때 참조. |
| [기능정의서.md](./기능정의서.md) | **기능별 상세**: 로그인/온보딩·회차 선택·큐레이션·채점·Elo·합격률·결제·관리자 등. 로직·데이터 흐름·화면 이동 경로. | AI가 로직·플로우를 재구현하거나 검증할 때 참조. |
| [회원정책.md](./회원정책.md) | **회원·등급·접근 제어·쿠폰·탈퇴** 등 회원 관련 정책 일괄. | 정책 기준 문서 및 AI용 스펙. |

위 세 문서는 **해당 문서만 있어도 AI가 최초부터 서비스를 스스로 제작할 수 있을 정도로 구체화**되어 있습니다.

---

## 1. 이 인덱스를 먼저 읽을 때

- **로직/코드 위치**: 각 문서는 "관련 파일"에 **파일 경로**와 **그 파일이 하는 일**(한 줄 요약)을 함께 적었습니다. 코드를 수정할 때는 해당 서비스/페이지 파일을 열어보면 됩니다.
- **베타 전용**: `BETA_` 접두사 문서는 베타 테스트 환경(강제 로그인, 쿠폰, 오리엔테이션)에 대한 설명입니다.
- **정책 vs 로직**: 정책 문서는 "무엇을 제공할지·누가 접근할지" 같은 비즈니스 규칙, 로직 문서는 "어떤 함수가 어떤 순서로 Firestore/인덱스를 다루는지" 구현 흐름입니다.

---

## 2. 정책 (비즈니스 규칙·플로우)

| 문서 | 내용 요약 | 다른 에이전트를 위한 설명 |
|------|-----------|----------------------------|
| [04_정책_유저플로우.md](./04_정책_유저플로우.md) | 서비스 목적, 사용자 여정, 라우트 정의. | **실서버 기준** 전체 플로우: 비로그인(무료 진단→20문항→로그인 유도), 로그인 무료(1·2회차만), 로그인 유료(전 회차+맞춤형). 라우트 `/`, `/mypage`, `/exam-list`, `/quiz`, `/result`, `/checkout`, `/admin` 등 정의. **베타 전용 플로우**(강제 로그인·오티·쿠폰)는 실서버에 추후 구현 예정. |
| [02_정책_결제.md](./02_정책_결제.md) | 결제·장학금·이용권 정책. | PG 연동, 회차별 이용권, 할인/환급 등 **Phase별 정책**. 실제 결제 연동은 Phase에 따라 미진행일 수 있음. |
| [03_정책_회원관리.md](./03_정책_회원관리.md) | 가입·탈퇴·접근 제어. | 등급(Guest/Free/Premium/Expired/Admin), 접근 제어, Firestore 경로. **회원정책.md**와 함께 참고. |
| [FINAL_POLICY_SUMMARY.md](./FINAL_POLICY_SUMMARY.md) | 정책 요약. | 위 정책 문서 요약. 빠르게 훑을 때 사용. |

---

## 3. 로직 (구현 흐름·코드 위치)

| 문서 | 내용 요약 | 다른 에이전트를 위한 설명 |
|------|-----------|----------------------------|
| [05_로직_모의고사큐레이션.md](./05_로직_모의고사큐레이션.md) | **고정형(1~3회차)과 맞춤형(라운드 99 풀) 문제 선정.** | **진입점**: `examService.getQuestionsForRound`. 고정형은 인덱스에서 `metadata.round === 1|2|3` 필터 후 과목·core_id 순으로 q_id 선정. **맞춤형**은 **인덱스의 라운드 99 풀만** 사용하며, `aiRoundCurationService.selectQuestionIdsBy3ZonesPerSubject`로 과목별 20문항(1구역 12 + 2구역 8), 동일 개념 중복 제한(MAX_PER_CORE_ID, MAX_PER_SUB_CORE_ID). UserRound 박제로 재응시 시 동일 문항 유지. **실제 구현**: `src/services/examService.ts`(진입·UserRound·Static), `src/services/aiRoundCurationService.ts`(라운드 99 선발·calcScore·제외 집합), `src/pages/ExamList.tsx`(회차 목록·준비 오버레이). |
| [06_로직_채점시학습자stats업데이트.md](./06_로직_채점시학습자stats업데이트.md) | 퀴즈 제출 후 exam_results·stats·Elo 갱신. | **진입점**: `gradingService.submitQuizResult`. 순서: 자격증 정보 로드 → 과목별 점수·합격 판정 → `users/{uid}/exam_results/{examId}` 저장 → **3차원 통계**(core_concept_stats, sub_core_id_stats, problem_type_stats, subject_stats, tag_stats) increment + proficiency(Elo) 갱신 → `users/{uid}/stats/{certCode}` 갱신. Lucky-Guess 보정(헷갈림 체크 시 20%만 반영). **실제 구현**: `src/services/gradingService.ts` 전반. 대시보드 연동은 `src/services/statsService.ts`의 fetchDashboardStats·calcSubjectTrend 등. |
| [07_로직_집중학습큐레이션.md](./07_로직_집중학습큐레이션.md) | 과목 강화·취약 유형·취약 개념 각 50문항 선정. | **진입**: 마이페이지 버튼 → 모드 선택 모달 → 5초 준비 오버레이 → 50문항 fetch 후 `/quiz`. **함수**: `examService.fetchSubjectStrengthTraining50`, `fetchWeakTypeFocus50`, `fetchWeakConceptFocus50`. 통계는 `users/{uid}/stats/{certCode}`의 problem_type_stats·core_concept_stats 등. **실제 구현**: `src/services/examService.ts`(위 3함수), `src/App.tsx`(pendingFocusTraining·5초 카운트·navigate), `src/pages/MyPage.tsx`(버튼·setPendingFocusTraining). |
| [08_로직_문제생성로직.md](./08_로직_문제생성로직.md) | AI 문제 생성 백엔드 파이프라인. | LLM·검수·Firestore 업로드 등 **백엔드** 쪽 문제 생성 흐름. 프론트엔드 큐레이션과는 별개. |
| [로직_모의고사큐레이션.md](./로직_모의고사큐레이션.md) | **(구버전)** | **현재는 사용하지 않음.** Zone A/B/Fallback·Round 6~20 구식 설명. **최신 내용은 05_로직_모의고사큐레이션.md를 참고하세요.** |

---

## 4. 베타 테스트 전용 (실서버에는 추후 구현 예정)

| 문서 | 내용 요약 | 다른 에이전트를 위한 설명 |
|------|-----------|----------------------------|
| [BETA_유저플로우.md](./BETA_유저플로우.md) | **베타**: 진입 → 로그인 → 쿠폰 → 오티 → 맞춤형 모의고사. | 강제 로그인·구글 전용·쿠폰 등록·오티(forced)·onboardingStatus 등. **실서버: 동일 플로우 추후 구현 예정.** |
| [BETA_CODE_REVIEW.md](./BETA_CODE_REVIEW.md) | 베타 관련 버그 수정·동작 확인·정책 질문. | 리다이렉트 복귀 시 OT만 띄우기, 베타에서 guestContinue 미복원, OT 쿠폰 등록 후 팝업 항상 닫기 등 **이미 반영된 수정**. 추가로 확인할 것: `/exam-list` 직접 접근 차단 여부, `.env.beta` 배포 보장, 실서버에 쿠폰만 켤 때 강제 로그인 범위. |
| [BETA_COUPON.md](./BETA_COUPON.md) | 쿠폰 컬렉션·정책·어드민. | Firestore **`coupons`** 컬렉션 사용(구 beta_coupons 폐기). 1회용·만료기일·자격증·유료기간(일). 사용 시 `users/{uid}.memberships` 갱신. **관련 코드**: `src/services/couponService.ts`(redeem·검증), `src/pages/AdminBilling.tsx`(쿠폰 목록·등록·폐기), `src/components/CouponModal.tsx`·`LoginModal.tsx`(쿠폰 입력 UI). |
| [BETA_FIREBASE_SETUP.md](./BETA_FIREBASE_SETUP.md) | 베타 사이트 Firebase 설정. | 호스팅은 **aibt-beta** 프로젝트, Auth·Firestore·Storage는 **aibt-99bc6** 공유. OAuth 허용 도메인에 `aibt-beta.web.app` 추가. **인덱스**: 베타는 Storage 대신 Firestore `certifications/BIGDATA/public/index` 에서 index 로드(CORS 불필요). |

---

## 5. 배포·운영·기타

| 문서 | 내용 요약 | 다른 에이전트를 위한 설명 |
|------|-----------|----------------------------|
| [DEPLOY_CHECKLIST.md](./DEPLOY_CHECKLIST.md) | Git → 로컬 확인 → 규칙 → 베타 배포 → 실서버 배포 순서. | **명령어**: `npm run build`(실서버 빌드), `npm run dev:beta`(로컬 베타), `npm run deploy:beta`(베타 호스팅), `npm run deploy:prod`(실서버 규칙+호스팅). Firestore 규칙은 aibt-99bc6에 배포. **문구(카피) 위치** 표: 로그인 문구·OT 슬라이드·쿠폰 안내 등이 **어느 컴포넌트 어느 줄 근처**에 있는지 참고(줄 번호는 변경 시 갱신 필요). |
| [00_GITIGNORE_목록.md](./00_GITIGNORE_목록.md) | .gitignore 패턴과 이유. | 로그·빌드·환경변수·비밀키·Python·대용량 데이터·에디터 제외 목록. 배포/협업 시 어떤 파일이 저장소에 없는지 확인용. |
| [01_투두리스트.md](./01_투두리스트.md) | 논의되었으나 미진행 항목. | 결제 Phase, 탈퇴 플로우, 인덱스 수동 생성, D+1 설문 등. "향후 진행 예정" 참고용. |
| [09_기타_오류코드대조표.md](./09_기타_오류코드대조표.md) | 표시용 오류 코드 ↔ 내부 코드. | `src/utils/errorCodes.ts`와 동기화. 사용자에게 보여줄 메시지와 내부 에러 매핑. |
| [10_기타_Firestore_인덱스_가이드.md](./10_기타_Firestore_인덱스_가이드.md) | q_id·복합 인덱스 에러 대응. | Firestore 콘솔에서 인덱스 생성 링크·배포 방법. collectionGroup 쿼리 시 필요. |
| [INDEX_AND_SUBCORE_CHECKLIST.md](./INDEX_AND_SUBCORE_CHECKLIST.md) | 인덱스·서브코어 점검. | 문제 풀 인덱스와 sub_core_id 등 메타데이터 일관성 점검 시 참고. |
| [FIREBASE_EMAIL_VERIFICATION_TEMPLATE.md](./FIREBASE_EMAIL_VERIFICATION_TEMPLATE.md) | 이메일 인증 메일 템플릿. | Firebase Auth 이메일 인증 시 사용하는 템플릿 내용. |
| [STORAGE_CORS_SETUP.md](./STORAGE_CORS_SETUP.md) | Storage CORS 설정. | 베타는 Firestore index만 써도 되므로 참고용. Storage 직접 접근 시 Google Cloud Console에서 CORS 설정. |
| [ADMIN_ACCOUNT_RESTORE.md](./ADMIN_ACCOUNT_RESTORE.md) | 관리자 계정 복구. | Admin 권한 복구 절차. |
| [APP_REFACTOR_PLAN.md](./APP_REFACTOR_PLAN.md) | 앱 리팩터 계획. | 구조 개선·분리 계획(참고용). |

---

## 6. 외부 검토·기술 구조

| 문서 | 내용 요약 | 다른 에이전트를 위한 설명 |
|------|-----------|----------------------------|
| [외부검토용_기술구조_가이드.md](./외부검토용_기술구조_가이드.md) | 기술 검토자용 한눈에 보는 구조. | **데이터 흐름**: 문제 생성(백엔드) → Firestore 저장 → 큐레이션(aiRoundCurationService·examService) → 채점(gradingService) → 대시보드(MyPage·statsService). **파일별 역할**을 줄 수·핵심 내용으로 표로 정리. 알고리즘 요약(1구역+2구역, Elo) 포함. |

---

## 7. 문서-소스 매핑 (빠른 참조)

| 관심 주제 | 우선 읽을 문서 | 구현 위치(파일 역할) |
|-----------|----------------|----------------------|
| 맞춤형 모의고사 문항 선정 | 05_로직_모의고사큐레이션 | examService: 진입·UserRound·Static. aiRoundCurationService: 라운드 99 풀·과목별 20문항·제외 집합·calcScore. ExamList: 회차 UI·5초 오버레이. |
| 채점 후 스탯/Elo 갱신 | 06_로직_채점시학습자stats업데이트 | gradingService: submitQuizResult·3차원 통계·proficiency·exam_results 저장. statsService: 대시보드용 조회·포맷. |
| 집중학습 50문항 | 07_로직_집중학습큐레이션 | examService: fetchSubjectStrengthTraining50·fetchWeakTypeFocus50·fetchWeakConceptFocus50. App: 모달·5초·navigate. MyPage: 버튼. |
| 베타 로그인·쿠폰·OT | BETA_유저플로우, BETA_CODE_REVIEW, BETA_COUPON | App: isBeta·로그인 모달·OT 강제·hasCoupon. LoginModal: 구글·쿠폰 단계·재로그인 시 쿠폰 스킵. OrientationPopup: 5페이지 쿠폰. couponService: redeem. |
| 배포·빌드 | DEPLOY_CHECKLIST | package.json scripts: build, build:beta, deploy, deploy:beta, deploy:prod. firebase use default/beta. |
| 전체 라우트·플로우 | 04_정책_유저플로우 | App.tsx 라우팅, MyPage·ExamList·Quiz·Result·Checkout 페이지 역할. |

---

*문서 수정 시 이 README의 "내용 요약"·"다른 에이전트를 위한 설명"도 함께 갱신하면, 다른 에이전트가 문맥 없이도 docs만으로 방향을 잡을 수 있습니다.*
