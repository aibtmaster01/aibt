#!/usr/bin/env python3
"""
Admin 제외 모든 유저의 학습 이력을 초기화합니다.
- isAdmin == True 인 사용자는 건너뜀
- 그 외: exam_results, stats, user_weakness_stats, user_problem_type_stats 삭제, elo_rating_by_cert 제거

Usage:
  cd backend && python scripts/reset_learning_history_exclude_admin.py

실행 후 확인 프롬프트에서 "YES" 입력 시에만 실행됩니다.
"""
import os
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.dirname(SCRIPT_DIR)
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

# reset_all_learning_history 와 동일한 로직 재사용 (반드시 backend 에서 실행: cd backend && python scripts/...)
from scripts.reset_all_learning_history import (
    init_firebase,
    reset_one_user_learning,
    LEARNING_SUBCOLLECTIONS,
)


def main() -> None:
    import firebase_admin
    from firebase_admin import firestore

    init_firebase()
    db = firestore.client()

    print("=== Admin 제외 모든 학습자 학습 이력 초기화 ===\n")
    print("다음이 삭제됩니다 (isAdmin == True 사용자 제외):")
    for sub in LEARNING_SUBCOLLECTIONS:
        print(f"  - users/{{uid}}/{sub} (전체 문서)")
    print("  - users/{uid} 의 elo_rating_by_cert 필드 제거\n")

    users_ref = db.collection("users")
    user_docs = list(users_ref.stream())
    if not user_docs:
        print("등록된 사용자가 없습니다.")
        return

    # Admin 제외
    non_admin_docs = []
    admin_count = 0
    for user_doc in user_docs:
        data = user_doc.to_dict() or {}
        if data.get("isAdmin") is True:
            admin_count += 1
            continue
        non_admin_docs.append(user_doc)

    print(f"전체 사용자: {len(user_docs)} 명 (Admin: {admin_count} 명 제외 → 대상: {len(non_admin_docs)} 명)\n")
    if not non_admin_docs:
        print("초기화할 비관리자 사용자가 없습니다.")
        return

    confirm = input('정말 실행하려면 "YES" 를 입력하세요: ').strip()
    if confirm != "YES":
        print("취소되었습니다.")
        return

    total_deleted = 0
    for i, user_doc in enumerate(non_admin_docs):
        uid = user_doc.id
        data = user_doc.to_dict() or {}
        email = data.get("email") or data.get("name") or uid
        print(f"[{i + 1}/{len(non_admin_docs)}] {email} ({uid})")
        try:
            n = reset_one_user_learning(db, uid, str(email))
            total_deleted += n
        except Exception as e:
            print(f"    ERROR: {e}")
    print(f"\n완료. 삭제된 문서 수: {total_deleted}")


if __name__ == "__main__":
    main()
