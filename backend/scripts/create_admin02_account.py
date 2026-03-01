#!/usr/bin/env python3
"""
admin02@aibt.com (일반 권한 관리자) Firebase Auth + Firestore 생성/갱신.

Usage: cd backend && python scripts/create_admin02_account.py
"""
import os
import sys
import warnings
warnings.filterwarnings("ignore", category=FutureWarning)
warnings.filterwarnings("ignore", message=".*OpenSSL.*")

from datetime import datetime
import firebase_admin
from firebase_admin import auth, credentials, firestore

ADMIN02_EMAIL = "admin02@aibt.com"
ADMIN02_PASSWORD = "147201"
ADMIN02_DISPLAY_NAME = "관리자(일반)"


def init_firebase():
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
        print("서비스 계정 JSON을 찾을 수 없습니다. backend/serviceAccountKey.json 또는 GOOGLE_APPLICATION_CREDENTIALS 설정.")
        sys.exit(1)
    cred = credentials.Certificate(cred_path)
    firebase_admin.initialize_app(cred)


def get_or_create_admin02_auth():
    try:
        user = auth.get_user_by_email(ADMIN02_EMAIL)
        auth.update_user(user.uid, password=ADMIN02_PASSWORD)
        print("[Auth] 기존 계정 비밀번호 갱신:", ADMIN02_EMAIL, "uid=", user.uid)
        return user
    except auth.UserNotFoundError:
        user = auth.create_user(
            email=ADMIN02_EMAIL,
            password=ADMIN02_PASSWORD,
            display_name=ADMIN02_DISPLAY_NAME,
            email_verified=True,
        )
        print("[Auth] 신규 생성:", ADMIN02_EMAIL, "uid=", user.uid)
        return user


def set_admin02_firestore(db, uid):
    now = datetime.utcnow().isoformat() + "Z"
    user_ref = db.collection("users").document(uid)
    snap = user_ref.get()
    if snap.exists:
        user_ref.update({
            "email": ADMIN02_EMAIL,
            "name": ADMIN02_DISPLAY_NAME,
            "isAdmin": True,
            "adminRole": "normal",
            "isBanned": False,
            "is_verified": True,
        })
        print("[Firestore] users/%s 업데이트 (isAdmin=True, adminRole=normal)" % uid)
    else:
        user_ref.set({
            "email": ADMIN02_EMAIL,
            "name": ADMIN02_DISPLAY_NAME,
            "familyName": "관리",
            "givenName": "자02",
            "isAdmin": True,
            "adminRole": "normal",
            "isBanned": False,
            "is_verified": True,
            "registered_devices": [],
            "memberships": {},
            "created_at": now,
        })
        print("[Firestore] users/%s 생성 (관리자 일반권한)" % uid)


def main():
    init_firebase()
    db = firestore.client()
    print("=== admin02 계정 생성/갱신 ===\n")
    admin = get_or_create_admin02_auth()
    set_admin02_firestore(db, admin.uid)
    print("\n완료. 로그인: %s / %s" % (ADMIN02_EMAIL, ADMIN02_PASSWORD))


if __name__ == "__main__":
    main()
