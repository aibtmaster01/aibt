#!/usr/bin/env python3
"""
Firestore users 컬렉션에서 isAdmin 이 아닌 유저만 삭제합니다.
- Firestore: users/{uid} 문서 및 하위 서브컬렉션(exam_results, stats 등) 삭제
- Firebase Auth: 해당 uid 사용자 삭제 (admin이 아닌 경우만)

Usage:
  cd backend && python scripts/delete_non_admin_users.py

필수: GOOGLE_APPLICATION_CREDENTIALS 또는 backend/serviceAccountKey.json
"""
import os
import sys
import warnings

warnings.filterwarnings("ignore", category=FutureWarning)
warnings.filterwarnings("ignore", message=".*OpenSSL.*")

import firebase_admin
from firebase_admin import auth, credentials, firestore

FIRESTORE_BATCH_SIZE = 500

USER_SUBCOLLECTIONS = (
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
        script_dir = os.path.dirname(os.path.abspath(__file__))
        backend_dir = os.path.dirname(script_dir)
        for name in ("serviceAccountKey.json", "aibt-99bc6-firebase-adminsdk.json"):
            fallback = os.path.join(backend_dir, name)
            if os.path.exists(fallback):
                cred_path = fallback
                break
    if not cred_path or not os.path.exists(cred_path):
        print("서비스 계정 JSON을 찾을 수 없습니다.")
        sys.exit(1)
    cred = credentials.Certificate(cred_path)
    firebase_admin.initialize_app(cred)


def delete_collection(coll_ref, batch_size: int = FIRESTORE_BATCH_SIZE) -> int:
    deleted = 0
    while True:
        docs = list(coll_ref.limit(batch_size).stream())
        if not docs:
            break
        batch = firestore.client().batch()
        for doc in docs:
            batch.delete(doc.reference)
            deleted += 1
        batch.commit()
    return deleted


def delete_user_doc_and_subcollections(db, uid: str) -> int:
    """users/{uid} 문서와 하위 서브컬렉션을 모두 삭제."""
    user_ref = db.collection("users").document(uid)
    total = 0
    for sub_name in USER_SUBCOLLECTIONS:
        sub_ref = user_ref.collection(sub_name)
        n = delete_collection(sub_ref)
        if n > 0:
            print(f"    users/{uid}/{sub_name}: {n} docs deleted")
        total += n
    user_ref.delete()
    total += 1
    return total


def main() -> None:
    init_firebase()
    db = firestore.client()
    users_ref = db.collection("users")

    print("=== Admin 제외 유저 전부 삭제 ===\n")

    to_delete = []
    admins = []
    for user_doc in users_ref.stream():
        uid = user_doc.id
        data = user_doc.to_dict() or {}
        is_admin = data.get("isAdmin") is True
        if is_admin:
            admins.append((uid, data.get("email", "")))
        else:
            to_delete.append(uid)

    print(f"유지(Admin): {len(admins)}명")
    for uid, email in admins:
        print(f"  - {uid} {email}")
    print(f"\n삭제 대상: {len(to_delete)}명\n")

    if not to_delete:
        print("삭제할 비관리자 유저가 없습니다.")
        return

    confirm = input("위 비관리자 유저를 Firestore + Auth 에서 삭제하시겠습니까? (y/N): ")
    if confirm.strip().lower() != "y":
        print("취소됨.")
        sys.exit(0)

    fs_total = 0
    for uid in to_delete:
        print(f"  [Firestore] {uid} 삭제 중...")
        fs_total += delete_user_doc_and_subcollections(db, uid)

    print(f"\n  Firestore: {fs_total} 문서 삭제 완료.")

    auth_deleted = 0
    for uid in to_delete:
        try:
            auth.delete_user(uid)
            auth_deleted += 1
        except auth.UserNotFoundError:
            pass
        except Exception as e:
            print(f"  [Auth] {uid} 삭제 실패: {e}")

    print(f"  Auth: {auth_deleted} 명 삭제 완료.")
    print("\n=== 완료 ===")


if __name__ == "__main__":
    main()
