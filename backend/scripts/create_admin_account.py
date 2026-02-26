#!/usr/bin/env python3
"""
admin@aibt.com 관리자 계정을 Firebase Auth + Firestore에 생성합니다.
이미 존재하면 비밀번호만 갱신하고 Firestore isAdmin을 True로 유지합니다.

Usage:
  cd backend && python scripts/create_admin_account.py

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

ADMIN_EMAIL = "admin@aibt.com"
ADMIN_PASSWORD = "Tkdhkek12!"
ADMIN_DISPLAY_NAME = "관리자"


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


def get_or_create_admin_auth() -> auth.UserRecord:
    """Auth에 admin 계정이 있으면 비밀번호 갱신, 없으면 생성."""
    try:
        user = auth.get_user_by_email(ADMIN_EMAIL)
        auth.update_user(user.uid, password=ADMIN_PASSWORD)
        print(f"  [Auth] 기존 계정 비밀번호 갱신: {ADMIN_EMAIL} (uid={user.uid})")
        return user
    except auth.UserNotFoundError:
        user = auth.create_user(
            email=ADMIN_EMAIL,
            password=ADMIN_PASSWORD,
            display_name=ADMIN_DISPLAY_NAME,
            email_verified=True,
        )
        print(f"  [Auth] 신규 생성: {ADMIN_EMAIL} (uid={user.uid})")
        return user


def set_admin_firestore(db, uid: str) -> None:
    """Firestore users/{uid} 에 관리자 문서 설정 (기존 문서가 있으면 isAdmin 등만 보정)."""
    now = datetime.utcnow().isoformat() + "Z"
    user_ref = db.collection("users").document(uid)
    snap = user_ref.get()
    if snap.exists:
        user_ref.update({
            "email": ADMIN_EMAIL,
            "name": ADMIN_DISPLAY_NAME,
            "isAdmin": True,
            "isBanned": False,
            "is_verified": True,
        })
        print(f"  [Firestore] users/{uid} 업데이트 (isAdmin=True)")
    else:
        user_ref.set({
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
        print(f"  [Firestore] users/{uid} 생성 (관리자)")


def main() -> None:
    init_firebase()
    db = firestore.client()
    print("=== 관리자 계정 생성/갱신 ===\n")
    admin = get_or_create_admin_auth()
    set_admin_firestore(db, admin.uid)
    print("\n=== 완료 ===")
    print(f"  로그인: {ADMIN_EMAIL} / {ADMIN_PASSWORD}")


if __name__ == "__main__":
    main()
