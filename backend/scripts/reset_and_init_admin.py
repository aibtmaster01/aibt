#!/usr/bin/env python3
"""
개발 환경 초기화: Firebase Auth + Firestore users 전부 삭제 후,
초기 관리자(Admin) 계정 하나만 새로 생성합니다.

Usage:
  cd backend && python scripts/reset_and_init_admin.py

필수: GOOGLE_APPLICATION_CREDENTIALS 또는 backend/serviceAccountKey.json
"""
import os
import sys
import warnings

warnings.filterwarnings("ignore", category=FutureWarning)
warnings.filterwarnings("ignore", message=".*OpenSSL.*")

from datetime import datetime

import firebase_admin
from firebase_admin import auth, credentials, firestore

# 초기 어드민 계정
ADMIN_EMAIL = "admin@abti.com"
ADMIN_PASSWORD = "qwe123"
ADMIN_DISPLAY_NAME = "관리자"

# Auth batch delete 최대 1000명
AUTH_DELETE_BATCH_SIZE = 1000
# Firestore write batch 최대 500
FIRESTORE_BATCH_SIZE = 500

# users/{uid} 하위 서브컬렉션 이름 (모두 재귀 삭제 대상)
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
        print("  export GOOGLE_APPLICATION_CREDENTIALS=\"/path/to/serviceAccountKey.json\"")
        print("  또는 backend/ 에 serviceAccountKey.json 을 두세요.")
        sys.exit(1)
    cred = credentials.Certificate(cred_path)
    firebase_admin.initialize_app(cred)


def delete_collection(coll_ref, batch_size: int = FIRESTORE_BATCH_SIZE) -> int:
    """컬렉션 내 모든 문서를 배치로 삭제. 삭제한 문서 수 반환."""
    deleted = 0
    while True:
        docs = coll_ref.limit(batch_size).stream()
        batch = firestore.client().batch()
        count = 0
        for doc in docs:
            batch.delete(doc.reference)
            count += 1
        if count == 0:
            break
        batch.commit()
        deleted += count
    return deleted


def delete_user_doc_and_subcollections(db, uid: str) -> int:
    """users/{uid} 문서와 하위 서브컬렉션을 모두 삭제. 삭제한 문서 수 반환."""
    user_ref = db.collection("users").document(uid)
    total = 0
    for sub_name in USER_SUBCOLLECTIONS:
        sub_ref = user_ref.collection(sub_name)
        n = delete_collection(sub_ref)
        if n > 0:
            print(f"    [Firestore] users/{uid}/{sub_name}: {n} docs deleted")
        total += n
    user_ref.delete()
    total += 1
    return total


def delete_all_firestore_users(db) -> int:
    """users 컬렉션의 모든 문서와 각 문서의 서브컬렉션을 재귀적으로 삭제."""
    users_ref = db.collection("users")
    total_deleted = 0
    for user_doc in users_ref.stream():
        uid = user_doc.id
        total_deleted += delete_user_doc_and_subcollections(db, uid)
    return total_deleted


def delete_all_auth_users() -> int:
    """Firebase Auth 등록 사용자 전원 조회 후 배치 삭제."""
    uids = []
    for user in auth.list_users().iterate_all():
        uids.append(user.uid)
    if not uids:
        return 0
    deleted = 0
    for i in range(0, len(uids), AUTH_DELETE_BATCH_SIZE):
        batch = uids[i : i + AUTH_DELETE_BATCH_SIZE]
        result = auth.delete_users(batch)
        deleted += result.success_count
        if result.failure_count:
            for err in result.errors:
                print(f"  [Auth] delete error: {err}")
        print(f"  [Auth] batch delete: {len(batch)} users (success={result.success_count})")
    return deleted


def create_admin_user() -> auth.UserRecord:
    """Auth에 관리자 계정 생성."""
    return auth.create_user(
        email=ADMIN_EMAIL,
        password=ADMIN_PASSWORD,
        display_name=ADMIN_DISPLAY_NAME,
        email_verified=True,
    )


def create_admin_firestore(db, uid: str) -> None:
    """Firestore users/{uid} 에 관리자 문서 생성 (v5.0 스키마 호환)."""
    now = datetime.utcnow().isoformat() + "Z"
    db.collection("users").document(uid).set({
        "email": ADMIN_EMAIL,
        "name": ADMIN_DISPLAY_NAME,
        "isAdmin": True,
        "isBanned": False,
        "is_verified": True,
        "registered_devices": [],
        "memberships": {},
        "created_at": now,
        "history": [],
        "user_problem_type_stats": {},
    })
    print(f"  [Firestore] users/{uid}")


def main() -> None:
    init_firebase()
    db = firestore.client()

    print("=== 전체 회원 삭제 (Hard Reset) ===\n")

    # 1) Firestore users 전부 삭제 (서브컬렉션 포함)
    print("[1/2] Firestore users 컬렉션 및 서브컬렉션 삭제 중...")
    fs_deleted = delete_all_firestore_users(db)
    print(f"  Firestore: {fs_deleted} 문서 삭제 완료.\n")

    # 2) Auth 사용자 전원 삭제 (배치)
    print("[2/2] Firebase Auth 사용자 전원 삭제 중...")
    auth_deleted = delete_all_auth_users()
    print(f"  Auth: {auth_deleted} 명 삭제 완료.\n")

    print("=== 초기 어드민 생성 (Re-init) ===\n")

    # 3) 관리자 Auth 생성
    admin = create_admin_user()
    print(f"  [Auth] uid={admin.uid} email={ADMIN_EMAIL}")

    # 4) 관리자 Firestore 문서 생성
    create_admin_firestore(db, admin.uid)

    print("\n=== 완료 ===")
    print(f"  로그인: {ADMIN_EMAIL} / {ADMIN_PASSWORD}")


if __name__ == "__main__":
    main()
