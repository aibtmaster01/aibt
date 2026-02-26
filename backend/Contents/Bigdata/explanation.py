import json
import os
import re
import time
from typing import List, Dict, Any
from tqdm import tqdm  # type: ignore
from openai import OpenAI
from dotenv import load_dotenv

# --- [1] 환경 설정 및 경로 ---
load_dotenv()
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY", ""))

DIR_WORK = "/Users/syun/Downloads/aibt_cursor/backend/Contents/Bigdata"

# 인풋: 온전한 해설이 살아있는 백업 파일
FILE_INPUT = os.path.join(DIR_WORK, "backup_Bigdata_contents_AI_Expanded.json")
# 아웃풋: 덮어쓸 기존 메인 파일
FILE_OUTPUT = os.path.join(DIR_WORK, "Bigdata_contents_1681.json")
FILE_INDEX = os.path.join(DIR_WORK, "Bigdata_index.json") 

# --- [2] 제어 상수 ---
TEST_MODE = False     # False: 1681개 전체 실행 (과금 발생)
BATCH_SIZE = 10       # 10개씩 배치 처리
AI_MODEL = "gpt-4o"   # 고성능 모델 전면 도입
HIGH_STAT_THRESHOLD = 0.7  # 고난도 TIP 추가 기준

def convert_md_table_to_html(md_text: str) -> str:
    """마크다운 테이블을 HTML로 변환"""
    if not md_text or "|" not in md_text:
        return md_text
    lines = [l.strip() for l in md_text.strip().split('\n') if l.strip()]
    if len(lines) < 2: return md_text
    html_rows = []
    header_done = False
    for line in lines:
        if re.match(r'^\|?[:\-\s|]+$', line): continue
        raw_cells = line.split('|')
        if line.startswith('|'): raw_cells = raw_cells[1:]
        if line.endswith('|'): raw_cells = raw_cells[:-1]
        cells = [c.strip() for c in raw_cells]
        if not cells: continue
        if not header_done:
            header_html = "<thead><tr>" + "".join(f"<th>{c}</th>" for c in cells) + "</tr></thead>"
            html_rows.append(header_html)
            header_done = True
        else:
            row_html = "<tr>" + "".join(f"<td>{c}</td>" for c in cells) + "</tr>"
            html_rows.append(row_html)
    if not html_rows: return md_text
    return f"<table>{html_rows[0]}<tbody>{''.join(html_rows[1:])}</tbody></table>"

def expand_explanations_ai(batch_items: List[Dict[str, Any]], stats_map: Dict[str, Any]) -> List[Dict[str, Any]]:
    """GPT-4o를 사용하여 해설을 완벽하게 융합 및 확장"""
    
    prompt_payload = []
    for item in batch_items:
        q_id = str(item.get("q_id", ""))
        content = item.get("question_content", {})
        if not isinstance(content, dict):
            content = {}
            
        stats = stats_map.get(q_id, {})
        is_hard = stats.get("difficulty", 0.0) >= HIGH_STAT_THRESHOLD and stats.get("trap_score", 0.0) >= HIGH_STAT_THRESHOLD
        
        prompt_payload.append({
            "q_id": q_id,
            "question": content.get("question_text"),
            "options": content.get("options"),
            "current_explanation": content.get("explanation"),
            "is_high_difficulty": is_hard
        })

    system_msg = f"""
    당신은 대한민국 국가기술자격 '빅데이터분석기사' 최고 일타 강사입니다.
    제공된 문항의 해설을 다음 '철칙'에 따라 확장하십시오:

    [중요 규칙 - 절대 준수]
    1. 지문 보존: 'question'의 문체(존댓말/존어)는 단 한 글자도 수정하지 마십시오.
    2. 완벽한 융합: 'current_explanation'의 원본 문장을 훼손하지 않고 완벽히 보존하되, 정답의 논리적 근거, 전문 용어의 뜻, 작동 원리 등의 '깊이 있는 부연 설명'을 원본 문맥 사이사이나 앞/뒤에 아주 자연스럽게 녹여내십시오.
    3. 분량 및 구성: 전체 해설 분량은 300~500자 사이여야 합니다.
    4. 문체 일관성: 새로 추가되는 문장의 어조는 기존 해설의 문체(주로 존댓말/존어)에 완벽하게 동기화시키십시오. 갑자기 '~함', '~임'으로 끝나면 안 됩니다.
    5. 고난도 팁: 'is_high_difficulty'가 true인 문항은 해설의 가장 마지막에 반드시 아래 형식을 추가하십시오:
       <br>
       <b>고난도 문제 TIP</b>
       <br>
       (함정을 피하는 방법이나 핵심 암기 포인트 150자 이내 추가)

    [출력 형식 제한]
    반드시 'results' 키를 가진 JSON 객체를 반환하며, expanded_explanation에는 null 값을 절대 넣지 말고 완성된 텍스트(string)만 넣으십시오.
    """

    try:
        response = client.chat.completions.create(
            model=AI_MODEL,
            messages=[
                {"role": "system", "content": system_msg},
                {"role": "user", "content": json.dumps(prompt_payload, ensure_ascii=False)}
            ],
            response_format={"type": "json_object"}
        )
        res_data = json.loads(response.choices[0].message.content)
        return res_data.get("results", [])
    except Exception as e:
        print(f"⚠️ AI 호출 에러: {e}")
        return []

