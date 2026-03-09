# 베타 로컬 로직 정리

## 1. 실행해도 되나?

**예. 베타 로컬 실행 가능합니다.**

- 로컬에서 `npm run dev` 실행 시 **개발 모드(DEV)** 이고, 환경 변수로 `VITE_FEATURE_COUPON=true` 또는 `VITE_APP_BRAND=AiBT` 이면 **베타 로컬**로 동작합니다.
- 이때 인덱스/문항은 **Firebase `certifications_beta`** 에서만 가져오므로, 실서버 데이터와 분리되어 있습니다.
- **필수**: Firebase에 `certifications_beta/BIGDATA/public/index_leveled`(인덱스), `certifications_beta/BIGDATA/question_pools/contents_1681/questions/{q_id}`(문항)가 업로드되어 있어야 합니다. (`upload_leveled_contents_and_index.py` 실행 필요)

---

## 2. 플래그 정의 (`src/config/brand.ts`)

| 플래그 | 조건 | 용도 |
|--------|------|------|
| **isBetaLocal** | `import.meta.env.DEV` 이고 (`VITE_FEATURE_COUPON === 'true'` 또는 `VITE_APP_BRAND === 'AiBT'`) | 로컬 개발 전용 플로우: 레벨 선택·쿠폰 후 초기 Elo, 진단 제출 시 Elo 재조정 등 |
| **useBetaCertifications** | `isBetaLocal` **또는** `APP_BRAND === 'AiBT'` | **데이터 소스**: BIGDATA 인덱스/문항을 `certifications_beta`에서 조회할지 여부 (로컬 + 배포 베타 서버 공통) |

- **로컬 베타**: DEV + (쿠폰 또는 AiBT) → 두 플래그 모두 true.
- **배포 베타 서버** (예: AiBT 브랜드): `isBetaLocal` = false, `useBetaCertifications` = true → 인덱스/문항만 베타 Firebase, UI/플로우는 기존과 동일할 수 있음.

---

## 3. 베타 로컬에서의 데이터 소스 (Firebase)

**useBetaCertifications === true 이고 certCode === 'BIGDATA' 일 때만** 아래 경로 사용.

| 데이터 | 경로 |
|--------|------|
| 인덱스 (레벨드 l_1~h_3, 99) | Firestore `certifications_beta/BIGDATA/public/index_leveled` (문서 필드 `items`) |
| 문항 본문 | Firestore `certifications_beta/BIGDATA/question_pools/contents_1681/questions/{q_id}` |

- **동기화**: 앱 기동 시 `syncQuestionIndex('BIGDATA')` 호출 시, 베타면 위 Firestore 인덱스를 가져와 IndexedDB 키 `BIGDATA_beta`에 저장.
- **조회**: `getQuestionIndexFromCache('BIGDATA')` → 베타일 때는 `BIGDATA_beta` 캐시 반환. 문항 getDoc은 `getCertificationsCollection(certCode)` 로 `certifications_beta` 사용.

적용 위치:

- `localCacheDB.ts`: sync / getQuestionIndexFromCache / fetchBetaIndexFromFirestore
- `examService.ts`: fetchQuestionsFromPools (BIGDATA getDoc)
- `aiRoundCurationService.ts`: 문항 getDoc
- `adminQuestionService.ts`: 문항 doc ref

---

## 4. 진단 모의고사 (1~3회차, 레벨별 40문항)

- **조건**: `useBetaCertifications && round <= 3 && user?.prepLevel`
- **동작**:
  - 회차 키: `l_1` / `l_2` / `l_3` (초급), `m_1`~`m_3` (중급), `h_1`~`h_3` (고급)
  - 인덱스에서 `metadata.round === roundKey` 인 항목만 필터 후 **40문항** 선발.
  - 문항은 `certifications_beta` question_pools에서 getDoc.
  - `user_rounds` 저장 키도 `l_1` 등 문자열 사용.
- **UI**: `ExamList` 에서 `useBetaCertifications && certId === 'c1' && user?.prepLevel` 이면 회차 목록을 레벨별 1~3회차(40문항) + 6회차 이후 맞춤형으로 구성.

---

## 5. 맞춤형 모의고사 (4회차 이상)

- 인덱스: 위와 동일하게 `certifications_beta` 레벨드 인덱스(캐시 `BIGDATA_beta`).
- 문항: `getCertificationsCollection('BIGDATA')` → `certifications_beta` 에서 getDoc.
- **베타 전용 옵션**: `useBetaCertifications` 이면 4회차 이상 시작 시 **40문항(빠른 학습) / 80문항(실전 학습)** 선택 모달 노출 후, 선택한 문항 수로 `getQuestionsForRound(..., { questionCount })` 호출.

---

## 6. Elo / 레벨

- **쿠폰 등록 + 레벨 선택 후**: `isBetaLocal` 일 때만 `setInitialEloByPrepLevel(uid, 'c1', selectedLevel)` 호출 (초급 1000, 중급 1300, 고급 1600). → 로컬 개발 전용.
- **진단(l_1~h_3) 제출 후**: `useBetaCertifications && roundId가 l_1~h_3 && prepLevel` 일 때 `updateEloAfterDiagnostic` 호출 (adjustedElo = initialElo + (scorePercent - expectedScore) * 10). 그 외는 기존 `updateEloRating`. → 로컬 + 배포 베타(AiBT) 공통.

---

## 7. 플로우 요약

1. **앱 기동**  
   `syncQuestionIndex('BIGDATA')` → 베타면 `certifications_beta/.../index_leveled` 로드 후 `BIGDATA_beta` 캐시 저장.

2. **회차 목록**  
   베타 + c1 + prepLevel 있으면: 진단 1~3 (레벨별 40문항, l_1~h_3) + 6회차 이후 맞춤형.

3. **진단 1~3 선택**  
   `getQuestionsForRound(certId, round, user)` → roundKey(l_1 등)로 인덱스 필터, 40문항 id 선발 → `fetchQuestionsFromPools` 로 `certifications_beta`에서 문항 getDoc → `user_rounds/{roundKey}` 저장.

4. **맞춤형 4회차 이상 선택**  
   베타면 40/80 모달 → 선택 후 `getQuestionsForRound(..., { questionCount })` → 맞춤형 큐레이션(인덱스는 베타 캐시, 문항은 certifications_beta) → user_rounds 저장.

5. **제출**  
   진단 roundId(l_1~h_3)이고 `useBetaCertifications` 이면 Elo 진단용 재조정, 아니면 기존 Elo 로직.

---

## 8. 로컬에서 베타 로컬로 켜는 방법

- `.env` 또는 `.env.local` 예시:
  - `VITE_APP_BRAND=AiBT` 또는
  - `VITE_FEATURE_COUPON=true`
- 개발 서버: `npm run dev`
- Firebase에 레벨드 인덱스/문항을 `certifications_beta` 에 업로드해 두면, 위 플로우대로 베타 로컬 실행 가능합니다.
