import json
import os
from collections import Counter

class RoundRebalancerV3:
    def __init__(self, base_path):
        self.base_path = base_path
        # 인풋 1: 메타데이터가 있는 인덱스 파일
        self.input_index = os.path.join(base_path, "Bigdata_Index.json")
        # 인풋 2: 이미지/표 여부를 확인할 수 있는 본문 파일
        self.input_contents = os.path.join(base_path, "Bigdata_contents_1681.json")
        
        # 아웃풋: 회차 퀄리티가 정교하게 재조정된 새 인덱스 파일
        self.output_file = os.path.join(base_path, "Bigdata_Index_Rebalanced.json")
        
        # 🚨 [수정됨] 4, 5회차 제거 및 1~3회차 퀄리티 집중 (공장장님 요청)
        self.round_targets = {
            1: 0.55, 2: 0.60, 3: 0.65
        }
        
        # 과목별 시각화(이미지/테이블) 목표 쿼터 (20문제 기준)
        # 1과목 5%(1개), 2과목 18%(~4개), 3과목 15%(3개), 4과목 25%(5개)
        self.visual_quotas = {1: 1, 2: 4, 3: 3, 4: 5}

    def run(self):
        print("="*60)
        print("🚀 [Step 35] 실전 모의고사 정밀 재매핑 (시각화 쿼터제 & 난이도 상향 V2)")
        print("="*60)

        if not os.path.exists(self.input_index) or not os.path.exists(self.input_contents):
            print(f"❌ 입력 파일을 찾을 수 없습니다. 경로를 확인해주세요.")
            return

        with open(self.input_index, 'r', encoding='utf-8') as f:
            data = json.load(f)
            
        with open(self.input_contents, 'r', encoding='utf-8') as f:
            contents_data = json.load(f)

        # ---------------------------------------------------------
        # 🛠️ 시각화 문항 판별기 (이미지 OR 테이블)
        # ---------------------------------------------------------
        def has_visual(q_id):
            content = contents_data.get(q_id, {})
            img_val = content.get('image')
            tbl_val = content.get('table_data')
            
            has_img = bool(img_val and str(img_val).strip().lower() not in ['null', 'none', ''])
            has_tbl = bool(tbl_val and isinstance(tbl_val, list) and len(tbl_val) > 0)
            return has_img or has_tbl

        # 1. 과목별로 풀(Pool) 분리
        subject_pools = {1: [], 2: [], 3: [], 4: []}
        for item in data:
            subj = int(item.get('metadata', {}).get('subject', 1))
            subject_pools[subj].append(item)

        final_allocated = []
        used_qids = set()

        # 2. 정규 회차 배분 (Round 1 ~ 3)
        for r_idx in range(1, 4):
            target_diff = self.round_targets[r_idx]
            round_items = []
            
            for s_id in [1, 2, 3, 4]:
                pool = [q for q in subject_pools[s_id] if q['q_id'] not in used_qids]
                # 타겟 난이도에 가장 가까운 순으로 정렬
                pool.sort(key=lambda x: abs(x.get('stats', {}).get('difficulty', 0.5) - target_diff))
                
                # 풀을 시각화 문항과 일반 문항으로 분리
                visual_pool = [q for q in pool if has_visual(q['q_id'])]
                normal_pool = [q for q in pool if not has_visual(q['q_id'])]
                
                target_v_cnt = self.visual_quotas[s_id]
                
                used_core_in_round = set()
                used_sub_in_round = set()

                # 내부 추출 로직 (중복 방어 1, 2, 3차망)
                def pick_items(sub_pool, needed_cnt):
                    picked = []
                    # 1차망: core_id 완전 고유
                    for q in sub_pool:
                        if len(picked) >= needed_cnt: break
                        c = str(q.get('metadata', {}).get('core_id', ''))
                        s = str(q.get('metadata', {}).get('sub_core_id', ''))
                        if c and c not in used_core_in_round:
                            picked.append(q)
                            used_core_in_round.add(c)
                            if s: used_sub_in_round.add(s)
                            
                    # 2차망: sub_core_id 고유 (차악의 선택)
                    if len(picked) < needed_cnt:
                        for q in sub_pool:
                            if len(picked) >= needed_cnt: break
                            if q in picked: continue
                            s = str(q.get('metadata', {}).get('sub_core_id', ''))
                            if s and s not in used_sub_in_round:
                                picked.append(q)
                                used_sub_in_round.add(s)
                                
                    # 3차망: 그래도 모자라면 순서대로 (최후 수단)
                    if len(picked) < needed_cnt:
                        for q in sub_pool:
                            if len(picked) >= needed_cnt: break
                            if q not in picked:
                                picked.append(q)
                    return picked

                # 🚨 시각화 문항 먼저 쿼터만큼 추출
                picked_visuals = pick_items(visual_pool, target_v_cnt)
                
                # 🚨 남은 자리를 일반 문항으로 채움 (시각화 문항이 부족했다면 일반 문항이 그만큼 더 많이 뽑힘)
                needed_normals = 20 - len(picked_visuals)
                picked_normals = pick_items(normal_pool, needed_normals)
                
                # 극단적인 예외: 일반 문항마저 다 떨어져서 20개가 안 찰 경우, 남은 시각화 문항으로 억지라도 채움
                if len(picked_visuals) + len(picked_normals) < 20:
                    remaining_visuals = [q for q in visual_pool if q not in picked_visuals]
                    extra_needed = 20 - (len(picked_visuals) + len(picked_normals))
                    picked_extra = pick_items(remaining_visuals, extra_needed)
                    picked_visuals.extend(picked_extra)

                subject_round_items = picked_visuals + picked_normals
                
                # 해당 라운드의 문항 정보 업데이트
                for q in subject_round_items:
                    q['metadata']['round'] = r_idx
                    used_qids.add(q['q_id'])
                    round_items.append(q)
            
            final_allocated.extend(round_items)

        # 3. 나머지 문항을 Round 99(약점 공략 풀)로 할당
        pool_99 = []
        for s_id in [1, 2, 3, 4]:
            remains = [q for q in subject_pools[s_id] if q['q_id'] not in used_qids]
            for q in remains:
                q['metadata']['round'] = 99
                pool_99.append(q)
        
        # 4. 전체 데이터 병합 및 정렬 (회차 -> 과목 -> Q_ID)
        all_final_data = final_allocated + pool_99
        all_final_data.sort(key=lambda x: (
            x['metadata']['round'], 
            int(x['metadata']['subject']), 
            x['q_id']
        ))

        # 5. 결과 저장
        with open(self.output_file, 'w', encoding='utf-8') as f:
            json.dump(all_final_data, f, ensure_ascii=False, indent=2)

        # 6. 정밀 리포트 출력
        self._print_detailed_report(all_final_data, contents_data)

    def _print_detailed_report(self, data, contents_data):
        print("\n" + "="*70)
        print("📊 [Advanced Dashboard] 회차별 & 과목별 정밀 분석 리포트")
        print("="*70)
        
        round_counts = Counter(item['metadata']['round'] for item in data)
        
        def has_visual(q_id):
            content = contents_data.get(q_id, {})
            has_img = bool(content.get('image') and str(content.get('image')).strip().lower() not in ['null', 'none', ''])
            has_tbl = bool(content.get('table_data') and isinstance(content.get('table_data'), list) and len(content.get('table_data')) > 0)
            return has_img or has_tbl

        for r in range(1, 4):
            r_data = [q for q in data if q['metadata']['round'] == r]
            if not r_data: continue
            
            # 전체 평균
            r_diff = sum(q.get('stats', {}).get('difficulty', 0.5) for q in r_data) / len(r_data)
            r_trend = sum(q.get('stats', {}).get('trend', 0.5) for q in r_data) / len(r_data)
            r_visuals = sum(1 for q in r_data if has_visual(q['q_id']))
            
            print(f"\n🏆 [Round {r}] 총 {len(r_data)}문항 | 평균 난이도: {r_diff:.2f} | 평균 트렌드: {r_trend:.2f} | 총 시각화: {r_visuals}개")
            print("-" * 70)
            print(f"{'과목':<10} | {'난이도':<8} | {'트렌드':<8} | {'시각화 문항(비율)':<15}")
            print("-" * 70)
            
            for s in [1, 2, 3, 4]:
                s_data = [q for q in r_data if int(q['metadata']['subject']) == s]
                if not s_data: continue
                
                s_diff = sum(q.get('stats', {}).get('difficulty', 0.5) for q in s_data) / len(s_data)
                s_trend = sum(q.get('stats', {}).get('trend', 0.5) for q in s_data) / len(s_data)
                s_visuals = sum(1 for q in s_data if has_visual(q['q_id']))
                s_v_ratio = (s_visuals / len(s_data)) * 100
                
                print(f"제 {s}과목    | {s_diff:.2f}     | {s_trend:.2f}     | {s_visuals}개 ({s_v_ratio:04.1f}%)")

        print("\n" + "="*70)
        print(f"♾️ Round 99 (약점 공략 풀 잔여): {round_counts.get(99, 0)}문항")
        print(f"💾 결과 파일: {self.output_file}")
        print("="*70)

if __name__ == "__main__":
    BASE = "/Users/syun/Downloads/aibt_cursor/backend/Contents/Bigdata/"
    rebalancer = RoundRebalancerV3(BASE)
    rebalancer.run()