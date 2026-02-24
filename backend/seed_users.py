#!/usr/bin/env python3
"""
Firebase Admin SDK를 사용해 테스트용 계정을 일괄 생성하는 시드 스크립트.
v5.0 스키마: is_verified, registered_devices, memberships
"""
import os
import sys
import warnings

# Python 3.9 / OpenSSL 관련 경고 억제
warnings.filterwarnings("ignore", category=FutureWarning)
warnings.filterwarnings("ignore", message=".*OpenSSL.*")
from datetime import date, datetime, timedelta
from typing import Optional

import firebase_admin
from firebase_admin import auth, credentials, firestore

# 비밀번호 (모든 계정 동일)
DEFAULT_PASSWORD = "asd123"

# 2026년 4월 시즌 만료일
EXPIRY_2026_04_08 = "2026-04-08"


def get_yesterday() -> str:
    """어제 날짜 YYYY-MM-DD"""
    return (date.today() - timedelta(days=1)).strftime("%Y-%m-%d")


def init_firebase():
    """Firebase Admin SDK 초기화"""
    if firebase_admin._apps:
        return
    cred_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    if not cred_path or not os.path.exists(cred_path):
        # 폴백: backend 폴더 내 serviceAccountKey.json
        script_dir = os.path.dirname(os.path.abspath(__file__))
        for name in ("serviceAccountKey.json", "aibt-99bc6-firebase-adminsdk.json"):
            fallback = os.path.join(script_dir, name)
            if os.path.exists(fallback):
                cred_path = fallback
                break
    if not cred_path or not os.path.exists(cred_path):
        print("서비스 계정 JSON을 찾을 수 없습니다.")
        print("옵션 1: export GOOGLE_APPLICATION_CREDENTIALS=\"/경로/to/serviceAccountKey.json\"")
        print("옵션 2: backend/ 폴더에 serviceAccountKey.json 파일을 두세요.")
        sys.exit(1)
    cred = credentials.Certificate(cred_path)
    firebase_admin.initialize_app(cred)


def get_user_by_email(email: str) -> Optional[auth.UserRecord]:
    """이메일로 기존 사용자 조회"""
    try:
        return auth.get_user_by_email(email)
    except auth.UserNotFoundError:
        return None


def delete_user_if_exists(email: str) -> None:
    """동일 이메일 사용자 삭제 (초기화) - Auth + Firestore + 서브컬렉션"""
    user = get_user_by_email(email)
    if user:
        db = firestore.client()
        uid = user.uid
        # 서브컬렉션 user_weakness_stats 삭제
        stats_ref = db.collection("users").document(uid).collection("user_weakness_stats")
        for doc in stats_ref.stream():
            doc.reference.delete()
        db.collection("users").document(uid).delete()
        auth.delete_user(uid)
        print(f"  [삭제] {email} (uid={uid})")


def create_auth_user(email: str, display_name: str) -> auth.UserRecord:
    """Firebase Auth 사용자 생성"""
    return auth.create_user(
        email=email,
        password=DEFAULT_PASSWORD,
        display_name=display_name,
        email_verified=True,
    )


def create_firestore_user(
    uid: str,
    email: str,
    name: str,
    *,
    is_verified: bool = True,
    memberships: dict,
    is_admin: bool = False,
    is_banned: bool = False,
    registered_devices: Optional[list] = None,
    created_at: Optional[str] = None,
    history: Optional[list] = None,
    user_weakness_stats: Optional[dict] = None,
) -> None:
    """Firestore users/{uid} 문서 생성 (v5.0 스키마)"""
    db = firestore.client()
    doc_ref = db.collection("users").document(uid)
    now = datetime.utcnow().isoformat() + "Z"
    doc_ref.set({
        "email": email,
        "name": name,
        "isAdmin": is_admin,
        "isBanned": is_banned,
        "is_verified": is_verified,
        "registered_devices": registered_devices if registered_devices is not None else [],
        "memberships": memberships,
        "created_at": created_at if created_at is not None else now,
        "history": history if history is not None else [],
        "user_problem_type_stats": {},
    })
    print(f"  [Firestore] users/{uid}")

    # user_weakness_stats 서브컬렉션 (푼 문제 수 집계용)
    if user_weakness_stats:
        stats_ref = doc_ref.collection("user_weakness_stats")
        for doc_id, data in user_weakness_stats.items():
            stats_ref.document(doc_id).set(data)
            print(f"  [Firestore] users/{uid}/user_weakness_stats/{doc_id}")


