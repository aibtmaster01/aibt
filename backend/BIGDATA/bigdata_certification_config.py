#!/usr/bin/env python3
"""
bigdata_certification_config.py
- backend/BIGDATA 폴더 기준 자격증 정보 (core_concepts_list.json 동일 폴더)
- Firestore certifications/BIGDATA/certification_info/config 시드 시 사용
"""
import os
import json

_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
_CORE_CONCEPTS_PATH = os.path.join(_THIS_DIR, "core_concepts_list.json")

BIGDATA_PROBLEM_TYPES = ["개념 암기형", "개념 비교형", "상황 적응형", "절차 숙지형", "계산 풀이형"]

BIGDATA_PROBLEM_TYPE_DESCRIPTIONS = {
    "개념 암기형": "핵심 정의와 주요 특징의 단순 암기",
    "개념 비교형": "유사 기법 간 차이점 및 원리 대조",
    "상황 적응형": "비즈니스 사례에 적합한 기법 선택",
    "절차 숙지형": "분석 단계별 수행 순서와 과업 이해",
    "계산 풀이형": "통계 공식을 활용한 수치 결과 산출",
}


def _load_core_concepts_raw():
    """core_concepts_list.json 로드.
    - 반환: (id 순서 리스트, core_concepts_by_id, core_concept_keywords)
    - core_concepts_list.json 형식: {"1": {"concept": "개념명", "keywords": ["키워드1", ...]}, ...}
    """
    if not os.path.exists(_CORE_CONCEPTS_PATH):
        raise FileNotFoundError(f"core_concepts_list.json 없음: {_CORE_CONCEPTS_PATH}")
    with open(_CORE_CONCEPTS_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
    if isinstance(data, list):
        return data, {}, {}
    if isinstance(data, dict):
        ids = sorted(data.keys(), key=lambda k: int(k) if str(k).isdigit() else 0)
        # id → { concept, keywords } (프론트 취약 개념 "개념79" → 개념명·키워드 표시용)
        by_id = {}
        # 개념명 → 키워드[] (core_concept_stats 키가 개념명일 때 태그 표시용)
        by_concept_name = {}
        for k, v in data.items():
            if isinstance(v, dict) and "concept" in v:
                concept = v.get("concept") or ""
                keywords = v.get("keywords")
                if isinstance(keywords, list):
                    by_id[k] = {"concept": concept, "keywords": keywords}
                    by_concept_name[concept] = keywords
        return ids, by_id, by_concept_name
    raise ValueError("core_concepts_list.json 은 배열 또는 객체(id→{concept, keywords})이어야 합니다.")


BIGDATA_EXAM_NAME = "빅데이터분석기사 필기"

BIGDATA_EXAM_SCHEDULES = [
    {"year": 2026, "round": 12,  "examDate": "2026-04-04", "resultAnnouncementDate": "2026-04-24"},
    {"year": 2026, "round": 13,  "examDate": "2026-09-05", "resultAnnouncementDate": "2026-09-23"},
]


def get_bigdata_config() -> dict:
    """BIGDATA certification_info config (core_concepts_list.json 기반).
    - core_concept_keywords: 개념명 → 키워드[] (취약 개념 카드에서 개념명으로 태그 조회)
    - core_concepts_by_id: id "1"~"80" → { concept, keywords } (취약 개념 "개념79" → 개념명·키워드 표시)
    """
    core_concepts_ids, core_concepts_by_id, core_concept_keywords = _load_core_concepts_raw()
    config = {
        "exam_config": {
            "total_questions": 80,
            "time_limit_min": 120,
            "pass_criteria": {
                "average_score": 60,
                "min_subject_score": 40,
            },
        },
        "subjects": [
            {"subject_number": 1, "name": "빅데이터 분석기획", "question_count": 20, "score_per_question": 5},
            {"subject_number": 2, "name": "빅데이터 탐색", "question_count": 20, "score_per_question": 5},
            {"subject_number": 3, "name": "빅데이터 모델링", "question_count": 20, "score_per_question": 5},
            {"subject_number": 4, "name": "빅데이터 결과 해석", "question_count": 20, "score_per_question": 5},
        ],
        "core_concepts": core_concepts_ids,
        "core_concepts_order": core_concepts_ids,
        "problem_type_list": BIGDATA_PROBLEM_TYPES,
        "problem_type_descriptions": BIGDATA_PROBLEM_TYPE_DESCRIPTIONS,
        "exam_name": BIGDATA_EXAM_NAME,
        "exam_schedules": BIGDATA_EXAM_SCHEDULES,
    }
    if core_concept_keywords:
        config["core_concept_keywords"] = core_concept_keywords
    if core_concepts_by_id:
        config["core_concepts_by_id"] = core_concepts_by_id
    return config
