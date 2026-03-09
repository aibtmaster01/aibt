"""
레벨별 고정 모의고사 라운드 재편 (베타 로컬 전용).
- 입력: Final_Bigdata_Index.json + Final_Bigdata_Contents.json
- l_1~l_3 / m_1~m_3 / h_1~h_3 (각 40문항×3) + 나머지 99

우선 규칙 (엄격):
1. 라운드 1~3에 걸쳐 다양한 개념(core_id)이 최소 1번씩 등장
2. 한 라운드 내 동일 개념(core_id) 중복 금지 → 라운드당 40개 서로 다른 core_id
3. 퀄리티 높은 문항 우선 선별

시각화: 라운드당 5~7개 목표 (위 규칙 충족 후 가능 범위에서 적용, 변동 허용)
"""
import json
import os
from collections import Counter

# 레벨별 목표 난이도
TARGET_DIFFICULTY = {"l": 0.35, "m": 0.45, "h": 0.55}
DIFFICULTY_BAND = {"l": (0.28, 0.42), "m": (0.42, 0.52), "h": (0.52, 0.65)}

# 시각화 목표 (라운드당 5~7개, 규칙 우선이므로 변동 가능)
VISUAL_TARGET_MIN = 5
VISUAL_TARGET_MAX = 7


class RoundRebalancerLeveled:
    def __init__(self, base_path):
        self.base_path = base_path
        self.input_index = os.path.join(base_path, "Final_Bigdata_Index.json")
        self.input_contents = os.path.join(base_path, "Final_Bigdata_Contents.json")
        self.output_file = os.path.join(base_path, "Bigdata_Index_Leveled.json")

    def run(self):
        print("=" * 60)
        print("🚀 [Leveled] 레벨별 고정 모의고사 라운드 재편 (l/m/h × 1,2,3 + 99)")
        print("=" * 60)

        if not os.path.exists(self.input_index):
            print(f"❌ 인덱스 파일 없음: {self.input_index}")
            return
        if not os.path.exists(self.input_contents):
            print(f"❌ 콘텐츠 파일 없음: {self.input_contents}")
            return

        with open(self.input_index, "r", encoding="utf-8") as f:
            data = json.load(f)
        with open(self.input_contents, "r", encoding="utf-8") as f:
            contents_data = json.load(f)

        # 기존 round 제거 (메타데이터만 수정, 항목은 그대로 사용)
        for item in data:
            meta = item.get("metadata", {})
            if "round" in meta:
                del meta["round"]

        def has_visual(q_id):
            content = contents_data.get(q_id, {})
            img_val = content.get("image")
            tbl_val = content.get("table_data")
            has_img = bool(
                img_val and str(img_val).strip().lower() not in ("null", "none", "")
            )
            has_tbl = bool(
                tbl_val and isinstance(tbl_val, list) and len(tbl_val) > 0
            )
            return has_img or has_tbl

        def get_quality(item):
            return float(item.get("stats", {}).get("quality", 0) or 0)

        def get_core_id(item):
            c = item.get("metadata", {}).get("core_id")
            return str(c) if c is not None else ""

        def get_difficulty(item):
            return float(item.get("stats", {}).get("difficulty", 0.5) or 0.5)

        def build_subject_pools(used_qids, diff_low=None, diff_high=None):
            pools = {1: [], 2: [], 3: [], 4: []}
            for item in data:
                if item["q_id"] in used_qids:
                    continue
                if diff_low is not None and diff_high is not None:
                    d = get_difficulty(item)
                    if not (diff_low <= d <= diff_high):
                        continue
                subj = int(item.get("metadata", {}).get("subject", 1))
                if subj in pools:
                    pools[subj].append(item)
            return pools

        def pick_ten_for_round(
            subject_pool,
            target_diff,
            used_qids,
            used_core_this_round,
            used_core_in_level,
            has_visual_fn,
            round_visual_so_far,
            visual_cap,
            preferred_cores_for_round=None,
        ):
            """
            한 과목에서 10문항 선발. 규칙: (1) core_id 라운드 내 중복 금지 (2) 이 라운드에 할당된 개념 우선 (3) 미등장 개념 우선 (4) 퀄리티 높은 순 (5) 시각화 5~7 보조.
            반환: (picked list, visual_count)
            """
            pool = [q for q in subject_pool if q["q_id"] not in used_qids]
            pool = [q for q in pool if get_core_id(q) not in used_core_this_round]
            if not pool:
                return [], 0
            preferred = set(preferred_cores_for_round) if preferred_cores_for_round is not None else set()

            def score(q):
                c = get_core_id(q)
                in_preferred = 0 if (c and c in preferred) else 1
                new_core = 0 if (c and c not in used_core_in_level) else 1
                qual = get_quality(q)
                diff_dist = abs(get_difficulty(q) - target_diff)
                is_vis = 1 if has_visual_fn(q["q_id"]) else 0
                need_vis = round_visual_so_far < VISUAL_TARGET_MIN and is_vis
                over_vis = round_visual_so_far >= visual_cap and is_vis
                # 5~7 유지: 부족하면 시각화 우선, 초과면 시각화 후순위
                vis_boost = 0 if need_vis else (2 if over_vis else 1)
                return (in_preferred, new_core, vis_boost, -qual, diff_dist, -is_vis)

            sorted_pool = sorted(pool, key=score)
            picked = []
            visual_count = 0
            visual_slots_left = max(0, visual_cap - round_visual_so_far)
            for q in sorted_pool:
                if len(picked) >= 10:
                    break
                c = get_core_id(q)
                if c in used_core_this_round:
                    continue
                is_vis = has_visual_fn(q["q_id"])
                if is_vis and visual_count >= visual_slots_left:
                    continue
                picked.append(q)
                used_core_this_round.add(c)
                used_core_in_level.add(c)
                used_qids.add(q["q_id"])
                if is_vis:
                    visual_count += 1
            # 10개 미만이면 규칙(중복 금지) 유지한 채 나머지는 시각화 제한 없이 채우기
            if len(picked) < 10:
                for q in sorted_pool:
                    if len(picked) >= 10:
                        break
                    if q["q_id"] in used_qids or get_core_id(q) in used_core_this_round:
                        continue
                    picked.append(q)
                    used_core_this_round.add(get_core_id(q))
                    used_core_in_level.add(get_core_id(q))
                    used_qids.add(q["q_id"])
                    if has_visual_fn(q["q_id"]):
                        visual_count += 1
            return picked, visual_count

        used_qids_global = set()
        final_allocated = []

        for level in ("l", "m", "h"):
            target_diff = TARGET_DIFFICULTY[level]
            low, high = DIFFICULTY_BAND.get(level, (0.0, 1.0))
            used_core_in_level = set()
            pools = build_subject_pools(used_qids_global, diff_low=low, diff_high=high)
            # 레벨 풀에 있는 core_id 목록 (1~3라운드에 골고루 배분)
            level_core_ids = set()
            for subj in (1, 2, 3, 4):
                for item in pools[subj]:
                    c = get_core_id(item)
                    if c:
                        level_core_ids.add(c)
            core_list = sorted(level_core_ids)
            cores_per_round = {1: set(), 2: set(), 3: set()}
            for i, c in enumerate(core_list):
                cores_per_round[(i % 3) + 1].add(c)

            for r_idx in (1, 2, 3):
                round_label = f"{level}_{r_idx}"
                pools = build_subject_pools(used_qids_global, diff_low=low, diff_high=high)
                used_core_this_round = set()
                round_items = []
                round_visual = 0
                visual_cap = VISUAL_TARGET_MAX

                for subject in (1, 2, 3, 4):
                    picked, vc = pick_ten_for_round(
                        pools[subject],
                        target_diff,
                        used_qids_global,
                        used_core_this_round,
                        used_core_in_level,
                        has_visual,
                        round_visual,
                        visual_cap,
                        preferred_cores_for_round=cores_per_round[r_idx],
                    )
                    for q in picked:
                        q["metadata"]["round"] = round_label
                        round_items.append(q)
                    round_visual += vc

                final_allocated.extend(round_items)

        # 나머지 → 99
        for item in data:
            if item["q_id"] not in used_qids_global:
                item["metadata"]["round"] = "99"

        all_final = data
        all_final.sort(
            key=lambda x: (
                1 if x["metadata"].get("round") == "99" else 0,
                x["metadata"].get("round", "99"),
                int(x["metadata"].get("subject", 1)),
                x["q_id"],
            )
        )

        with open(self.output_file, "w", encoding="utf-8") as f:
            json.dump(all_final, f, ensure_ascii=False, indent=2)

        self._print_report(all_final, has_visual)

    def _print_report(self, data, has_visual_fn):
        print("\n" + "=" * 70)
        print("📊 레벨별 라운드 배분 리포트")
        print("=" * 70)
        round_counts = Counter(item["metadata"].get("round") for item in data)
        for r in ("l_1", "l_2", "l_3", "m_1", "m_2", "m_3", "h_1", "h_2", "h_3"):
            r_data = [q for q in data if q["metadata"].get("round") == r]
            if not r_data:
                continue
            n = len(r_data)
            avg_diff = sum(q.get("stats", {}).get("difficulty", 0.5) for q in r_data) / n
            n_vis = sum(1 for q in r_data if has_visual_fn(q["q_id"]))
            print(f"  {r}: {n}문항 | 평균 난이도 {avg_diff:.2f} | 시각화 {n_vis}개")
        print("=" * 70)
        print(f"♾️ Round 99: {round_counts.get('99', 0)}문항")
        print(f"💾 결과: {self.output_file}")
        print("=" * 70)


if __name__ == "__main__":
    BASE = os.path.join(
        os.path.dirname(os.path.abspath(__file__))
    )
    rebalancer = RoundRebalancerLeveled(BASE)
    rebalancer.run()
