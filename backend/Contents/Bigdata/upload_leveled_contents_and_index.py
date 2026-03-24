#!/usr/bin/env python3
"""
upload_leveled_contents_and_index.py
로컬 베타 전용 Firebase 업로드 (실서버 certifications와 분리)

[인덱스 vs 컨텐츠]
- 인덱스: Bigdata_Index_Leveled.json → q_id, metadata(round l_1~h_3, 99), stats
- 컨텐츠: Final_Bigdata_Contents.json → q_id별 question_text, options, explanation 등

[업로드 경로]
- 인덱스: certifications_beta/BIGDATA/public/index_leveled (Firestore)
          assets/BIGDATA/beta/index_leveled.json (Storage)
- 문항:   certifications_beta/BIGDATA/question_pools/contents_1681/questions/{q_id}

[실행]
  베타:   python3 upload_leveled_contents_and_index.py
  실서버: python3 upload_leveled_contents_and_index.py --prod
  분리만: python3 upload_leveled_contents_and_index.py --split-only
  (스크립트가 있는 디렉터리에 Bigdata_Index_Leveled.json, Final_Bigdata_Contents.json 필요)

[필요] serviceAccountKey.json (프로젝트/backend 폴더) 또는 GOOGLE_APPLICATION_CREDENTIALS
"""

import os
import sys
import json
import random
from typing import Optional

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

CONTENTS_PATH = os.path.join(SCRIPT_DIR, "Final_Bigdata_Contents.json")
INDEX_LEVELED_PATH = os.path.join(SCRIPT_DIR, "Bigdata_Index_Leveled.json")

CERT_CODE = "BIGDATA"
POOL_ID = "contents_1681"
# --prod 이면 certifications, 아니면 certifications_beta
CERT_COLLECTION = "certifications_beta"


def _safe_doc_id(s: str) -> str:
    if not isinstance(s, str):
        s = str(s)
    for c in "./[]*~":
        s = s.replace(c, "_")
    return s


def _load_core_concepts_ordered():
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
    firebase_admin.initialize_app(cred, {"storageBucket": "aibt-99bc6.firebasestorage.app"})
    print(f"✅ Firebase 연결: {cred_path}")


