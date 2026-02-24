#!/usr/bin/env python3
"""
seed_certification_info.py
- Firestore certifications/BIGDATA/certification_info/config 에 자격증 정보 시드.
- core_concepts: backend/BIGDATA/core_concepts_list.json (bigdata_certification_config.py)
- SQLD는 추후 별도 구축 예정
"""
import os
import sys

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE_DIR)

import firebase_admin
from firebase_admin import credentials, firestore

BIGDATA_CONFIG_PATH = os.path.join(BASE_DIR, "BIGDATA")
sys.path.insert(0, BIGDATA_CONFIG_PATH)
from bigdata_certification_config import get_bigdata_config

CERT_CONFIGS = {"BIGDATA": get_bigdata_config()}


def init_firebase():
    if firebase_admin._apps:
        return
    cred_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    if not cred_path or not os.path.exists(cred_path):
        cred_path = None
    if not cred_path:
        for name in ["serviceAccountKey.json", "aibt-99bc6-firebase-adminsdk.json"]:
            p = os.path.join(BASE_DIR, name)
            if os.path.exists(p):
                cred_path = p
                break
    if not cred_path or not os.path.exists(cred_path):
        print("❌ 인증 키를 찾을 수 없습니다. backend/ 에 serviceAccountKey.json 을 두거나 GOOGLE_APPLICATION_CREDENTIALS 를 설정하세요.")
        sys.exit(1)
    firebase_admin.initialize_app(credentials.Certificate(cred_path))
    print(f"✅ Firebase 연결: {cred_path}")


def main():
    init_firebase()
    db = firestore.client()

    # 인자로 cert 코드 지정 시 해당 자격증만 시드, 없으면 전부 시드
    codes = [c.strip().upper() for c in sys.argv[1:] if c.strip()]
    if not codes:
        codes = list(CERT_CONFIGS.keys())

    for cert_code in codes:
        if cert_code not in CERT_CONFIGS:
            print(f"⚠️ 알 수 없는 자격증 코드: {cert_code} (무시)")
            continue
        config = dict(CERT_CONFIGS[cert_code])
        ref = db.collection("certifications").document(cert_code).collection("certification_info").document("config")
        ref.set(config)
        print(f"✅ certifications/{cert_code}/certification_info/config 저장 완료.")
        print(f"   - 문항: {config['exam_config']['total_questions']}문항, {config['exam_config']['time_limit_min']}분")
        print(f"   - 합격: 평균 {config['exam_config']['pass_criteria']['average_score']}점 이상, 과목별 {config['exam_config']['pass_criteria']['min_subject_score']}% 이상")
        print(f"   - 과목: {[s['name'] for s in config['subjects']]}")
        print(f"   - core_concepts: {len(config.get('core_concepts', []))}개")
        if "problem_type_list" in config:
            print(f"   - problem_type_list: {config['problem_type_list']}")
        if config.get("exam_name"):
            print(f"   - exam_name: {config['exam_name']}")


if __name__ == "__main__":
    main()
