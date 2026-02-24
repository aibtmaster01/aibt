#!/usr/bin/env python3
"""
upload_final_1260.py
- backend/BIGDATA/Final_1260.json (1260제) → Firestore BIGDATA 업로드
- question_pools: core_concept별 풀 (core_concepts_list.json으로 core_id → core_concept 매핑)
- static_exams: Round_1~5 (metadata.round 1~5별로 그룹, 각 최대 80문항)

실행: cd backend && python3 BIGDATA/upload_final_1260.py
필요: serviceAccountKey.json 또는 GOOGLE_APPLICATION_CREDENTIALS
"""

import os
import sys
import json
import random

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BIGDATA_DIR = os.path.dirname(os.path.abspath(__file__))
QUESTIONS_PATH = os.path.join(BIGDATA_DIR, "Final_1260.json")
CORE_CONCEPTS_PATH = os.path.join(BIGDATA_DIR, "core_concepts_list.json")

CERT_CODE = "BIGDATA"

SUBJECT_NAMES = {
    1: "빅데이터 분석 기획",
    2: "빅데이터 탐색",
    3: "빅데이터 모델링",
    4: "빅데이터 결과 해석",
}


def _load_core_concepts_ordered():
    if not os.path.exists(CORE_CONCEPTS_PATH):
        return []
    with open(CORE_CONCEPTS_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
    if isinstance(data, dict):
        return list(data.keys())
    return list(data) if isinstance(data, list) else []


def _safe_doc_id(s: str) -> str:
    if not isinstance(s, str):
        s = str(s)
    for c in "./[]*~":
        s = s.replace(c, "_")
    return s


def init_firebase():
    import firebase_admin
    from firebase_admin import credentials
    if firebase_admin._apps:
        return
    search_paths = [BASE_DIR, os.path.dirname(BASE_DIR)]
    target_names = ["serviceAccountKey.json", "aibt-99bc6-firebase-adminsdk.json"]
    cred_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    if cred_path and not os.path.exists(cred_path):
        cred_path = None
    if not cred_path:
        for p in search_paths:
            for n in target_names:
                fp = os.path.join(p, n)
                if os.path.exists(fp):
                    cred_path = fp
                    break
            if cred_path:
                break
    if not cred_path or not os.path.exists(cred_path):
        print("❌ 인증 키(serviceAccountKey.json)를 찾을 수 없습니다.")
        sys.exit(1)
    cred = credentials.Certificate(cred_path)
    firebase_admin.initialize_app(cred)
    print(f"✅ Firebase 연결: {cred_path}")


def delete_collection(db, coll_ref, batch_size=400):
    docs = list(coll_ref.limit(batch_size).stream())
    deleted = 0
    while docs:
        batch = db.batch()
        for doc in docs:
            batch.delete(doc.reference)
        batch.commit()
        deleted += len(docs)
        print(f"   - {deleted}개 문서 삭제 중...")
        docs = list(coll_ref.limit(batch_size).stream())
    return deleted


def wipe_existing_data(db):
    print("\n[Step 0] 기존 BIGDATA 데이터 완전 삭제...")
    static_ref = db.collection("certifications").document(CERT_CODE).collection("static_exams")
    delete_collection(db, static_ref)
    print("   => static_exams 삭제 완료")
    pools_ref = db.collection("certifications").document(CERT_CODE).collection("question_pools")
    total_questions_deleted = 0
    total_pools_deleted = 0
    pass_num = 0
    while True:
        pool_docs = list(pools_ref.stream())
        if not pool_docs:
            break
        pass_num += 1
        for pool_doc in pool_docs:
            q_ref = pool_doc.reference.collection("questions")
            total_questions_deleted += delete_collection(db, q_ref)
        BATCH_MAX = 500
        for i in range(0, len(pool_docs), BATCH_MAX):
            chunk = pool_docs[i : i + BATCH_MAX]
            batch = db.batch()
            for pool_doc in chunk:
                batch.delete(pool_doc.reference)
            batch.commit()
        total_pools_deleted += len(pool_docs)
        print(f"   => 패스 {pass_num} 완료: 풀 {len(pool_docs)}개 삭제")
    print(f"   => question_pools 총 {total_questions_deleted}개 문항 + {total_pools_deleted}개 풀 삭제 완료")


def item_to_firestore_doc(item: dict, core_concepts_list: list, round_val: int = 99) -> dict:
    meta = item.get("metadata", {})
    qc = item.get("question_content", {})
    stats = item.get("stats", {})
    subject_raw = meta.get("subject")
    if isinstance(subject_raw, int) and 1 <= subject_raw <= 4:
        subject_num = subject_raw
        hierarchy = SUBJECT_NAMES.get(subject_num, "기타")
    else:
        subject_num = 1
        hierarchy = str(subject_raw).strip() or "기타"
    core_id = meta.get("core_id")
    if isinstance(core_id, int) and 1 <= core_id <= len(core_concepts_list):
        core_concept = core_concepts_list[core_id - 1]
    else:
        core_concept = (meta.get("core_concept") or "").strip() or "공통 및 기타 개념"
    q_id = item.get("q_id", "") or meta.get("q_id", "")
    r = meta.get("round", round_val)
    options = qc.get("options", [])
    answer_idx = qc.get("answer_idx", 0)
    wrong_arr = qc.get("wrong_feedback", [])
    wrong_obj = {str(i + 1): v for i, v in enumerate(wrong_arr) if isinstance(v, str)}
    difficulty_raw = stats.get("difficulty", 0.5)
    difficulty_level = max(1, min(5, round(difficulty_raw * 5)))
    trap_score = stats.get("trap_score", 0) or 0
    problem_type = meta.get("problem_type", "")
    trend_val = stats.get("trend")
    estimated_sec = stats.get("estimated_time_sec")
    if not isinstance(estimated_sec, (int, float)) or estimated_sec <= 0:
        estimated_sec = 120
    table_data = qc.get("table_data")
    doc = {
        "cert_id": CERT_CODE,
        "q_id": q_id,
        "core_id": str(core_id) if core_id is not None else "",
        "core_concept": core_concept,
        "round": r,
        "question_text": qc.get("question_text", ""),
        "options": options,
        "answer": answer_idx + 1,
        "explanation": qc.get("explanation", ""),
        "wrong_feedback": wrong_obj if wrong_obj else None,
        "image": qc.get("image") if qc.get("image") else None,
        "hierarchy": hierarchy,
        "topic": f"BIGDATA > {hierarchy} > {problem_type}",
        "subject_number": subject_num,
        "tags": meta.get("tags", []),
        "problem_types": [problem_type] if problem_type else [],
        "difficulty_level": difficulty_level,
        "trap_score": trap_score,
        "estimated_time_sec": int(estimated_sec),
        "random_id": random.random(),
    }
    if trend_val is not None and (isinstance(trend_val, (int, float)) or isinstance(trend_val, str)):
        doc["trend"] = trend_val
    if table_data is not None:
        doc["table_data"] = table_data
    if stats and isinstance(stats, dict):
        doc["stats"] = {k: v for k, v in stats.items() if isinstance(v, (int, float))}
    return doc


def load_questions():
    if not os.path.exists(QUESTIONS_PATH):
        print(f"❌ 파일 없음: {QUESTIONS_PATH}")
        sys.exit(1)
    with open(QUESTIONS_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, list):
        print("❌ Final_1260.json 은 배열이어야 합니다.")
        sys.exit(1)
    return data


def upload_questions(db, all_items, core_concepts_list):
    pools_ref = db.collection("certifications").document(CERT_CODE).collection("question_pools")
    batch = db.batch()
    count = 0
    total = 0
    for item in all_items:
        doc_data = item_to_firestore_doc(item, core_concepts_list, round_val=99)
        core_concept = doc_data.get("core_concept", "공통 및 기타 개념")
        pool_id = _safe_doc_id(core_concept)
        q_id = _safe_doc_id(doc_data["q_id"])
        ref = pools_ref.document(pool_id).collection("questions").document(q_id)
        batch.set(ref, doc_data)
        count += 1
        if count >= 400:
            batch.commit()
            total += count
            print(f"   - {total}개 업로드 완료...")
            batch = db.batch()
            count = 0
    if count > 0:
        batch.commit()
        total += count
    print(f"   => question_pools 업로드 완료: {total}건")


DIFFICULTY_TARGET_BY_ROUND = {1: 0.50, 2: 0.59, 3: 0.65, 4: 0.74, 5: 0.74}
STATIC_TITLES = {
    1: "빅데이터분석기사 진단평가",
    2: "최신 기출 모의고사 2회",
    3: "고난이도 모의고사 3회",
    4: "맞춤형 모의고사 4회",
    5: "실전 불수능 모의고사 5회",
}


def create_static_exams(db, all_items, core_concepts_list):
    from google.cloud.firestore_v1 import SERVER_TIMESTAMP
    static_ref = db.collection("certifications").document(CERT_CODE).collection("static_exams")
    by_round = {1: [], 2: [], 3: [], 4: [], 5: []}
    for item in all_items:
        r = item.get("metadata", {}).get("round")
        if isinstance(r, int) and 1 <= r <= 5:
            by_round[r].append(item)
    for r in range(1, 6):
        items_r = by_round[r][:80]
        if len(items_r) == 0:
            print(f"   ⚠️ Round_{r}: metadata.round={r} 인 문항 없음, 건너뜀")
            continue
        refs = []
        for item in items_r:
            meta = item.get("metadata", {})
            stats = item.get("stats", {})
            q_id = _safe_doc_id(meta.get("q_id", "") or item.get("q_id", ""))
            subject_raw = meta.get("subject")
            subject_num = subject_raw if isinstance(subject_raw, int) and 1 <= subject_raw <= 4 else 1
            hierarchy = SUBJECT_NAMES.get(subject_num, "기타")
            core_id = meta.get("core_id")
            if isinstance(core_id, int) and 1 <= core_id <= len(core_concepts_list):
                core_concept = core_concepts_list[core_id - 1]
            else:
                core_concept = (meta.get("core_concept") or "").strip() or "공통 및 기타 개념"
            diff = stats.get("difficulty", 0.5)
            diff_lvl = max(1, min(5, round(diff * 5)))
            refs.append({
                "q_id": q_id,
                "difficulty_level": diff_lvl,
                "core_concept": core_concept,
                "hierarchy": _safe_doc_id(hierarchy),
                "core_id": str(core_id) if core_id is not None else "",
            })
        doc_data = {
            "cert_id": CERT_CODE,
            "round": r,
            "difficulty_target": DIFFICULTY_TARGET_BY_ROUND.get(r, 0.5),
            "question_refs": refs,
            "title": STATIC_TITLES.get(r, f"Round {r}"),
            "updated_at": SERVER_TIMESTAMP,
        }
        static_ref.document(f"Round_{r}").set(doc_data)
        print(f"   ✅ Round_{r} 생성 완료 ({len(refs)}문항)")


def main():
    print("=" * 60)
    print("🔥 BIGDATA 1260제 Firestore 업로드 (backend/BIGDATA/Final_1260.json)")
    print("=" * 60)
    print(f"데이터 경로: {QUESTIONS_PATH}")
    user_input = input("진행하시려면 'DELETE'를 입력하세요: ")
    if user_input != "DELETE":
        print("취소됨.")
        sys.exit(0)

    init_firebase()
    from firebase_admin import firestore
    db = firestore.client()

    core_concepts_list = _load_core_concepts_ordered()
    print(f"   core_concepts 로드: {len(core_concepts_list)}개")

    wipe_existing_data(db)
    items = load_questions()
    print(f"\n[Step 1] {len(items)}제 로드 완료")
    upload_questions(db, items, core_concepts_list)
    print("\n[Step 2] static_exams (Round_1~5) 생성...")
    create_static_exams(db, items, core_concepts_list)
    print("\n✨ 업로드 완료.")
    print("   ※ certification_info 갱신: python3 seed_certification_info.py BIGDATA")


if __name__ == "__main__":
    main()