# AIbT 문제 생성 로직 — AI-Gen Universal Framework

> **변리사 전달용 기술 발명 포인트 문서**  
> LLM의 환각·포맷 붕괴·논리적 불일치를 수학적/결정론적 알고리즘으로 원천 차단하는 객관식 문항 자동 생성·검수 파이프라인.

---

## 1. 시스템 개요

본 발명은 **LLM(거대 언어 모델)의 본질적 한계**인 다음 세 가지를 파이썬 기반의 **수학적/결정론적(Deterministic) 알고리즘**과 결합하여 원천 차단하는 B2B/B2C 교육용 문항 자동 생성 및 큐레이션 시스템입니다.

| 한계 | 대응 방식 |
|------|-----------|
| **환각(Hallucination)** | Pydantic CoT 강제화, Python Native Shuffling, 3-Tier Auditor |
| **포맷 붕괴** | JSON 스키마·Negative Constraints, Strict Index Validation |
| **논리적 불일치(Context Mismatch)** | 선지 타입 결정 → 꼬리말 작성 → 오답 기획 순차 통제, 부정 논리·해설 일치 검증 |

**실제 구현 경로**: SQLD가 첫 타자로 진행되었으며(`backend/Contents/SQLD_raw/`), 이를 기반으로 `backend/Contents/Default/`에 **범용(Universal)** 모듈이 제작·적용 중입니다.

---

## 2. 단계별 핵심 로직 및 코드 매핑

### Step 1. 지능형 블루프린트 및 출제 DNA 추출기 (Blueprint Extractor)

**기술 과제**: 맹목적인 페이지 분할 스캔 시 핵심 데이터 유실 및 토큰 한계(Context Window Limit) 극복.

| 적용 기술 | 구현 위치 | 상세 |
|-----------|------------|------|
| **TOC-Aware Semantic Parsing** | `Default/01_BluePrintExtracter.py` | PyMuPDF(fitz) `get_toc()`로 목차 추출 → 논리적 단원 인식 후 타겟팅 스캔 |
| **Map-Reduce 기반 데이터 압축** | `01_BluePrintExtracter.py` | `collections.Counter`로 hierarchy 빈도수 집계 → `summarize_dna_for_blueprint()`로 35,000자 이내 압축 → LLM에 전달 |
| **비동기 에러 방어** | `01_BluePrintExtracter.py` | `AsyncOpenAI` + `tenacity`(지수 백오프)로 API Rate Limit 시 자동 재시도, DNA 유실률 0% 목표 |

**SQLD 전용**: `SQLD_raw/SQLD_01_DNAextractor.py` — Zone A/B/C 구간별 차등 스텝(이론 10p, 모의고사 2p, 최빈출 1p) 타겟팅, `ALLOWED_TOPICS`·`ALLOWED_TYPES` 제약.

---

### Step 2. Pydantic CoT 기반 무결점 초안 대량 생산기 (Draft Generator)

**기술 과제**: 문맥 불일치(예: "작성하시오" 지문 + 단답형 선지), 정답 번호 엇갈림 방지.

| 적용 기술 | 구현 위치 | 상세 |
|-----------|------------|------|
| **Pydantic CoT (사고 과정 강제화)** | `Default/02_Generator.py` | `QuestionCoTDraft` 스키마: `step0_problem_concept_planning` → `step1_option_type` → `step2_question_ending` → `step3_trap_design` → `final_question_text` + `options_list` 순차 수행 |
| **Python Native Shuffling (인덱스 환각 방지)** | `02_Generator.py` | AI는 `is_correct`(True/False)만 생성. `random.shuffle(options_objects)` 후 인덱스로 `answer`·`wrong_feedback` 재할당 → **정답 인덱스 오류율 0%** |
| **적응형 컨텍스트 엔진** | `02_Generator.py` | `DOMAINS` 비어있으면 순수 이론/학술 모드, 채우면 실무 비즈니스 시나리오(쇼핑몰, 은행 등) 주입 |

**SQLD 전용**: `SQLD_raw/SQLD_02_A_InitialGenerator.py` — 도메인 리스트 기반 "Zombie Factory", `generate_question_zombie()` 루프, 5회 재시도.