def build_question_doc(q_id: str, content: dict, index_entry: Optional[dict], core_concepts_list: list) -> dict:
    """한 문항 Firestore 문서. round는 문자열(l_1 등) 또는 숫자(99) 가능."""
    qc = content
    meta = (index_entry.get("metadata", {}) if index_entry else {}) or {}
    stats = (index_entry.get("stats", {}) if index_entry else {}) or {}

    subject_raw = meta.get("subject")
    if isinstance(subject_raw, int) and 1 <= subject_raw <= 4:
        subject_num = subject_raw
    else:
        subject_num = 1

    core_id_raw = meta.get("core_id")
    try:
        core_id = int(core_id_raw) if core_id_raw is not None else None
    except (ValueError, TypeError):
        core_id = None
    if core_id is not None and 1 <= core_id <= len(core_concepts_list):
        core_concept = core_concepts_list[core_id - 1]
    else:
        core_concept = (meta.get("core_concept") or "").strip() or "공통 및 기타 개념"

    options = qc.get("options", [])
    answer_idx = qc.get("answer_idx", 0)
    wrong_raw = qc.get("wrong_feedback")
    if isinstance(wrong_raw, dict):
        wrong_obj = {str(k): str(v) for k, v in wrong_raw.items() if v}
    elif isinstance(wrong_raw, list):
        wrong_obj = {str(i + 1): v for i, v in enumerate(wrong_raw) if isinstance(v, str)}
    else:
        wrong_obj = {}
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

    round_val = meta.get("round", 99)

    doc = {
        "cert_id": CERT_CODE,
        "q_id": q_id,
        "core_id": str(core_id) if core_id is not None else "",
        "core_concept": core_concept,
        "round": round_val,
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


def load_leveled_contents_and_index():
    """레벨드 인덱스 + 컨텐츠 로드. 반환: (contents dict, index list)."""
    if not os.path.exists(CONTENTS_PATH):
        print(f"❌ 파일 없음: {CONTENTS_PATH}")
        sys.exit(1)
    if not os.path.exists(INDEX_LEVELED_PATH):
        print(f"❌ 레벨드 인덱스 없음: {INDEX_LEVELED_PATH}")
        print("   먼저 roundre_leveled.py 로 Bigdata_Index_Leveled.json 을 생성하세요.")
        sys.exit(1)

    with open(CONTENTS_PATH, "r", encoding="utf-8") as f:
        contents = json.load(f)
    if not isinstance(contents, dict):
        print("❌ Final_Bigdata_Contents.json 은 객체(q_id -> 내용)여야 합니다.")
        sys.exit(1)

    with open(INDEX_LEVELED_PATH, "r", encoding="utf-8") as f:
        index_list = json.load(f)
    if not isinstance(index_list, list):
        print("❌ Bigdata_Index_Leveled.json 은 배열이어야 합니다.")
        sys.exit(1)

    print(f"   Index (레벨드): {os.path.basename(INDEX_LEVELED_PATH)} ({len(index_list)}건)")
    print(f"   Contents: {os.path.basename(CONTENTS_PATH)} ({len(contents)}건)")
    return contents, index_list


def upload_questions_to_firestore(db, contents: dict, index_list: list):
    """컨텐츠 + 레벨드 인덱스 → Firestore question_pools/.../questions/{q_id}"""
    index_by_qid = {e["q_id"]: e for e in index_list if e.get("q_id")}
    core_concepts_list = _load_core_concepts_ordered()
    print(f"   core_concepts 로드: {len(core_concepts_list)}개")

    questions_ref = (
        db.collection(CERT_COLLECTION).document(CERT_CODE).collection("question_pools").document(POOL_ID).collection("questions")
    )
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


def upload_index_to_storage(payload: list, use_prod: bool = False) -> None:
    """레벨드 인덱스 배열 → Storage. 베타: beta/index_leveled.json, 실서버: index_leveled.json"""
    path = "assets/BIGDATA/index_leveled.json" if use_prod else "assets/BIGDATA/beta/index_leveled.json"
    try:
        from firebase_admin import storage
        bucket = storage.bucket()
        blob = bucket.blob(path)
        blob.upload_from_string(
            json.dumps(payload, ensure_ascii=False, indent=0),
            content_type="application/json",
        )
        print(f"   => Storage /{path} 업로드 완료 ({len(payload)}건)")
    except Exception as e:
        print(f"⚠️ Storage 업로드 실패: {e}")


def upload_index_to_firestore(db, payload: list) -> None:
    """레벨드 인덱스 → Firestore certifications_beta/BIGDATA/public/index_leveled"""
    try:
        from google.cloud.firestore_v1 import SERVER_TIMESTAMP
        ref = db.collection(CERT_COLLECTION).document(CERT_CODE).collection("public").document("index_leveled")
        ref.set({"items": payload, "updatedAt": SERVER_TIMESTAMP})
        print(f"   => Firestore {CERT_COLLECTION}/{CERT_CODE}/public/index_leveled 업로드 완료 ({len(payload)}건)")
    except Exception as e:
        print(f"⚠️ Firestore index_leveled 업로드 실패: {e}")


def write_split_files(index_list: list, contents: dict) -> None:
    """인덱스만 / 컨텐츠만 업로드용 파일로 분리 저장."""
    out_index = os.path.join(SCRIPT_DIR, "Index_Leveled_ForUpload.json")
    with open(out_index, "w", encoding="utf-8") as f:
        json.dump(index_list, f, ensure_ascii=False, indent=0)
    print(f"   => 인덱스 저장: {out_index} ({len(index_list)}건)")
    print(f"   => 컨텐츠는 기존 파일 사용: {CONTENTS_PATH} ({len(contents)}건)")


def main():
    global CERT_COLLECTION
    split_only = "--split-only" in sys.argv
    use_prod = "--prod" in sys.argv
    if use_prod:
        CERT_COLLECTION = "certifications"

    if split_only:
        print("=" * 60)
        print("📂 레벨드 인덱스/컨텐츠 분리 (파일만 저장)")
        print("=" * 60)
        contents, index_list = load_leveled_contents_and_index()
        write_split_files(index_list, contents)
        print("\n✨ 분리 완료. 업로드 시 이 스크립트를 --split-only 없이 실행하세요.")
        return

    storage_path = "assets/BIGDATA/index_leveled.json" if use_prod else "assets/BIGDATA/beta/index_leveled.json"
    print("=" * 60)
    print("🔥 레벨드 인덱스 + 컨텐츠 → Firestore & Storage")
    print("=" * 60)
    print(f"   대상: {'certifications (실서버)' if use_prod else 'certifications_beta (베타)'}")
    print(f"   인덱스: {os.path.basename(INDEX_LEVELED_PATH)}")
    print(f"   컨텐츠: {os.path.basename(CONTENTS_PATH)}")
    print(f"   Firestore: {CERT_COLLECTION}/{CERT_CODE}/question_pools/{POOL_ID}/questions/{{q_id}}")
    print(f"   Firestore: {CERT_COLLECTION}/{CERT_CODE}/public/index_leveled")
    print(f"   Storage:   /{storage_path}")
    print()
    contents, index_list = load_leveled_contents_and_index()
    init_firebase()
    from firebase_admin import firestore
    db = firestore.client()

    print("\n[Step 1] Firestore question_pools 업로드...")
    upload_questions_to_firestore(db, contents, index_list)

    print("\n[Step 2] 레벨드 인덱스 업로드 (Storage + Firestore)...")
    upload_index_to_storage(index_list, use_prod=use_prod)
    upload_index_to_firestore(db, index_list)

    print("\n✨ 완료.")


if __name__ == "__main__":
    main()
