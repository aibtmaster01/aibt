#!/usr/bin/env python3
"""
특정 학습자의 취약 개념(hierarchy) 이해도를 전체 조회합니다.
Firestore: users/{uid}/stats/{certCode} 의 hierarchy_stats 필드를 읽어
각 개념별 정답률(이해도 %)을 출력합니다.

사용법:
  python scripts/query_user_hierarchy_stats.py

실행 후 유저 이메일 → 과목 순으로 입력하고,
"종료하시겠습니까?" 에 y 입력할 때까지 반복 조회합니다.
"""
import os
import sys

# backend 루트를 path에 추가
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.dirname(SCRIPT_DIR)
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from typing import Optional

import firebase_admin
from firebase_admin import credentials, firestore, auth


def init_firebase():
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
        print("서비스 계정 JSON을 찾을 수 없습니다. backend/ 에 serviceAccountKey.json 을 두거나 GOOGLE_APPLICATION_CREDENTIALS 를 설정하세요.")
        sys.exit(1)
    cred = credentials.Certificate(cred_path)
    firebase_admin.initialize_app(cred)


# Elo 기준 이해도 → 0~100% (gradingService와 동일: 문제 난이도 1200)
def elo_to_percent(proficiency: float) -> int:
    if not isinstance(proficiency, (int, float)):
        return 0
    p = max(100, min(2500, proficiency))
    expected = 1.0 / (1.0 + 10.0 ** ((1200.0 - p) / 400.0))
    return max(0, min(100, round(expected * 100)))


def safe_accuracy(correct: int, total: int) -> int:
    if total <= 0:
        return 0
    v = round((correct / total) * 100)
    return max(0, min(100, v))


def sanitize_key(key: str) -> str:
    """Firestore 필드명에 쓸 수 있도록 특수문자를 _ 로 치환 (gradingService와 동일)."""
    import re
    return re.sub(r"[./\[\]*~]", "_", key)


def get_hierarchy_order(db, cert_code: str) -> list[str]:
    """certification_info/config 의 hierarchy_order(또는 hierarchy) 를 읽어 해당 과목 전체 개념 순서 반환. 없으면 빈 리스트."""
    ref = db.collection("certifications").document(cert_code).collection("certification_info").document("config")
    snap = ref.get()
    if not snap.exists:
        return []
    data = snap.to_dict() or {}
    order = data.get("hierarchy_order") or data.get("hierarchy")
    if isinstance(order, list) and len(order) > 0:
        return [str(x) for x in order]
    return []


def run_query(db, uid: str, cert_code: str) -> None:
    # 1) 해당 과목 전체 개념 순서 (Firestore certification_info 에 있으면 사용)
    hierarchy_order = get_hierarchy_order(db, cert_code)

    doc_ref = db.collection("users").document(uid).collection("stats").document(cert_code)
    snap = doc_ref.get()

    if not snap.exists:
        print(f"문서가 없습니다: users/{uid}/stats/{cert_code}\n")
        if hierarchy_order:
            print("(참고: 해당 과목 hierarchy_order 는 존재합니다. 학습 데이터가 쌓이면 위 경로에 문서가 생성됩니다.)\n")
        return

    data = snap.to_dict() or {}
    hierarchy_stats = data.get("hierarchy_stats") or {}

    # 2) 전체 개념을 고정 순서로 출력 (학습 안 한 개념은 N/A)
    # 이해도 = proficiency(Elo) 기준 0~100% (최신 회차 가중), 없으면 누적 correct/total
    if hierarchy_order:
        rows = []
        for display_name in hierarchy_order:
            path_key = sanitize_key(display_name)
            ent = hierarchy_stats.get(path_key) or hierarchy_stats.get(display_name)
            if ent is None:
                rows.append((display_name, None, 0, 0))
            else:
                total = ent.get("total") or 0
                correct = ent.get("correct") or 0
                proficiency = ent.get("proficiency")
                if proficiency is not None and isinstance(proficiency, (int, float)):
                    acc = elo_to_percent(float(proficiency))
                elif total > 0:
                    acc = safe_accuracy(correct, total)
                else:
                    acc = None
                rows.append((display_name, acc, correct, total))

        print(f"\n=== users/{uid}/stats/{cert_code} 개념별 이해도 (Elo 기준·고정 순서, 총 {len(rows)}개) ===\n")
        print(f"{'순번':<4} {'이해도%':<8} {'정답/전체':<12} 개념명")
        print("-" * 64)
        for i, (name, acc, correct, total) in enumerate(rows, 1):
            acc_str = "N/A" if acc is None else f"{acc}%"
            ct_str = f"{correct}/{total}" if total > 0 else "-"
            print(f"{i:<4} {acc_str:<8} {ct_str:<12}   {name}")
        print("-" * 64)
        learned = sum(1 for r in rows if r[1] is not None and r[3] > 0)
        print(f"총 {len(rows)}개 개념 (학습한 개념 {learned}개)\n")
        return

    # 3) hierarchy_order 없으면 기존 동작: stats 에 있는 개념만, 이해도 낮은 순 (Elo 우선)
    rows = []
    for name, ent in hierarchy_stats.items():
        total = ent.get("total") or 0
        correct = ent.get("correct") or 0
        proficiency = ent.get("proficiency")
        if proficiency is not None and isinstance(proficiency, (int, float)):
            acc = elo_to_percent(float(proficiency))
        else:
            acc = safe_accuracy(correct, total)
        rows.append((name, acc, correct, total))

    rows.sort(key=lambda x: (x[1], -x[3]))

    print(f"\n=== users/{uid}/stats/{cert_code} 취약 개념 이해도 (Elo 기준, 총 {len(rows)}개, hierarchy_order 미설정) ===\n")
    print(f"{'순번':<4} {'이해도%':<6} {'정답/전체':<12} 개념명")
    print("-" * 60)
    for i, (name, acc, correct, total) in enumerate(rows, 1):
        print(f"{i:<4} {acc}%     {correct}/{total:<6}   {name}")
    print("-" * 60)
    print(f"총 {len(rows)}개 개념 (전체 개념 고정 순서는 Firestore certification_info/config 에 hierarchy_order 설정)\n")


def get_uid_by_email(email: str) -> Optional[str]:
    """이메일로 Firebase Auth 사용자 조회 후 uid 반환. 없으면 None."""
    try:
        user = auth.get_user_by_email(email.strip())
        return user.uid
    except auth.UserNotFoundError:
        return None


def main():
    init_firebase()
    db = firestore.client()

    while True:
        email = input("유저 이메일을 입력하세요: ").strip()
        if not email:
            print("유저 이메일을 입력해 주세요.\n")
            continue

        uid = get_uid_by_email(email)
        if not uid:
            print(f"해당 이메일로 등록된 사용자가 없습니다: {email}\n")
            continue

        cert_code = input("과목을 조회하세요 (BIGDATA / SQLD / ADSP): ").strip().upper()
        if not cert_code:
            print("과목 코드를 입력해 주세요.\n")
            continue

        run_query(db, uid, cert_code)

        while True:
            answer = input("종료하시겠습니까? (y/n): ").strip().lower()
            if answer in ("y", "yes", "예"):
                print("종료합니다.")
                return
            if answer in ("n", "no", "아니오"):
                break
            print("y 또는 n 을 입력해 주세요.")


if __name__ == "__main__":
    main()