# 생성할 유저 정의: dict 또는 tuple (email, name, is_verified, memberships, is_admin)
# PO 요청: 학습 이력 없음, 계정+구독만. SQLD/ADsP는 준비 중이므로 BIGDATA만.
USER_DEFINITIONS = [
    # A. 무료 회원 3명 - 미결제/미학습
    {"email": "free_user1@aaa.com", "name": "무료_테스터1", "is_verified": True, "memberships": {}, "is_admin": False},
    {"email": "free_user2@aaa.com", "name": "무료_테스터2", "is_verified": True, "memberships": {}, "is_admin": False},
    {"email": "free_user3@aaa.com", "name": "무료_테스터3", "is_verified": True, "memberships": {}, "is_admin": False},
    # B. 유료 회원 3명 - 시즌권 보유자 (BIGDATA만)
    {"email": "paid_user1@aaa.com", "name": "유료_테스터1", "is_verified": True, "memberships": {"BIGDATA": {"tier": "PREMIUM", "expiry_date": EXPIRY_2026_04_08}}, "is_admin": False},
    {"email": "paid_user2@aaa.com", "name": "유료_테스터2", "is_verified": True, "memberships": {"BIGDATA": {"tier": "PREMIUM", "expiry_date": EXPIRY_2026_04_08}}, "is_admin": False},
    {"email": "paid_user3@aaa.com", "name": "유료_테스터3", "is_verified": True, "memberships": {"BIGDATA": {"tier": "PREMIUM", "expiry_date": EXPIRY_2026_04_08}}, "is_admin": False},
    # C. 관리자 1명
    {"email": "admin@aaa.com", "name": "관리자", "is_verified": True, "memberships": {"BIGDATA": {"tier": "PREMIUM", "expiry_date": EXPIRY_2026_04_08}}, "is_admin": True},
    # --- Admin QA 전용 샘플 (시나리오별 테스트) ---
    # [QA-01] N개 자격증 보유 유저 (행 분리 테스트)
    {
        "email": "multi_cert@test.com",
        "name": "김다구독",
        "is_verified": True,
        "memberships": {
            "SQLD": {"tier": "PREMIUM", "expiry_date": "2026-12-31"},
            "ADSP": {"tier": "PREMIUM", "expiry_date": "2025-01-01"},  # 만료됨
        },
        "is_admin": False,
    },
    # [QA-02] 미래 시험 타겟 유저 (D-Day 연동 테스트)
    {
        "email": "future_target@test.com",
        "name": "박미래",
        "is_verified": True,
        "memberships": {
            "BIGDATA": {
                "tier": "PREMIUM",
                "expiry_date": "2026-12-31",
                "target_schedule_id": "bd3",  # 2026년 3회차 (12월 15일)
            },
        },
        "is_admin": False,
    },
    # [QA-03] 정지된 유저 (가시성 및 보안 테스트)
    {
        "email": "banned_user@test.com",
        "name": "이정지",
        "is_verified": True,
        "memberships": {"SQLD": {"tier": "PREMIUM", "expiry_date": "2026-12-31"}},
        "is_admin": False,
        "is_banned": True,
    },
    # [QA-04] 기기 부자 유저 (기기 초기화 테스트)
    {
        "email": "many_devices@test.com",
        "name": "최기기",
        "is_verified": True,
        "memberships": {"BIGDATA": {"tier": "PREMIUM", "expiry_date": EXPIRY_2026_04_08}},
        "is_admin": False,
        "registered_devices": ["iphone_15", "ipad_pro", "macbook_air"],
    },
    # [QA-05] 열공 중인 신규 유저 (대시보드 통계 테스트)
    {
        "email": "heavy_worker@test.com",
        "name": "정열공",
        "is_verified": True,
        "memberships": {"BIGDATA": {"tier": "PREMIUM", "expiry_date": EXPIRY_2026_04_08}},
        "is_admin": False,
        "created_at": date.today().strftime("%Y-%m-%d") + "T00:00:00.000Z",
        "history": [{"q_id": f"q{i}", "correct": i % 2 == 0, "round_id": "r1"} for i in range(55)],
        "user_weakness_stats": {
            "c1": {"data_understanding": {"total_attempted": 55, "correct_count": 40, "misconception_count": 2}},
        },
    },
]


def main():
    init_firebase()

    print("=== 테스트 계정 시드 시작 ===\n")

    for defn in USER_DEFINITIONS:
        email = defn["email"]
        name = defn["name"]
        is_verified = defn["is_verified"]
        memberships = defn["memberships"]
        is_admin = defn["is_admin"]
        print(f"[처리] {email}")

        # 1. 기존 사용자 삭제
        delete_user_if_exists(email)

        # 2. Auth 사용자 생성
        user = create_auth_user(email, name)
        print(f"  [Auth] uid={user.uid}")

        # 3. Firestore users 문서 생성
        create_firestore_user(
            uid=user.uid,
            email=email,
            name=name,
            is_verified=is_verified,
            memberships=memberships,
            is_admin=is_admin,
            is_banned=defn.get("is_banned", False),
            registered_devices=defn.get("registered_devices"),
            created_at=defn.get("created_at"),
            history=defn.get("history"),
            user_weakness_stats=defn.get("user_weakness_stats"),
        )

        print()

    print("=== 완료 ===")
    print(f"모든 계정 비밀번호: {DEFAULT_PASSWORD}")


if __name__ == "__main__":
    main()
