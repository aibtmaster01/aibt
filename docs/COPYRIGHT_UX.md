# 학습 콘텐츠 저작권 보호 — UI/UX 레이어

베타·실서비스 공통. 웹 브라우저에서 **스크린샷 촬영을 신뢰성 있게 감지하는 기능은 구현하지 않음** (오해 소지·기술 한계).

---

## 1. 적용 위치별 문구

| 위치 | 톤 | 문구 요약 |
|------|----|-----------|
| Quiz 상단 (모바일) | warning·compact | 기본 저작권 1행 + 무단 복제 금지 |
| Quiz 카드 하단 | warning | 기본 + 강화(이미지·상업 이용) + 법적 힌트 |
| Quiz 세션 1회 토스트 | neutral | 세션당 1회 짧은 안내 (`quizSessionIntro`) |
| Quiz 탭 이탈 토스트 | neutral | 「콘텐츠 외부 공유는 금지」(최소 120초 간격) |
| Quiz 이미지 확대 | — | 이미지·저작권 보호 한 줄 |
| Result 하단 박스 | soft | 학습용·외부 공유 제한 + 무단 복제 금지 |
| ExamList 하단 | soft | 보호 원칙 짧게 |
| 앱 전역 푸터 | soft | 푸터 스트립 (`CopyrightFooterStrip`, `/quiz` `/result` `/admin` 제외) |
| 로그인 후 1회 | 안내 카드 | `postLoginOnce` (계정당 localStorage 1회) |

문구 원문은 `src/constants/copyrightCopy.ts`에서 관리.

---

## 2. 공통 컴포넌트·훅 구조

| 모듈 | 역할 |
|------|------|
| `CopyrightNotice` | `variant`: inline \| banner \| toast, `tone`: soft \| warning, `context`: quiz \| result \| list \| footer |
| `ContentProtectionWrapper` | 문제 카드 내 영역 래핑, `select-none`, 워터마크 문자열, `useCopyrightGuard` 연동 |
| `useCopyrightGuard` | 대상 요소에 `selectstart`·`contextmenu` 완화 차단, `visibilitychange`·`window blur` 시 콜백(쿨다운) |
| `CopyrightFooterStrip` | 메인 컬럼 하단 전역 고지 |

---

## 3. 코드 변경 요약

- `src/constants/copyrightCopy.ts` — 문구 중앙화
- `src/components/copyright/*` — Notice, Wrapper, Footer, index
- `src/hooks/useCopyrightGuard.ts` — 보호 훅
- `src/pages/Quiz.tsx` — 배너, `ContentProtectionWrapper`, 워터마크, 플래시 토스트(신고 우선), 이미지 모달 문구
- `src/pages/Result.tsx`, `ExamList.tsx` — 인라인 고지
- `src/App.tsx` — 전역 푸터, 로그인 1회 카드

---

## 4. 웹 한계와 대체 수단

- **불가**: 스크린샷/OS 단축키 감지, 캡처 확실한 방지.
- **가능한 범위**: 정책 문구 반복 노출, 텍스트 선택·우클릭의 **완화적 제한**(우회 가능), 로그인 기반 식별 문자(유출 억제 심리), 탭 이탈 시 **정책 리마인더**(감시 아님).
- **미포함**: DevTools 감지(기본).

---

## 5. QA 체크리스트

- [ ] Quiz: 모바일 상단·카드 하단 고지 노출, 학습(버튼·스크롤) 가능
- [ ] Quiz: 세션 첫 로드 후 저작권 토스트 1회(같은 탭 재입력 시 세션 스토리지로 중복 없음)
- [ ] Quiz: 신고 토스트가 저작권 토스트보다 우선
- [ ] Quiz: 장시간 내 탭 이탈 시 리마인더 과다 없음(쿨다운)
- [ ] Quiz: 메모 입력(영역 밖) 정상
- [ ] Result·ExamList·전역 푸터 문구 노출, `/quiz`·`/result`에서 전역 푸터 없음
- [ ] 로그인 성공 후(동일 계정) 저작권 카드 1회만
- [ ] 이미지 확대 모달 하단 문구 확인

---

## 분류(요약 질문에 대한 답)

- **정책 vs UX**: 고지·경계는 **정책 UX 레이어**; 레이아웃·내비는 기존 UX 유지.
- **감시인가?** 아니오. 문구와 「다른 창/탭 전환 시 리마인더」는 **정책 인지** 목적이며 스크린샷 감지를 주장하지 않음.
