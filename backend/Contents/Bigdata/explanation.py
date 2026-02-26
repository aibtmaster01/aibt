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

FILE_INPUT = os.path.join(DIR_WORK, "backup_Bigdata_contents_AI_Expanded.json")
FILE_INDEX = os.path.join(DIR_WORK, "Bigdata_index.json") 
# 실시간 저장을 위해 체크포인트 파일명을 명확히 분리 (테스트 시 원본 보호)
FILE_OUTPUT = os.path.join(DIR_WORK, "Bigdata_contents_1681_Checkpoint.json")

# --- [2] 제어 상수 ---
TEST_MODE = True           # True: 50개만 테스트
BATCH_SIZE = 10            # 10개씩 느리고 확실하게
AI_MODEL_GENERATOR = "gpt-4o"       # 해설 작성 (일타 강사)
AI_MODEL_EVALUATOR = "gpt-4o-mini"  # 해설 평가 (블라인드 학습자)
HIGH_STAT_THRESHOLD = 0.7  
PASS_SCORE = 7             # 학습자 평가 합격 기준점 (10점 만점)

def convert_md_table_to_html(md_text: str) -> str:
    """마크다운 -> HTML 변환 방어 로직"""
    if not md_text or "|" not in md_text: return md_text
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
    """일타 강사(GPT-4o)의 해설 확장 (포맷 에러 방어 적용)"""
    prompt_payload = []
    for item in batch_items:
        q_id = str(item.get("q_id", ""))
        content = item.get("question_content", {}) if isinstance(item.get("question_content"), dict) else {}
        stats = stats_map.get(q_id, {})
        is_hard = stats.get("difficulty", 0.0) >= HIGH_STAT_THRESHOLD and stats.get("trap_score", 0.0) >= HIGH_STAT_THRESHOLD
        
        prompt_payload.append({
            "q_id": q_id,
            "question": content.get("question_text"),
            "current_explanation": content.get("explanation"),
            "is_high_difficulty": is_hard
        })

    system_msg = """
    당신은 빅데이터분석기사 최고 일타 강사입니다.
    [중요 규칙]
    1. 'current_explanation'의 기존 문장을 토씨 하나 바꾸지 말고 100% 보존하십시오.
    2. 전문 용어의 뜻과 작동 원리 등 '부연 설명'을 원본 앞뒤나 중간에 자연스럽게 융합하십시오. (총 300~500자)
    3. 기존 문체(존어/존댓말)를 완벽히 유지하십시오.
    4. 'is_high_difficulty'가 true면 마지막에 <br><b>고난도 문제 TIP</b><br> 을 넣고 150자 팁을 추가하십시오.
    반드시 'results' 키를 가진 JSON 객체 배열을 반환해야 합니다.
    """
    try:
        response = client.chat.completions.create(
            model=AI_MODEL_GENERATOR,
            messages=[
                {"role": "system", "content": system_msg},
                {"role": "user", "content": json.dumps(prompt_payload, ensure_ascii=False)}
            ],
            response_format={"type": "json_object"}
        )
        res_data = json.loads(response.choices[0].message.content)
        # 타입 검증 방어막
        if isinstance(res_data, dict) and isinstance(res_data.get("results"), list):
            return res_data["results"]
        return []
    except Exception as e:
        print(f"   [⚠️ AI 생성 에러] {e}")
        return []

def evaluate_with_blind_learner(question: str, expanded_explanation: str) -> Dict[str, Any]:
    """블라인드 학습자(GPT-4o-mini)가 해설 퀄리티를 평가합니다."""
    system_msg = """
    당신은 빅데이터분석기사를 처음 공부하는 수험생(블라인드 학습자)입니다.
    주어진 문제와 강사의 해설을 읽고, 다음을 꼼꼼히 평가해 JSON으로 반환하십시오.
    1. score: 해설이 이해하기 쉽고 명확한지 1~10점으로 평가. (정수)
    2. feedback: 왜 이 점수를 주었는지 1문장으로 짧게 평가.
    응답 형식: {"score": 8, "feedback": "용어 설명이 친절해서 이해가 쏙쏙 됩니다."}
    """
    payload = f"문제: {question}\n\n강사의 해설: {expanded_explanation}"
    
    try:
        response = client.chat.completions.create(
            model=AI_MODEL_EVALUATOR,
            messages=[
                {"role": "system", "content": system_msg},
                {"role": "user", "content": payload}
            ],
            response_format={"type": "json_object"}
        )
        result = json.loads(response.choices[0].message.content)
        # 타입 방어막
        if isinstance(result, dict) and "score" in result:
            return result
        return {"score": 0, "feedback": "JSON 파싱 실패"}
    except Exception as e:
        return {"score": 0, "feedback": f"평가 에러: {e}"}

