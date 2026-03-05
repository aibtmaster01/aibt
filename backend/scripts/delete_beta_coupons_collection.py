#!/usr/bin/env python3
"""
Firestore beta_coupons 컬렉션의 모든 문서를 삭제합니다.
(컬렉션 자체는 Firestore에서 빈 컬렉션도 자동으로 남지 않으므로 문서만 삭제하면 됩니다.)

Usage:
  cd backend && python scripts/delete_beta_coupons_collection.py

필수: GOOGLE_APPLICATION_CREDENTIALS 또는 backend/serviceAccountKey.json
"""
import os
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.dirname(SCRIPT_DIR)


def init_firebase():
    import firebase_admin
    from firebase_admin import credentials

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
        sys.exit(1)
    cred = credentials.Certificate(cred_path)
    firebase_admin.initialize_app(cred)


def main():
    init_firebase()
    from firebase_admin import firestore

    db = firestore.client()
    coll = db.collection("beta_coupons")
    snap = coll.stream()
    deleted = 0
    for doc in snap:
        doc.reference.delete()
        deleted += 1
        print(f"  삭제: {doc.id}")
    print(f"\n완료: beta_coupons 문서 {deleted}건 삭제됨. 이제 coupons 컬렉션을 사용하세요.")


if __name__ == "__main__":
    main()
