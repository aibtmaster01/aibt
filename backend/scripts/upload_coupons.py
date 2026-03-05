#!/usr/bin/env python3
"""
beta_coupon.csv(또는 coupon.csv)를 읽어 Firestore coupons 컬렉션에 업로드합니다.
- 문서 ID = 쿠폰 코드
- 필드: couponName, expiryDate, certCode, premiumDays, used(False), (선택) name, phone, email

Usage:
  cd backend && python scripts/upload_coupons.py

CSV 경로: 프로젝트 루트의 beta_coupon.csv
열: 이름, 전화번호, 쿠폰, 이메일 (필수: 쿠폰). 선택 열: 쿠폰이름, 만료기일, 자격증, 유료기간(일)
필수: GOOGLE_APPLICATION_CREDENTIALS 또는 backend/serviceAccountKey.json
"""
import csv
import os
import sys

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
    coll = db.collection("coupons")

    created = 0
    updated = 0
    skipped_used = 0

    with open(CSV_PATH, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames or []
        if "쿠폰" not in fieldnames:
            print("CSV에 '쿠폰' 열이 없습니다. (이름, 전화번호, 쿠폰, 이메일)")
            sys.exit(1)
        for row in reader:
            code = (row.get("쿠폰") or "").strip()
            if not code:
                continue
            coupon_name = (row.get("쿠폰이름") or row.get("쿠폰 이름") or "").strip()[:15]
            expiry = (row.get("만료기일") or row.get("만료 기일") or "").strip()
            cert = (row.get("자격증") or "BIGDATA").strip()
            try:
                days = int(row.get("유료기간(일)") or row.get("유료기간") or "365")
            except ValueError:
                days = 365
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
                update_data = {}
                if coupon_name:
                    update_data["couponName"] = coupon_name
                if expiry:
                    update_data["expiryDate"] = expiry
                update_data["certCode"] = cert
                update_data["premiumDays"] = days
                ref.update(update_data)
                updated += 1
                print(f"  업데이트: {code}")
            else:
                doc_data = {
                    "couponName": coupon_name or None,
                    "expiryDate": expiry or None,
                    "certCode": cert,
                    "premiumDays": days,
                    "used": False,
                }
                if name:
                    doc_data["name"] = name
                if phone:
                    doc_data["phone"] = phone
                if email:
                    doc_data["email"] = email
                ref.set(doc_data)
                created += 1
                print(f"  생성: {code}")

    print(f"\n완료: 생성 {created}, 업데이트 {updated}, 이미 사용됨 건너뜀 {skipped_used}")


if __name__ == "__main__":
    main()
