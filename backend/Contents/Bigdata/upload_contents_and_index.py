#!/usr/bin/env python3
"""
upload_contents_and_index.py
- Bigdata_contents_1681.json 각 항목 → Firestore certifications/BIGDATA/question_pools/{pool_id}/questions/{q_id}
- 문항의 q_id를 Firestore 문서 ID로 사용
- 같은 경로의 Index.json(또는 Bigdata_Index.json) → Firebase Storage /assets/BIGDATA/index.json 업로드

실행: cd backend && python3 Contents/Bigdata/upload_contents_and_index.py
필요: serviceAccountKey.json 또는 GOOGLE_APPLICATION_CREDENTIALS (Storage 권한 포함)
"""

import os
import sys
import json
import random
from typing import Optional

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
# backend/ (스크립트가 Contents/Bigdata/ 안에 있으므로 상위 두 단계)
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

CONTENTS_PATH = os.path.join(SCRIPT_DIR, "Bigdata_contents_1681.json")
INDEX_PATH = os.path.join(SCRIPT_DIR, "Bigdata_Index.json")
INDEX_ALT_PATH = os.path.join(SCRIPT_DIR, "Index.json")

# Firestore: certifications/BIGDATA/question_pools/{POOL_ID}/questions/{q_id}
CERT_CODE = "BIGDATA"
POOL_ID = "contents_1681"

SUBJECT_NAMES = {
    1: "빅데이터 분석 기획",
    2: "빅데이터 탐색",
    3: "빅데이터 모델링",
    4: "빅데이터 결과 해석",
}


def _safe_doc_id(s: str) -> str:
    if not isinstance(s, str):
        s = str(s)
    for c in "./[]*~":
        s = s.replace(c, "_")
    return s


def _load_core_concepts_ordered():
    """BIGDATA/core_concepts_list.json에서 개념 목록(순서) 로드. 없으면 빈 리스트.
    새 형식: {"1": {"concept": "...", "keywords": [...]}, "2": ...} → 인덱스 0 = 개념1 이름.
    """
    path = os.path.join(BASE_DIR, "BIGDATA", "core_concepts_list.json")
    if not os.path.exists(path):
        return []
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    if isinstance(data, dict):
        items = sorted(
            [(k, v) for k, v in data.items() if isinstance(v, dict) and "concept" in v],
            key=lambda x: int(x[0]) if str(x[0]).isdigit() else 0,
        )
        if items:
            return [v.get("concept", "") for _k, v in items]
        # 레거시: 키만 있는 경우 (키가 개념명)
        return list(data.keys())
    return list(data) if isinstance(data, list) else []


def init_firebase():
    import firebase_admin
    from firebase_admin import credentials
    if getattr(firebase_admin, "_apps", None) and firebase_admin._apps:
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
    # Storage 업로드 시 bucket() 사용을 위해 storageBucket 지정 (프론트와 동일)
    firebase_admin.initialize_app(cred, {"storageBucket": "aibt-99bc6.firebasestorage.app"})
    print(f"✅ Firebase 연결: {cred_path}")


