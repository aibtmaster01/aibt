# 모바일 모달·시트 UI 기준 (AiBT)

## 셸 3종

| 셸 | 용도 | 특징 |
|----|------|------|
| **default** | exam-list, mypage, account-settings, admin | `MobileHeader` + 스크롤 본문 + (조건부) 하단 탭 |
| **immersive** | quiz, result | 본문 `overflow-hidden` 위주, 퀴즈는 자체 상단 바로 앱 헤더 숨김 |
| **modal shell** | login, checkout, 오리엔테이션, 인증 재발송 등 전역 오버레이 | `suppressChrome`: 앱 헤더·하단 탭 제거 → 뒤 페이지와 오버레이의 **이중 크롬 방지** |

우선순위(`getPrimaryMobileGlobalOverlay`): orientation → login → checkout → verification → signup_success.

## Full-screen vs bottom sheet

| 유형 | 권장 패턴 | 예시 |
|------|-----------|------|
| **Full-screen (또는 전면 고정 레이어)** | 단계가 많거나 폼·약관·소셜 로그인 전체 너비가 필요할 때 | `LoginModal`, `OrientationPopup`, 결제 플로우 전체 |
| **Bottom sheet** | 선택지 2~4개, 짧은 확인, 필터 | 시험/학습 모드 선택, 간단 확인 (“이어서 진행”) |
| **중앙 소형 다이얼로그 (유지)** | 데스크톱과 동일 토큰, 모바일에서만 `max-h-[90dvh]` + 스크롤 | 토스트급이 아닌 짧은 알림 |

## 중첩 방지 원칙

1. **한 시점에 primary 전역 오버레이는 하나** — `shellPolicy`의 `getPrimaryMobileGlobalOverlay` 기준.
2. 시트는 `MobileSheetHost` **슬롯 1개**만 사용해 `modal + sheet` 이중 스택을 피한다.
3. z-index는 `MOBILE_Z_INDEX`를 참고해 drawer(90) < sheet(95) < 일반 모달(100) < 상위 모달(110~120).
4. 새 플로우 추가 시: 기존 모달을 닫거나, 동일 레이어에서 단계 전환(Replace)한다.

## 후속 작업(선택)

- `LoginModal` / 결제 래퍼에 `max-md:rounded-t-2xl max-md:min-h-[50dvh]` 등으로 시트형 변환 검토.
- 포커스 트랩·`aria-modal`은 전역 오버레이 컴포넌트별로 정렬.
