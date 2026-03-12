# 베타 실서버 배포 전 최종 검토 (npm run deploy:beta)

> `npm run deploy:beta` 실행 전 꼼꼼히 확인할 항목과, 배포 시 적용되는 내용 정리.

---

## 1. deploy:beta 시 적용되는 것

- **빌드**: `vite build --mode beta` → `.env.beta` 로드 (VITE_APP_BRAND=AiBT, VITE_FEATURE_COUPON=true).
- **결과**: `dist/` 에 AiBT 브랜드로 번들된 정적 파일 생성.
- **배포**: `firebase use beta` 후 `firebase deploy --only hosting` → **베타 Firebase 프로젝트의 Hosting**에만 배포 (Firestore 규칙/인덱스는 별도 배포).

즉, **현재 로컬에서 쓰는 AiBT·베타 기능이 베타 실서버 호스팅에 그대로 올라갑니다.**  
**업데이트**: 베타 로컬 구분 제거. AiBT 빌드 시 난이도 선택·MyPageBeta·오리엔테이션 베타·certifications 등 모든 베타 기능이 베타 실서버에 적용됩니다.

---

## 2. 베타(AiBT) 빌드 동작 (로컬 dev:beta = 배포 deploy:beta 동일)

| 항목 | 베타 로컬 (npm run dev:beta) | 베타 실서버 (deploy:beta 후) |
|------|------------------------------|------------------------------|
| `useBetaCertifications` | true (APP_BRAND=AiBT) | true (APP_BRAND=AiBT) |
| 마이페이지 | **MyPageBeta** | **MyPageBeta** |
| 오리엔테이션 | **OrientationPopupBeta** (난이도 먼저, 쿠폰) | **OrientationPopupBeta** |
| 인덱스/문항 | **certifications** | **certifications** |
| statsService orderBy 실패 시 fallback | 개발 모드(DEV)일 때만 | 없음 (production 빌드) |

→ **로컬 dev:beta와 베타 실서버가 동일한 기능으로 동작합니다.**

---

## 3. 배포 전 체크리스트 (보수적 검토)

### 3.1 필수 (하지 않으면 오류 가능)

- [ ] **`.env.beta` 존재**  
  - 내용: `VITE_APP_BRAND=AiBT`, `VITE_FEATURE_COUPON=true` (또는 동일 효과).
  - 없으면 빌드가 AiBT가 아니라 기본 브랜드로 될 수 있음.
- [ ] **`npm run build:beta` 로컬에서 성공**  
  - 터미널에서 한 번 실행해 보기. 실패 시 deploy:beta 도 동일하게 실패.
- [ ] **Firebase 프로젝트 `beta` 등록**  
  - `firebase use beta` 가 실패하지 않도록, `firebase projects:list` 등으로 beta 프로젝트 확인.
- [ ] **`certifications_beta` (BIGDATA)**  
  - 베타 실서버 Firestore에 레벨드 인덱스·문항이 업로드되어 있어야 함. 없으면 진단/맞춤형 문제 로드 시 빈 화면 또는 오류 가능.
- [ ] **Firestore 규칙**  
  - `deploy:beta` 는 **hosting 만** 배포. 규칙/인덱스 변경이 필요하면 `firebase deploy --only firestore:rules` (또는 indexes) 별도 실행.

### 3.2 권장 (배포 후 확인)

- [ ] 베타 호스팅 URL 접속 후 로그인 → 마이페이지·시험 목록이 정상 노출되는지.
- [ ] BIGDATA 선택 후 진단(1~3회차) 또는 맞춤형 모의고사 진입 시 문항이 로드되는지.
- [ ] (선택) Firestore 콘솔에서 `certifications_beta/BIGDATA/...` 문서 존재 여부 확인.

### 3.3 코드 측 수정 반영 (이번 검토에서 적용된 것)

- **`useBetaCertifications`**  
  - 이전: `useBetaCertifications = isBetaLocal` 만 사용 → 베타 빌드(DEV=false)에서 항상 false.  
  - **수정**: `useBetaCertifications = isBetaLocal || APP_BRAND === 'AiBT'`  
  - 이제 **베타 빌드(AiBT)** 에서도 `certifications_beta` 사용·진단/맞춤형 로직이 동작함.

---

## 4. “학습 이력 초기화” 요구사항 (추가)

- **상황**: 학습 이력이 있는 학습자(A·B)가 **“새로운 진단 시작하기”** 를 누를 때 (베타 2.0 업데이트 안내 팝업 구현 후).
- **요구**: **쿠폰 정보를 제외한 학습 이력을 초기화**해 주기.
  - 유지: 쿠폰/유료 전환 정보 (paidCertIds, isPremium, usedBetatestCoupon, prepLevel 등).
  - 초기화: 해당 자격증(BIGDATA)에 대한  
    - `users/{uid}/exam_results` (해당 cert 관련만 삭제 또는 전부 삭제 후 유지할 건 유지),  
    - `users/{uid}/stats/{certCode}` (BIGDATA 등 해당 certCode 문서 삭제 또는 필드 초기화).
- **구현 시점**: 베타 2.0 업데이트 안내 모달 + “새로운 진단 시작하기” 버튼 플로우 구현 시, 버튼 클릭 시 위 초기화 API/함수 호출 후 → 난이도 선택 → 오티 → 응원 문구 순으로 진행.

자세한 플로우는 `docs/BETA_2.0_RELEASE_AND_DEPLOY_PLAN.md` 참고.

---

## 5. 요약

- **`npm run deploy:beta` 한 번에 하는 일**:  
  `build:beta` (AiBT 빌드) → `firebase use beta` → `firebase deploy --only hosting`
- **준비됐는지 확인**:  
  `.env.beta` 있는지, `build:beta` 성공하는지, Firebase beta 프로젝트·certifications_beta 데이터 있는지 확인 후 배포.
- **배포 후**:  
  베타 URL에서 로그인 → 마이페이지·진단/맞춤형 진입이 정상인지 한 번씩 확인하면 됩니다.
- **“새로운 진단 시작하기” 시 학습 이력 초기화(쿠폰 제외)** 는 베타 2.0 안내 팝업 구현 시 함께 넣으면 됩니다.
