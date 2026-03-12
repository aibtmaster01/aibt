# Firebase: certifications_beta → certifications 마이그레이션

> **목적**: 난이도별(레벨드) 인덱스·문항이 들어 있는 `certifications_beta/BIGDATA`의 **public**, **question_pools** 를 `certifications/BIGDATA` 로 복사.  
> **주의**: `certifications/BIGDATA/certification_info` 는 **그대로 두고** 덮어쓰지 않음.

---

## 1. 현재 구조

| 컬렉션 | BIGDATA 하위 | 용도 |
|--------|--------------|------|
| **certifications** | certification_info, public(구), question_pools(구) | 실서버·기존 인덱스/문항 |
| **certifications_beta** | public(index_leveled), question_pools(레벨드) | 베타용 난이도별 인덱스·문항 |

- 앱에서 `useBetaCertifications && certCode === 'BIGDATA'` 이면 **certifications_beta** 의 인덱스/문항 사용.
- **certification_info** 는 항상 `certifications/{certCode}/certification_info/config` 에서만 조회됨 (gradingService, adminService 등).

---

## 2. 마이그레이션 할 내용

- **복사할 경로 (source → target)**  
  - `certifications_beta/BIGDATA/public` → `certifications/BIGDATA/public`  
  - `certifications_beta/BIGDATA/question_pools` → `certifications/BIGDATA/question_pools`  
- **건드리지 않을 경로**  
  - `certifications/BIGDATA/certification_info` (시험일정·과목·합격기준 등 유지)

---

## 3. 실행 방법 (Firebase Console / 스크립트)

### 3.1 Firebase Console 수동

1. **Firestore** → `certifications_beta` → `BIGDATA` → `public`  
   - 문서들(예: `index_leveled` 등) 내용 복사.
2. **Firestore** → `certifications` → `BIGDATA`  
   - `public` (서브컬렉션 또는 문서) 없으면 생성 후, 1에서 복사한 내용으로 채움.  
   - 기존 `public` 이 있으면 **덮어쓰기** (레벨드 인덱스로 교체).
3. **certifications_beta/BIGDATA/question_pools** 하위 컬렉션/문서들을  
   **certifications/BIGDATA/question_pools** 로 동일 구조로 복사 (기존 question_pools 덮어쓰기).
4. `certifications/BIGDATA/certification_info` 는 열지 않음.

### 3.2 스크립트 (Node + Admin SDK)

- Admin SDK로 `certifications_beta/BIGDATA` 의 `public`, `question_pools` 를 읽어서  
  `certifications/BIGDATA` 에 같은 경로로 `set`/`merge` (certification_info 경로는 제외).  
- 대량 문서는 배치(500건 단위) 권장.

---

## 4. 마이그레이션 후

- **certifications** 에도 레벨드 인덱스·문항이 있으므로,  
  앱이 `certifications` 만 쓰는 경로(또는 이후 베타/실서버 통합 시)에서도 동일한 40문항·레벨드 회차(l_1, m_1, h_1 등)를 사용할 수 있음.
- **certification_info** 는 그대로이므로 시험일정·과목·합격기준 등은 변경 없음.

---

## 5. 문제 제공·합격률 규칙 (베타 기준, 검토 요약)

- **실력 확인 1~3회차**: 베타 BIGDATA는 **40문항** 고정. 레벨드 인덱스(l_1, m_1, h_1 등) 사용. prepLevel 없으면 intermediate(m) 기본. (코드: `examService.getQuestionsForRound` → `isBetaDiagnostic` 시 needCount=40.)
- **예측 합격률**: **실력진단 3회 이상** 응시 시에만 마이페이지에 표시. 3회 미만은 진행 카드(0/3~2/3)만 노출. (코드: `statsService.fetchUserTrendData` → `completedDiagnostics >= 3`, `DIAGNOSTIC_ROUND_ID_REGEX` 로 l/m/h_1,2,3 카운트.)
- **채점·스탯**: 40/80문항 동일하게 `gradingService`에서 과목별 점수·시그모이드 합격률·stats 갱신. 마이페이지는 `PASS_RATE_AND_SAFETY.md` §2·§3 수식 적용.