**Negative Constraints (지엽 방지)**:  
- "작성하시오", "도출하시오" 등 주관식 어미 절대 금지  
- 이중 질문 금지, 지시는 지문 맨 마지막 1회만  
- `SQLD_plus01.py` 등: "단답형 금지", "테이블/코드 필수" 조건 강화

---

### Step 3. 3-Tier AI 현미경 검수 및 계층적 절삭기 (Auditor & Pruning)

**기술 과제**: 1.5배수 초안 중 유사 중복 제거, 치명적 오류 검수, 단원별 밸런스 유지 후 1.0배수로 정밀 절삭.

| 적용 기술 | 구현 위치 | 상세 |
|-----------|------------|------|
| **Char-Ngram TF-IDF 중복 제거** | (특허 명세) | scikit-learn, 글자 단위(Character n-gram) 코사인 유사도 85~90% 이상 도플갱어 문항 AI 호출 전 사전 폐기 |
| **Triage 및 자가 치유** | `SQLD_raw/SQLD_03_A_Auditor3Way.py` | Logic Master / Style Editor / Difficulty Judge 3인 합의제. S/A/B/F 등급, A/B급 시 `corrected_data`로 원본 덮어쓰기(FIX_REQUIRED) |
| **Strict Index Validation** | `SQLD_04_MetadataInjector.py` | `find_best_index_robust()` — 정답 텍스트 ↔ 선지 인덱스 매칭, 피드백 키와 정답 번호 2차 교차 검증 |
| **계층적 쿼터 절삭 (Stratified Pruning)** | (특허 명세) | 블루프린트 단원별 필수 할당량(예: 60%) 우선 방어, 잔여 수량만 감점제 퀄리티 점수로 경쟁 |

**3-Way Auditor 체크리스트** (SQLD_03_A_Auditor3Way.py):  
- Logic: 부정 질문("옳지 않은")과 정답 매칭, 해설·answer 일치, SQL 문법  
- Style: HTML 테이블 컬럼/셀 수 일치, 가독성, SQL 키워드 대문자  
- Difficulty: Oracle/SQL Server 문법 혼용 여부, 품격 유지

---

### Step 4 & 5. 수학적 메타데이터 주입 및 갭 분석기 (Metadata & Gap Analyzer)

**기술 과제**: AI 환각·비용 배제, 일관된 메타데이터 산출 및 결측치 모니터링.

| 적용 기술 | 구현 위치 | 상세 |
|-----------|------------|------|
| **Heuristic Metadata 주입** | `SQLD_04_MetadataInjector.py` | 지문 글자 수·HTML `<table>`·`<pre>` 유무 기반 `estimated_time_sec`·`difficulty_level`·`trap_score` 수학적 산출 |
| **Global Gap Analysis** | `SQLD_02_B_GapAnalyzer.py` | Topic별 10개 미만, Low/High 각 3개 미만 식별 → `missing_report.json` 발행 |
| **Sniper Reinforcer** | `SQLD_plus01.py` 등 | `missing_report` 기반 결손 단원/유형에만 타겟 프롬프트로 100% 목표 수량 복구 |

---

### Step 6 & 7. 핀셋 보강 및 비즈니스 퍼널 배정기 (Sniper & Funnel Allocator)

| 적용 기술 | 구현 위치 | 상세 |
|-----------|------------|------|
| **Sniper Reinforcer** | `SQLD_plus01.py` ~ `SQLD_plus04.py` | 결손 단원(윈도우 함수, 계층형 질의 등)에 대한 타겟 생성, Negative Constraints·Self-Correction |
| **비즈니스 퍼널 동적 배정** | `SQLD_05_FinalAssembler.py` | `pop_questions()` + `sort_key`·`filter_func` 다중 조건 정렬 |
| **R1 (신뢰 구축)** | `SQLD_05_FinalAssembler.py` | 난이도 2~3, trap_score ≤2, 깔끔한 문제 |
| **R2 (결제 유도)** | `SQLD_05_FinalAssembler.py` | 최신 30% + 함정(trap_score) 70% 쿼터 |
| **R3 (프리미엄)** | `SQLD_05_FinalAssembler.py` | 난이도 3~4, 최신출제·긴 지문 |
| **R4 (Pool)** | `SQLD_05_FinalAssembler.py` | 나머지 전체 풀 |

