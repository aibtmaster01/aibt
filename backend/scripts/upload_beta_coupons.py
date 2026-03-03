#!/usr/bin/env python3
"""
beta_coupon.csv를 읽어 Firestore beta_coupons 컬렉션에 업로드합니다.
- 문서 ID = 쿠폰 코드
- 필드: name, phone, email(있으면), used(기존 문서가 있으면 덮어쓰지 않음)

Usage:
  cd backend && python scripts/upload_beta_coupons.py

CSV 경로: 프로젝트 루트의 beta_coupon.csv (열: 이름,전화번호,쿠폰,이메일)
필수: GOOGLE_APPLICATION_CREDENTIALS 또는 backend/serviceAccountKey.json
"""
import csv
import os
import sys

# backend/scripts에서 backend로 가려면 상위 두 단계
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.dirname(SCRIPT_DIR)
ROOT_DIR = os.path.dirname(BACKEND_DIR)
CSV_PATH = os.path.join(ROOT_DIR, "beta_coupon.csv")


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
        print("  Firebase Console → 프로젝트 설정 → 서비스 계정 → 새 비공개 키 생성")
        print("  export GOOGLE_APPLICATION_CREDENTIALS=\"/path/to/serviceAccountKey.json\"")
        sys.exit(1)
    cred = credentials.Certificate(cred_path)
    firebase_admin.initialize_app(cred)


def main():
    if not os.path.exists(CSV_PATH):
        print(f"CSV 파일이 없습니다: {CSV_PATH}")
        sys.exit(1)

    init_firebase()
    from firebase_admin import firestore

    db = firestore.client()
    coll = db.collection("beta_coupons")

    created = 0
    updated = 0
    skipped_used = 0

    with open(CSV_PATH, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        if reader.fieldnames and "쿠폰" not in (reader.fieldnames or []):
            print("CSV에 '쿠폰' 열이 없습니다. (이름,전화번호,쿠폰,이메일)")
            sys.exit(1)
        for row in reader:
            code = (row.get("쿠폰") or "").strip()
            if not code:
                continue
            name = (row.get("이름") or "").strip()
            phone = (row.get("전화번호") or "").strip()
            email = (row.get("이메일") or "").strip()

            ref = coll.document(code)
            snap = ref.get()
            if snap.exists:
                data = snap.to_dict()
                if data.get("used") is True:
                    skipped_used += 1
                    print(f"  건너뜀 (이미 사용됨): {code}")
                    continue
                ref.update({"name": name, "phone": phone})
                if email:
                    ref.update({"email": email})
                updated += 1
                print(f"  업데이트: {code}")
            else:
                ref.set({"name": name, "phone": phone, "email": email or "", "used": False})
                created += 1
                print(f"  생성: {code}")

    print(f"\n완료: 생성 {created}, 업데이트 {updated}, 이미 사용됨 건너뜀 {skipped_used}")


if __name__ == "__main__":
    main()
