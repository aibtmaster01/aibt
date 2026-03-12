# 베타 로컬 제거 및 베타 실서버 단일화 정리

## 1. 현재 실서버(핀셋) vs 베타 실서버(AiBT) vs 베타 로컬

### 1.1 실서버 (핀셋, VITE_APP_BRAND ≠ 'AiBT')
| 구분 | 구현 상태 |
|------|-----------|
| 브랜드/랜딩 | 핀셋-MVP |
| 쿠폰 | 없음 (FEATURE_COUPON false) |
| 로그인 | 이메일+비밀번호 등 |
| 데이터 소스 | certifications (Firestore) |
| 인덱스 | certifications/{cert}/public/index (기존 인덱스) |
| 마이페이지 | MyPage (기본) |
| 오리엔테이션 | OrientationPopup, 난이도 선택 없음 |
| 진단 1~3회차 | 기존 80문항·숫자 round |
| 맞춤형 문항 수 | 고정 (40/80 선택 없음) |
| prepLevel / 초기 Elo | 없음 |
| 문제 신고 | 없음 |

### 1.2 베타 실서버 (AiBT 빌드, VITE_APP_BRAND='AiBT')
| 구분 | 구현 상태 |
|------|-----------|
| 브랜드/랜딩 | AiBT |
| 쿠폰 | BETATEST 등 쿠폰 입력 (FEATURE_COUPON 또는 AiBT) |
| 로그인 | 구글 로그인 위주 |
| 데이터 소스 | certifications (동일) |
| 인덱스 | BIGDATA: certifications/BIGDATA/public/index_leveled (레벨드) |
| 마이페이지 | MyPageBeta (예측 합격률, 3회 이상 시 등) |
| 오리엔테이션 | OrientationPopupBeta, **난이도 선택 먼저** → 쿠폰 |
| 진단 1~3회차 | 40문항, 레벨드 round (l_1, m_2, h_3), prepLevel 반영 |
| 맞춤형 문항 수 | 40(빠른) / 80(실전) 선택 |
| prepLevel / 초기 Elo | 저장·진단 Elo 보정 |
| 문제 신고 | Quiz 내 문제 신고 버튼 |

### 1.3 베타 로컬 (DEV + beta 플래그) — 제거 대상
| 구분 | 비고 |
|------|------|
| isBetaLocal | `import.meta.env.DEV && (FEATURE_COUPON \|\| APP_BRAND === 'AiBT')` 로만 true |
| 기능 | 베타 실서버와 동일하게 이미 useBetaCertifications로 통합됨 |
| 예외 | statsService의 orderBy 실패 시 fallback만 isBetaLocal 사용 → **DEV일 때만** fallback 하도록 변경 후 isBetaLocal 제거 |

---

## 2. 머지 방향 (베타 로컬 제거, 베타 실서버만 유지)

- **플래그 단일화**
  - `useBetaCertifications` = `APP_BRAND === 'AiBT'` 만 사용 (isBetaLocal 제거).
  - 베타 실서버 = AiBT 빌드. 로컬에서도 `.env.beta` 등으로 AiBT 빌드 시 동일 동작.
- **isBetaLocal 제거**
  - brand.ts에서 `isBetaLocal` 제거.
  - statsService의 orderBy fallback은 **개발 모드(import.meta.env.DEV)** 일 때만 동작하도록 변경.
- **주석/문서**
  - "베타 로컬" 표현 제거, "베타(AiBT 빌드)" 또는 "베타 실서버"로 통일.
- **getCertificationsCollection**
  - 계속 'certifications'만 반환 (변경 없음).
- **FEATURE_COUPON**
  - 유지. AiBT 빌드에서 쿠폰 노출 등에 함께 사용 가능.

---

## 3. 수정 파일 목록

| 파일 | 변경 내용 |
|------|-----------|
| src/config/brand.ts | isBetaLocal 제거, useBetaCertifications = (APP_BRAND === 'AiBT') |
| src/services/statsService.ts | isBetaLocal → import.meta.env.DEV (개발 시에만 orderBy fallback) |
| src/components/OrientationPopup.tsx | 주석 정리 (베타 로컬 → 베타) |
| src/components/OrientationPopup_beta.tsx | 주석 정리 |
| src/pages/MyPage_beta.tsx | 주석 정리 |
| 기타 | "베타 로컬" 주석만 있는 곳 문구 정리 |

---

## 4. 머지 후 동작 요약

- **AiBT 빌드(베타 실서버 또는 로컬 .env.beta)**  
  난이도 선택, MyPageBeta, 오리엔테이션 베타, 40/80 선택, 레벨드 진단, prepLevel/초기 Elo, 문제 신고 등 **기존 베타 기능 전부 유지**.
- **핀셋 빌드(실서버)**  
  기존과 동일. 쿠폰·prepLevel·베타 전용 UI 없음.
- **로컬 개발**  
  orderBy 실패 시 fallback은 `import.meta.env.DEV` 일 때만 실행 (인덱스 없을 때 개발 편의).