---

## 3. 핵심 특허 청구항 (기술 발명 포인트)

| 청구항 | 기술 내용 | 코드 근거 |
|--------|-----------|-----------|
| **[인덱스 동기화]** | LLM 텍스트 생성과 Python `random.shuffle()`·Set 교차 검증 결합으로 객관식 정답 인덱스 오류 0% 보장 | `02_Generator.py` options_list shuffle, `SQLD_04_MetadataInjector.py` find_best_index_robust |
| **[검증 및 교정]** | AI가 논리·형식 결함을 독립 변수(Boolean)로 판단하게 강제(CoV), 오류 시 부분 필드 자가 교정·원본 덮어쓰기 | `SQLD_03_A_Auditor3Way.py` S/A/B/F, corrected_data |
| **[계층적 서바이벌 절삭]** | 목표 출제 비율(Blueprint)과 개별 문항 AI 평가 점수 동시 연산, 특정 주제 멸종 방지·하위 데이터만 절삭 | `SQLD_02_B_GapAnalyzer`, `SQLD_05_FinalAssembler` pop_questions |
| **[휴리스틱 메타데이터 산출]** | AI 추론 없이 텍스트/HTML 구조 기반 가중치로 풀이 소요 시간·난이도 일관 부여 | `SQLD_04_MetadataInjector` base_time, difficulty_level |

---

## 4. 디렉터리 구조 (문제 생성 파이프라인)

```
backend/Contents/
├── Default/                          ← 범용(Universal) 프레임워크
│   ├── 01_BluePrintExtracter.py      Step 1: TOC-Aware DNA 추출, Map-Reduce 압축
│   ├── 02_Generator.py               Step 2: Pydantic CoT, Python Shuffle, Adaptive Context
│   └── 03_3TierAuditor.py            Step 3: (현재 02와 동일 — Auditor 분리 예정)
│
├── SQLD_raw/                         ← SQLD 첫 타자 (실전 검증 완료)
│   ├── SQLD_01_DNAextractor.py       Step 1: Zone A/B/C 타겟팅 DNA 추출
│   ├── SQLD_02_A_InitialGenerator.py Step 2: 도메인 기반 초안 생성
│   ├── SQLD_02_B_GapAnalyzer.py      Step 2.5: 결측치 분석, missing_report
│   ├── SQLD_02_C_SupplementGenerator.py
│   ├── SQLD_03_A_Auditor3Way.py      Step 3: 3-Way Auditor (Logic/Style/Difficulty)
│   ├── SQLD_03_B_typeClassifier.py, SQLD_03_C_MidCheck.py
│   ├── SQLD_03_D0_ReLabeling24to18.py, D1_TopicSupplement.py, D2_TypeSupplement.py
│   ├── SQLD_04_MetadataInjector.py   Step 4: Heuristic 메타데이터, 정답 인덱스 확정
│   ├── SQLD_04_B_TrendSimplifier.py
│   ├── SQLD_05_FinalAssembler.py     Step 5: R1~R4 퍼널 배정
│   ├── SQLD_plus01.py ~ plus04.py    Sniper: 결손 단원 타겟 보강
│   └── upload_sqld_to_firebase.py    Firebase 배포
│
└── BIGDATA_raw/                      ← 빅데이터분석기사 적용 (진행 중)
```

---

## 5. 관련 문서

| 문서 | 용도 |
|------|------|
| **본 문서** (AIBT_문제생성로직.md) | 변리사 전달용 기술 발명 포인트·코드 매핑 |
| **AIBT_마스터_리포트_예창패_요청사항.md** | 프론트엔드 큐레이션·정밀진단·데이터 흐름 |
| **AIBT_서비스_목적_플로우_비즈니스_사업계획.md** | 서비스 목적·비즈니스 모델 |

---

*본 문서는 [특허 출원용 기술 명세서] AI 기반 상용 등급 객관식 문항 자동화 및 무결점 검수 파이프라인(AI-Gen Universal Framework)과 `backend/Contents` 내 실제 Python 구현을 대응하여 작성되었습니다.*
