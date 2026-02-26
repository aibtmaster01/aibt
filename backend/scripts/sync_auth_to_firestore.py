#!/usr/bin/env python3
"""
Firebase Authentication에 있는 사용자 중 Firestore users 컬렉션에 문서가 없는 경우
최소 문서를 생성합니다. 관리자 회원 목록은 Firestore users를 읽기 때문에,
Auth에만 있고 Firestore에 없으면 목록에 안 보입니다.

Usage:
  cd backend && python scripts/sync_auth_to_firestore.py

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
        sys.exit(1)
    cred = credentials.Certificate(cred_path)
    firebase_admin.initialize_app(cred)


def main() -> None:
    init_firebase()
    db = firestore.client()
    users_ref = db.collection("users")

    print("=== Auth 사용자 → Firestore users 동기화 ===\n")
    print("Auth 사용자 목록 조회 중...")

    created = 0
    skipped = 0
    page = None

    while True:
        if page is None:
            result = auth.list_users(max_results=1000)
        else:
            result = auth.list_users(max_results=1000, page_token=page)

        for u in result.users:
            uid = u.uid
            doc_ref = users_ref.document(uid)
            if doc_ref.get().exists:
                skipped += 1
                continue

            email = u.email or ""
            display = (u.display_name or "").strip() or (email.split("@")[0] if email else "학습자")
            if not display:
                display = "학습자"
            name = "김" + display if len(display) <= 2 else display
            now = datetime.utcnow().isoformat() + "Z"

            doc_ref.set({
                "email": email,
                "familyName": "김",
                "givenName": display,
                "name": name,
                "isAdmin": False,
                "is_verified": getattr(u, "email_verified", False),
                "registered_devices": [],
                "memberships": {},
                "created_at": now,
            })
            created += 1
            print(f"  생성: {uid} ({email or '(이메일 없음)'})")

        page = result.next_page_token
        if not page:
            break

    print(f"\n완료: Firestore 문서 {created}개 생성, 기존 {skipped}명 건너뜀.")
    print("이제 관리자 화면 회원관리에서 목록이 보여야 합니다.")


if __name__ == "__main__":
    main()