def run_process():
    print(f"🚀 [Engine] 백업 복구 및 GPT-4o 기반 해설 정밀 확장 작업 시작 (TEST_MODE: {TEST_MODE})...")
    print("💰 주의: 과금이 발생하며 약 5~10분 정도 소요됩니다.")

    if not os.path.exists(FILE_INPUT):
        print(f"❌ 에러: 안전한 원본인 백업 파일({FILE_INPUT})을 찾을 수 없습니다.")
        return
    if not os.path.exists(FILE_INDEX):
        print("❌ 에러: 인덱스 파일(Bigdata_index.json)이 없습니다.")
        return

    with open(FILE_INPUT, "r", encoding="utf-8") as f:
        contents_data = json.load(f)
    with open(FILE_INDEX, "r", encoding="utf-8") as f:
        index_list = json.load(f)

    stats_map = {str(item.get("q_id", "")): item.get("stats", {}) for item in index_list}

    all_q_ids = list(contents_data.keys())
    if TEST_MODE:
        all_q_ids = all_q_ids[:50]
        print(f"🧪 테스트 모드: 상위 50개 문항만 처리합니다.")

    bold_tag_pattern = re.compile(r'<(/?(?:b|strong))(?:\s+[^>]*?)?>', re.IGNORECASE)
    
    for i in tqdm(range(0, len(all_q_ids), BATCH_SIZE), desc="GPT-4o 해설 복구 및 확장 중"):
        batch_ids = all_q_ids[i:i + BATCH_SIZE]
        batch_items = [{"q_id": qid, **contents_data[qid]} for qid in batch_ids]
        
        expanded_results = expand_explanations_ai(batch_items, stats_map)
        expanded_map = {str(r.get("q_id", "")): r.get("expanded_explanation") for r in expanded_results if "expanded_explanation" in r}

        for q_id in batch_ids:
            item = contents_data[q_id]
            target_obj = item.get("question_content", item)
            if not isinstance(target_obj, dict): continue
            
            original_exp = target_obj.get("explanation", "")
            if q_id in expanded_map:
                new_exp = expanded_map[q_id]
                # NULL 방어 및 분량 검증 로직
                if new_exp and isinstance(new_exp, str) and len(new_exp.strip()) >= len(str(original_exp).strip()):
                    target_obj["explanation"] = new_exp
                else:
                    target_obj["explanation"] = original_exp
            
            if "question_text" in target_obj:
                target_obj["question_text"] = bold_tag_pattern.sub("", str(target_obj["question_text"]))
            if "options" in target_obj and isinstance(target_obj["options"], list):
                target_obj["options"] = [bold_tag_pattern.sub("", str(opt)) for opt in target_obj["options"]]
            if "table_data" in target_obj and target_obj["table_data"]:
                table_str = bold_tag_pattern.sub("", str(target_obj["table_data"]))
                if table_str.strip().startswith("|"):
                    table_str = convert_md_table_to_html(table_str)
                target_obj["table_data"] = table_str

        # GPT-4o Rate Limit 방어용 휴식 (안정성 강화)
        time.sleep(1.5)

    with open(FILE_OUTPUT, "w", encoding="utf-8") as f:
        json.dump(contents_data, f, ensure_ascii=False, indent=2)

    print("\n" + "="*50)
    print(f"🎉 [작업 완료] {len(all_q_ids)}개 문항의 GPT-4o 심화 해설 구축 완료!")
    print(f"📁 결과물 저장 위치: {FILE_OUTPUT}")
    print("="*50)

if __name__ == "__main__":
    run_process()