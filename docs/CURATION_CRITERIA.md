# 학습자 문제 큐레이션 기준

모의고사/퀴즈에서 **어떤 정보를 보고** 문항을 선택하는지 정리합니다.

---

## 사용하는 정보 (문항 메타/통계)

| 정보 | 출처 | 용도 |
|------|------|------|
| **correctIds / wrongIds** | `exam_results` 답안 이력 | Zone A(틀린 문제·복습), Zone B(안 푼 문제·도전) 구분 |
| **trend** | 문항 메타 | 실전 대비형: trend 있는 문항 우선 (최신 경향) |
| **difficulty_level** | Firestore 문항 (1~5) | 실전 대비형: 난이도 ≥ 3 우선 |
| **subject_number** | 문항 메타 | 과목별 비율 준수 (certification_info.subjects.question_count) |
| **hierarchy** | 문항 메타 (1단계 분류) | 약점 강화: hierarchy별 proficiency 낮은 순으로 오답 문항 선택 |
| **tags** | 문항 메타 | 약점 강화: tag_stats에서 정답률 낮은 상위 3태그 → 해당 태그 문항 40% |
| **confused_qids** | users/stats/{certCode} | 약점 강화: 헷갈림 표시한 문항 30% |
| **proficiency** | hierarchy_stats, tag_stats | 약점 강화: proficiency 낮은 hierarchy부터 오답 문항 채움 |
| **stats** (Firestore) | difficulty, trap_score, comp_diff 등 | 추후 큐레이션용으로 저장됨 — 난이도/함정 강도/복합 난이도 기반 선별에 활용 예정 |

---

## 모드별 선택 기준

### 1. 실전 대비형 (REAL_EXAM, 8:2)
- **80%**: Zone B 중 **trend 있음 + difficulty_level ≥ 3**, 과목 비율에 맞춰 선택
- **20%**: Zone A(과거 오답) 중 랜덤 복습

### 2. 약점 강화형 (WEAKNESS_ATTACK, 3:3:4)
- **30%**: `confused_qids`에 있는 문항 (최근 헷갈림 순)
- **30%**: Zone A를 **hierarchy별 proficiency 낮은 순**으로 채움
- **40%**: **tag_stats**에서 정답률 하위 3태그의 Zone B 문항

### 3. Round 4 적응형 (plan 기반)
- `generateAdaptiveExamPlan`으로 hierarchy별 난이도·개수 계획 생성
- **plan** 조건(difficulty_level, hierarchy)에 맞춰 question_pools에서 문항 fetch
- Zone A/B 구분 유지, 부족분은 fallback으로 채움

### 4. 정규 Round 1~3
- **고정 세트**: static_exams/Round_N 의 `question_refs`(q_ids)로 고정 문항 로드 (큐레이션 없음)

---

## 추후 활용 (stats 저장 후)

Firestore 문항에 **stats** (difficulty, trap_score, comp_diff 등)가 저장되므로, 추후에는 다음처럼 활용할 수 있습니다.

- **difficulty**: 실전 대비 난이도 밸런스 (쉬움/보통/어려움 비율)
- **trap_score**: 함정 강도별 출제 비율
- **comp_diff**: 복합 난이도 기준 상/중/하 구간 선별

이 정보를 사용한 추가 큐레이션 로직은 `examService`의 `generateRealExamMode` / `generateWeaknessAttackMode` 또는 `aiRoundCurationService`에 확장하면 됩니다.