def build_question_doc(q_id: str, content: dict, index_entry: Optional[dict], core_concepts_list: list) -> dict:
    """한 문항에 대한 Firestore 문서 생성. 문서 ID는 q_id 사용. hierarchy 미사용, core_concept만 사용."""
    qc = content
    meta = (index_entry.get("metadata", {}) if index_entry else {}) or {}
    stats = (index_entry.get("stats", {}) if index_entry else {}) or {}

    subject_raw = meta.get("subject")
    if isinstance(subject_raw, int) and 1 <= subject_raw <= 4:
        subject_num = subject_raw
    else:
        subject_num = 1

    core_id = meta.get("core_id")
    if isinstance(core_id, int) and 1 <= core_id <= len(core_concepts_list):
        core_concept = core_concepts_list[core_id - 1]
    else:
        core_concept = (meta.get("core_concept") or "").strip() or "공통 및 기타 개념"

    options = qc.get("options", [])
    answer_idx = qc.get("answer_idx", 0)
    wrong_arr = qc.get("wrong_feedback", [])
    wrong_obj = {str(i + 1): v for i, v in enumerate(wrong_arr) if isinstance(v, str)}
    difficulty_raw = stats.get("difficulty", 0.5)
    difficulty_level = max(1, min(5, round(difficulty_raw * 5)))
    trap_score = stats.get("trap_score", 0) or 0
    problem_type = (meta.get("problem_type") or "").strip()
    trend_val = stats.get("trend")
    estimated_sec = stats.get("estimated_time_sec")
    if not isinstance(estimated_sec, (int, float)) or estimated_sec <= 0:
        estimated_sec = 120
    table_data = qc.get("table_data")

    sub_core_id = meta.get("sub_core_id")
    sub_core_id = sub_core_id.strip() if isinstance(sub_core_id, str) else ""

    doc = {
        "cert_id": CERT_CODE,
        "q_id": q_id,
        "core_id": str(core_id) if core_id is not None else "",
        "core_concept": core_concept,
        "round": meta.get("round", 99),
        "question_text": qc.get("question_text", ""),
        "options": options,
        "answer": answer_idx + 1,
        "explanation": qc.get("explanation", ""),
        "wrong_feedback": wrong_obj if wrong_obj else None,
        "image": qc.get("image") if qc.get("image") else None,
        "topic": f"BIGDATA > {core_concept} > {problem_type}",
        "subject_number": subject_num,
        "tags": meta.get("tags", []) or [],
        "problem_types": [problem_type] if problem_type else [],
        "difficulty_level": difficulty_level,
        "trap_score": trap_score,
        "estimated_time_sec": int(estimated_sec),
        "random_id": random.randint(0, 1_000_000),
    }
    if trend_val is not None and (isinstance(trend_val, (int, float)) or isinstance(trend_val, str)):
        doc["trend"] = trend_val
    if table_data is not None:
        doc["table_data"] = table_data
    if stats and isinstance(stats, dict):
        doc["stats"] = {k: v for k, v in stats.items() if isinstance(v, (int, float))}
    if sub_core_id:
        doc["sub_core_id"] = sub_core_id
    return doc


def load_contents_and_index():
    """Bigdata_contents_1681.json + (선택) Bigdata_Index.json / Index.json 로드. 반환: (contents dict, index list)."""
    if not os.path.exists(CONTENTS_PATH):
        print(f"❌ 파일 없음: {CONTENTS_PATH}")
        sys.exit(1)
    with open(CONTENTS_PATH, "r", encoding="utf-8") as f:
        contents = json.load(f)
    if not isinstance(contents, dict):
        print("❌ Bigdata_contents_1681.json 은 객체(q_id -> 내용)여야 합니다.")
        sys.exit(1)

    index_list = []
    if os.path.exists(INDEX_PATH):
        with open(INDEX_PATH, "r", encoding="utf-8") as f:
            index_list = json.load(f)
    if not index_list and os.path.exists(INDEX_ALT_PATH):
        with open(INDEX_ALT_PATH, "r", encoding="utf-8") as f:
            index_list = json.load(f)
    if not isinstance(index_list, list):
        index_list = []
    return contents, index_list


def upload_questions_to_firestore(db, contents: dict, index_list: list):
    """Bigdata_contents_1681 + Index → Firestore question_pools/contents_1681/questions/{q_id}"""
    index_by_qid = {e["q_id"]: e for e in index_list if e.get("q_id")}

    core_concepts_list = _load_core_concepts_ordered()
    print(f"   core_concepts 로드: {len(core_concepts_list)}개")

    pools_ref = db.collection("certifications").document(CERT_CODE).collection("question_pools")
    questions_ref = pools_ref.document(POOL_ID).collection("questions")

    batch = db.batch()
    count = 0
    total = 0
    for q_id, content in contents.items():
        doc_id = _safe_doc_id(q_id)
        index_entry = index_by_qid.get(q_id)
        doc_data = build_question_doc(q_id, content, index_entry, core_concepts_list)
        ref = questions_ref.document(doc_id)
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
    print(f"   => Firestore question_pools/{POOL_ID}/questions 업로드 완료: {total}건")


