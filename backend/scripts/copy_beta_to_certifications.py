#!/usr/bin/env python3
"""
copy_beta_to_certifications.py
Firestore certifications_beta → certifications 복사
- public: certifications_beta/BIGDATA/public/* → certifications/BIGDATA/public/*
- question_pools: certifications_beta/BIGDATA/question_pools/{pool_id}/questions/* → certifications/BIGDATA/question_pools/...

실행 (backend에서):
  python3 scripts/copy_beta_to_certifications.py
  python3 scripts/copy_beta_to_certifications.py --dry-run   # 복사 없이 목록만

필요: serviceAccountKey.json (backend 또는 상위) 또는 GOOGLE_APPLICATION_CREDENTIALS
"""

import os
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.dirname(SCRIPT_DIR)

SOURCE_COLLECTION = "certifications_beta"
TARGET_COLLECTION = "certifications"
CERT_CODE = "BIGDATA"


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


def copy_public(db, dry_run: bool) -> int:
    """certifications_beta/BIGDATA/public → certifications/BIGDATA/public"""
    src_ref = db.collection(SOURCE_COLLECTION).document(CERT_CODE).collection("public")
    dst_ref = db.collection(TARGET_COLLECTION).document(CERT_CODE).collection("public")
    count = 0
    for doc in src_ref.stream():
        data = doc.to_dict()
        if dry_run:
            print(f"   [dry-run] public/{doc.id} ({len(data)} keys)")
        else:
            dst_ref.document(doc.id).set(data)
        count += 1
    return count


def copy_question_pools(db, dry_run: bool) -> int:
    """certifications_beta/BIGDATA/question_pools/{pool_id}/questions → certifications/..."""
    src_pools_ref = db.collection(SOURCE_COLLECTION).document(CERT_CODE).collection("question_pools")
    total = 0
    for pool_doc in src_pools_ref.stream():
        pool_id = pool_doc.id
        src_questions_ref = src_pools_ref.document(pool_id).collection("questions")
        dst_questions_ref = (
            db.collection(TARGET_COLLECTION).document(CERT_CODE).collection("question_pools").document(pool_id).collection("questions")
        )
        pool_count = 0
        for q_doc in src_questions_ref.stream():
            if dry_run:
                print(f"   [dry-run] question_pools/{pool_id}/questions/{q_doc.id}")
            else:
                dst_questions_ref.document(q_doc.id).set(q_doc.to_dict())
            pool_count += 1
        print(f"   pool {pool_id}: {pool_count} questions")
        total += pool_count
    return total


def main():
    dry_run = "--dry-run" in sys.argv
    if dry_run:
        print("(dry-run: 실제 쓰기 없이 목록만 출력)\n")

    print("=" * 60)
    print("🔥 certifications_beta → certifications 복사")
    print("=" * 60)
    print(f"   소스: {SOURCE_COLLECTION}/{CERT_CODE}/")
    print(f"   대상: {TARGET_COLLECTION}/{CERT_CODE}/")
    print(f"   복사 대상: public/*, question_pools/*/questions/*")
    print()

    init_firebase()
    from firebase_admin import firestore
    db = firestore.client()

    print("[Step 1] public 문서 복사...")
    n_public = copy_public(db, dry_run)
    print(f"   => {n_public}개 문서\n")

    print("[Step 2] question_pools 문항 복사...")
    n_questions = copy_question_pools(db, dry_run)
    print(f"   => 총 {n_questions}개 문항\n")

    if dry_run:
        print("✨ dry-run 완료. 실제 복사하려면 --dry-run 없이 실행하세요.")
    else:
        print("✨ 복사 완료.")


if __name__ == "__main__":
    main()