def run_process():
    print(f"🚀 [Engine] 느림보 안정성 모드 + 블라인드 학습자 검증 시작 (TEST_MODE: {TEST_MODE})")
    
    if not os.path.exists(FILE_INPUT) or not os.path.exists(FILE_INDEX):
        print("❌ 에러: 필수 파일이 없습니다.")
        return

    with open(FILE_INPUT, "r", encoding="utf-8") as f:
        contents_data = json.load(f)
    with open(FILE_INDEX, "r", encoding="utf-8") as f:
        stats_map = {str(item.get("q_id", "")): item.get("stats", {}) for item in json.load(f)}

    # 기존 데이터가 있다면 불러와서 이어하기 (진정한 체크포인트)
    if os.path.exists(FILE_OUTPUT):
        with open(FILE_OUTPUT, "r", encoding="utf-8") as f:
            contents_data = json.load(f)

    all_q_ids = list(contents_data.keys())
    if TEST_MODE:
        all_q_ids = all_q_ids[:50]

    bold_tag_pattern = re.compile(r'<(/?(?:b|strong))(?:\s+[^>]*?)?>', re.IGNORECASE)
    
    for i in range(0, len(all_q_ids), BATCH_SIZE):
        batch_ids = all_q_ids[i:i + BATCH_SIZE]
        batch_items = [{"q_id": qid, **contents_data[qid]} for qid in batch_ids]
        
        print(f"\n📦 [Batch {i//BATCH_SIZE + 1}] {len(batch_ids)}문항 처리 시작...")
        
        # 1. 일타 강사 해설 생성
        expanded_results = expand_explanations_ai(batch_items, stats_map)
        
        # 안전 파싱 (문자열이 왔거나 이상한 값이 오면 스킵하기 위함)
        expanded_map = {}
        if isinstance(expanded_results, list):
            for r in expanded_results:
                if isinstance(r, dict) and "q_id" in r and "expanded_explanation" in r:
                    expanded_map[str(r["q_id"])] = r["expanded_explanation"]

        for q_id in batch_ids:
            item = contents_data[q_id]
            target_obj = item.get("question_content", item)
            if not isinstance(target_obj, dict): continue
            
            original_exp = target_obj.get("explanation", "")
            question_text = str(target_obj.get("question_text", ""))
            
            if q_id in expanded_map:
                new_exp = expanded_map[q_id]
                
                # [안전망 1] AI가 빈 값을 줬는지 확인
                if not new_exp or not isinstance(new_exp, str) or len(new_exp.strip()) < len(str(original_exp).strip()):
                    print(f"   ⚠️ [{q_id}] 분량 미달/에러 -> 원본 유지")
                    target_obj["explanation"] = original_exp
                else:
                    # [안전망 2] 블라인드 학습자 검증 투입
                    eval_result = evaluate_with_blind_learner(question_text, new_exp)
                    score = eval_result.get("score", 0)
                    feedback = eval_result.get("feedback", "피드백 없음")
                    
                    if score >= PASS_SCORE:
                        print(f"   ✅ [{q_id}] 합격 ({score}점): {feedback}")
                        target_obj["explanation"] = new_exp
                    else:
                        print(f"   ❌ [{q_id}] 불합격 ({score}점): {feedback} -> 원본 롤백")
                        target_obj["explanation"] = original_exp
            else:
                print(f"   ⏭️ [{q_id}] 포맷 에러 등으로 스킵됨 -> 원본 유지")
                target_obj["explanation"] = original_exp
            
            # 테이블 및 지문 정규화
            if "question_text" in target_obj:
                target_obj["question_text"] = bold_tag_pattern.sub("", str(target_obj["question_text"]))
            if "options" in target_obj and isinstance(target_obj["options"], list):
                target_obj["options"] = [bold_tag_pattern.sub("", str(opt)) for opt in target_obj["options"]]
            if "table_data" in target_obj and target_obj["table_data"]:
                table_str = bold_tag_pattern.sub("", str(target_obj["table_data"]))
                if table_str.strip().startswith("|"):
                    table_str = convert_md_table_to_html(table_str)
                target_obj["table_data"] = table_str

        # 실시간 하드디스크 중간 저장 (Checkpoint)
        with open(FILE_OUTPUT, "w", encoding="utf-8") as f:
            json.dump(contents_data, f, ensure_ascii=False, indent=2)
        print(f"   💾 배치 완료 및 실시간 저장 성공!")

        # 느림보 모드 휴식 (Rate Limit 원천 차단)
        time.sleep(2.0)

    print("\n" + "="*50)
    print(f"🎉 [작업 완료] 검증된 데이터가 저장되었습니다.")
    print(f"📁 결과물: {FILE_OUTPUT}")
    print("="*50)

if __name__ == "__main__":
    run_process()