def _q_id_to_metadata(q_id: str) -> dict:
    """q_id만 있을 때 최소 메타데이터 추정. 예: S2_22_0554 → subject=2, core_id=22."""
    meta = {}
    parts = str(q_id).replace("-", "_").split("_")
    if len(parts) >= 2 and parts[0].upper() == "S":
        try:
            meta["subject"] = int(parts[1])
        except ValueError:
            pass
    if len(parts) >= 3:
        try:
            core = int(parts[2])
            meta["core_id"] = core
            meta["sub_core_id"] = f"{core}-0"
        except ValueError:
            pass
    return meta


def get_index_payload(contents_dict: Optional[dict] = None, index_list: Optional[list] = None) -> Optional[list]:
    """업로드할 index 배열 반환 (Storage + Firestore 공용)."""
    if index_list and isinstance(index_list, list):
        return index_list
    if contents_dict and isinstance(contents_dict, dict):
        return [
            {"q_id": q_id, "metadata": _q_id_to_metadata(q_id), "stats": {}}
            for q_id in contents_dict.keys()
        ]
    index_file = INDEX_PATH if os.path.exists(INDEX_PATH) else INDEX_ALT_PATH
    if os.path.exists(index_file):
        with open(index_file, "r", encoding="utf-8") as f:
            return json.load(f)
    return None


def upload_index_to_storage(payload: list) -> None:
    """Index 배열 → Firebase Storage /assets/BIGDATA/index.json"""
    try:
        from firebase_admin import storage
        bucket = storage.bucket()
        blob = bucket.blob("assets/BIGDATA/index.json")
        blob.upload_from_string(
            json.dumps(payload, ensure_ascii=False, indent=0),
            content_type="application/json",
        )
        print(f"   => Storage /assets/BIGDATA/index.json 업로드 완료")
    except Exception as e:
        print(f"⚠️ Storage 업로드 실패: {e}")
        print("   (Firebase Storage 규칙 및 서비스 계정 권한 확인)")


def upload_index_to_firestore(db, payload: list) -> None:
    """Index 배열 → Firestore certifications/BIGDATA/public/index (CORS 없이 앱에서 조회용)"""
    try:
        from google.cloud.firestore_v1 import SERVER_TIMESTAMP
        ref = db.collection("certifications").document(CERT_CODE).collection("public").document("index")
        ref.set({"items": payload, "updatedAt": SERVER_TIMESTAMP})
        print(f"   => Firestore certifications/{CERT_CODE}/public/index 업로드 완료 ({len(payload)}건)")
    except Exception as e:
        print(f"⚠️ Firestore index 업로드 실패: {e}")


def main():
    print("=" * 60)
    print("🔥 Bigdata_contents_1681 + (선택) Index → Firestore & Storage")
    print("=" * 60)
    print(f"   Contents: {CONTENTS_PATH}")
    print(f"   Index:    {INDEX_PATH} or {INDEX_ALT_PATH} (없으면 contents 키로 최소 인덱스 생성)")
    print(f"   Firestore: certifications/{CERT_CODE}/question_pools/{POOL_ID}/questions/{{q_id}}")
    print(f"   Storage:  /assets/BIGDATA/index.json")
    print()
    contents, index_list = load_contents_and_index()
    init_firebase()
    from firebase_admin import firestore
    db = firestore.client()

    print("\n[Step 1] Firestore question_pools 업로드...")
    upload_questions_to_firestore(db, contents, index_list)

    payload = get_index_payload(contents_dict=contents, index_list=index_list if index_list else None)
    if payload:
        print(f"\n[Step 2] Index 업로드 (Storage + Firestore)...")
        print(f"   Index: {len(payload)}건")
        upload_index_to_storage(payload)
        upload_index_to_firestore(db, payload)
    else:
        print(f"\n⚠️ Index 없음 → Storage/Firestore 업로드 생략")

    print("\n✨ 완료.")


if __name__ == "__main__":
    main()
