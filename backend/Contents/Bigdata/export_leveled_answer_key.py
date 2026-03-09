#!/usr/bin/env python3
"""
실력 확인 모의고사(l_1~h_3) 회차별 답안 추출.
- Bigdata_Index_Leveled.json: 회차별 문항 목록 (앱과 동일하게 subject, core_id 정렬 후 40문항)
- Final_Bigdata_Contents.json: q_id별 answer_idx (0-based → 1-based로 ①②③④ 표기)
"""
import json
import os

BASE = os.path.dirname(os.path.abspath(__file__))
INDEX_PATH = os.path.join(BASE, "Bigdata_Index_Leveled.json")
CONTENTS_PATH = os.path.join(BASE, "Final_Bigdata_Contents.json")
OUT_PATH = os.path.join(BASE, "..", "..", "..", "docs", "LEVELED_ANSWER_KEY.md")

ROUNDS = ["l_1", "l_2", "l_3", "m_1", "m_2", "m_3", "h_1", "h_2", "h_3"]
NEED_COUNT = 40


def get_subject_core(item):
    meta = item.get("metadata", {})
    s = meta.get("subject")
    c = meta.get("core_id")
    subject = int(s) if s is not None else 99
    if isinstance(c, (int, float)):
        core_id = int(c)
    else:
        try:
            core_id = int(c) if c is not None else 0
        except (ValueError, TypeError):
            core_id = 0
    return subject, core_id


def main():
    with open(INDEX_PATH, "r", encoding="utf-8") as f:
        index = json.load(f)
    with open(CONTENTS_PATH, "r", encoding="utf-8") as f:
        contents = json.load(f)

    # 회차별 필터 → subject, core_id 정렬 → 상위 40개 (앱과 동일)
    by_round = {}
    for round_key in ROUNDS:
        filtered = [x for x in index if str(x.get("metadata", {}).get("round")) == round_key]
        sorted_list = sorted(filtered, key=lambda x: (get_subject_core(x)[0], get_subject_core(x)[1]))
        q_ids = [x["q_id"] for x in sorted_list[:NEED_COUNT]]
        by_round[round_key] = q_ids

    # 답안: answer_idx는 0-based → 1-based (①=1, ②=2, ...)
    choice_labels = ["①", "②", "③", "④", "⑤", "⑥"]

    lines = [
        "# 실력 확인 모의고사(l_1 ~ h_3) 회차별 답안",
        "",
        "레벨: l=초급, m=중급, h=고급 / 회차: 1,2,3",
        "",
    ]
    for round_key in ROUNDS:
        q_ids = by_round.get(round_key, [])
        total = len(q_ids)
        lines.append(f"## {round_key.upper()} ({total}문항)")
        lines.append("")
        lines.append("| 번호 | 문항 ID | 정답 |")
        lines.append("|------|---------|------|")
        # 먼저 행만 채운 뒤, 5문항마다 구분선 삽입 (회차와 무관하게 동일 적용)
        rows = []
        for i, q_id in enumerate(q_ids, 1):
            info = contents.get(q_id, {})
            idx = info.get("answer_idx", 0)
            if isinstance(idx, (int, float)):
                one_based = int(idx) + 1
            else:
                one_based = 1
            label = choice_labels[one_based - 1] if 1 <= one_based <= len(choice_labels) else str(one_based)
            rows.append(f"| {i} | {q_id} | {label} |")
        for j, row in enumerate(rows):
            lines.append(row)
            if (j + 1) % 5 == 0 and (j + 1) < len(rows):
                lines.append("-------------------------")
        lines.append("")

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(f"저장: {OUT_PATH}")


if __name__ == "__main__":
    main()
