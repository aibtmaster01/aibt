#!/usr/bin/env python3
"""
모든 학습자의 학습 이력을 초기화합니다.
- users/{uid} 문서는 유지 (이메일, 이름, 구독 등)
- 다음 서브컬렉션 전체 삭제: exam_results, stats, user_weakness_stats, user_problem_type_stats
- users/{uid} 문서의 elo_rating_by_cert 필드 제거 (다음 제출 시 1200부터 시작)

Usage:
  cd backend && python scripts/reset_all_learning_history.py

실행 후 확인 프롬프트에서 "YES" 입력 시에만 실행됩니다.
필수: GOOGLE_APPLICATION_CREDENTIALS 또는 backend/serviceAccountKey.json
"""
import os
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.dirname(SCRIPT_DIR)
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

import firebase_admin
from firebase_admin import credentials, firestore

try:
    DELETE_FIELD = firestore.DELETE_FIELD
except AttributeError:
    from google.cloud.firestore_v1.transforms import DELETE_FIELD

FIRESTORE_BATCH_SIZE = 500

# 학습 이력 관련 서브컬렉션만 삭제 (users 문서는 삭제하지 않음)
LEARNING_SUBCOLLECTIONS = (
    "exam_results",
    "stats",
    "user_weakness_stats",
    "user_problem_type_stats",
)


def init_firebase() -> None:
    if firebase_admin._apps:
        return
    cred_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    if not cred_path or not os.path.exists(cred_path):
        for name in ("serviceAccountKey.json", "aibt-99bc6-firebase-adminsdk.json"):
            fallback = os.path.join(BACKEND_DIR, name)
            if os.path.exists(fallback):
                cred_path = fallback
                break
    if not cred_path or not os.path.exists(cred_path):
        print("서비스 계정 JSON을 찾을 수 없습니다.")
        print("  export GOOGLE_APPLICATION_CREDENTIALS=\"/path/to/serviceAccountKey.json\"")
        print("  또는 backend/ 에 serviceAccountKey.json 을 두세요.")
        sys.exit(1)
    cred = credentials.Certificate(cred_path)
    firebase_admin.initialize_app(cred)


def delete_collection(coll_ref, batch_size: int = FIRESTORE_BATCH_SIZE) -> int:
    """컬렉션 내 모든 문서를 배치로 삭제. 삭제한 문서 수 반환."""
    deleted = 0
    db = firestore.client()
    while True:
        docs = list(coll_ref.limit(batch_size).stream())
        if not docs:
            break
        batch = db.batch()
        for d in docs:
            batch.delete(d.reference)
        batch.commit()
        deleted += len(docs)
    return deleted


def reset_one_user_learning(db, uid: str, email_or_name: str = "") -> int:
    """한 명의 학습 이력만 초기화. 삭제한 문서 수 반환."""
    user_ref = db.collection("users").document(uid)
    total = 0
    for sub_name in LEARNING_SUBCOLLECTIONS:
        sub_ref = user_ref.collection(sub_name)
        n = delete_collection(sub_ref)
        if n > 0:
            print(f"    users/{uid}/{sub_name}: {n} docs deleted")
        total += n
    user_ref.update({"elo_rating_by_cert": DELETE_FIELD})
    return total


def main() -> None:
    init_firebase()
    db = firestore.client()

    print("=== 모든 학습자 학습 이력 초기화 ===\n")
    print("다음이 삭제됩니다:")
    for sub in LEARNING_SUBCOLLECTIONS:
        print(f"  - users/{{uid}}/{sub} (전체 문서)")
    print("  - users/{uid} 의 elo_rating_by_cert 필드 제거\n")

    users_ref = db.collection("users")
    user_docs = list(users_ref.stream())
    if not user_docs:
        print("등록된 사용자가 없습니다.")
        return

    print(f"대상 사용자 수: {len(user_docs)} 명\n")
    confirm = input('정말 실행하려면 "YES" 를 입력하세요: ').strip()
    if confirm != "YES":
        print("취소되었습니다.")
        return

    total_deleted = 0
    for i, user_doc in enumerate(user_docs):
        uid = user_doc.id
        data = user_doc.to_dict() or {}
        email = data.get("email") or data.get("name") or uid
        print(f"[{i + 1}/{len(user_docs)}] {email} ({uid})")
        try:
            n = reset_one_user_learning(db, uid, str(email))
            total_deleted += n
        except Exception as e:
            print(f"    ERROR: {e}")
    print(f"\n완료. 삭제된 문서 수: {total_deleted}")


if __name__ == "__main__":
    main()
