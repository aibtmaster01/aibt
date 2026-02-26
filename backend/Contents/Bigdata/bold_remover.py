import json
import os
import re
from tqdm import tqdm

# --- [1] 경로 및 설정 ---
# 유저님의 실제 파일 경로 환경에 맞춰 설정되어 있습니다.
DIR_WORK = "/Users/syun/Downloads/aibt_cursor/backend/Contents/Bigdata"
FILE_CONTENTS = os.path.join(DIR_WORK, "Bigdata_contents_1681.json")
FILE_BACKUP = os.path.join(DIR_WORK, "backup_Bigdata_contents_1681.json")

def convert_md_table_to_html(md_text: str) -> str:
    """
    마크다운 형식(|---|)의 테이블을 표준 HTML <table> 구조로 변환합니다.
    - 빈 셀이 있어도 열이 밀리지 않도록 개선된 분할 로직을 사용합니다.
    """
    if not md_text or "|" not in md_text:
        return md_text
    
    # 빈 줄을 제외하고 라인별 분리
    lines = [l.strip() for l in md_text.strip().split('\n') if l.strip()]
    if len(lines) < 2:
        return md_text

    html_rows = []
    header_done = False
    
    for line in lines:
        # 구분선 행(|:---:| 또는 |---|)은 데이터가 아니므로 무시
        if re.match(r'^\|?[:\-\s|]+$', line):
            continue
            
        # 각 셀 데이터 추출 (열이 밀리지 않도록 파이프 기준 정확히 분할)
        raw_cells = line.split('|')
        # 양 끝의 빈 요소 제거 (표준 마크다운은 |로 시작하고 끝남)
        if line.startswith('|'): raw_cells = raw_cells[1:]
        if line.endswith('|'): raw_cells = raw_cells[:-1]
        
        cells = [c.strip() for c in raw_cells]
        if not cells: continue
        
        if not header_done:
            # 첫 행은 thead로 처리
            header_html = "<thead><tr>" + "".join(f"<th>{c}</th>" for c in cells) + "</tr></thead>"
            html_rows.append(header_html)
            header_done = True
        else:
            # 이후 행은 tbody 내 tr/td로 처리
            row_html = "<tr>" + "".join(f"<td>{c}</td>" for c in cells) + "</tr>"
            html_rows.append(row_html)
            
    if not html_rows: return md_text
    # <thead>와 <tbody>를 명확히 구분하여 조립
    return f"<table>{html_rows[0]}<tbody>{''.join(html_rows[1:])}</tbody></table>"

def run_final_cleaning():
    """
    [최종 병기] 지문, 보기, 테이블 내의 <b> 태그를 구조에 상관없이 강제 제거합니다.
    - 지문(question_text), 보기(options), 테이블(table_data)만 수술 대상으로 삼습니다.
    - 해설(explanation)은 학습을 위해 보존합니다.
    """
    print("🚀 [Final Engine] 지문/보기/테이블 정밀 수술 시작 (구조 자동 감지 및 힌트 제거)...")

    if not os.path.exists(FILE_CONTENTS):
        print(f"❌ 에러: {FILE_CONTENTS} 파일을 찾을 수 없습니다.")
        return

    # 1. 파일 로드
    try:
        with open(FILE_CONTENTS, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception as e:
        print(f"❌ 파일 로드 실패: {e}")
        return

    # 백업 생성
    with open(FILE_BACKUP, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"📂 원본 백업 완료: {FILE_BACKUP}")

    # 정규표현식: <b>, <B>, <strong> 등 모든 강조 태그와 그 내부 속성까지 매칭
    bold_tag_pattern = re.compile(r'<(/?(?:b|strong))(?:\s+[^>]*?)?>', re.IGNORECASE)
    
    fix_count = 0
    table_convert_count = 0

    # 데이터 순회 처리 (딕셔너리/리스트 모든 구조 대응)
    items_to_process = data.values() if isinstance(data, dict) else data

    for item in tqdm(items_to_process, desc="문항 정밀 검사 중"):
        # [구조 자동 감지] question_content 필드가 있으면 그 내부를, 없으면 루트를 대상으로 함
        target_obj = item.get("question_content", item) if isinstance(item, dict) else {}
        if not target_obj: continue
            
        has_fix = False
        
        # [A] 지문(question_text) 내 힌트 제거
        if "question_text" in target_obj:
            original = str(target_obj["question_text"])
            cleaned = bold_tag_pattern.sub("", original)
            if cleaned != original:
                target_obj["question_text"] = cleaned
                has_fix = True

        # [B] 보기(options) 내 힌트 제거
        if "options" in target_obj and isinstance(target_obj["options"], list):
            new_options = []
            options_fix = False
            for opt in target_obj["options"]:
                opt_str = str(opt)
                cleaned = bold_tag_pattern.sub("", opt_str)
                if cleaned != opt_str:
                    new_options.append(cleaned)
                    options_fix = True
                else:
                    new_options.append(opt)
            if options_fix:
                target_obj["options"] = new_options
                has_fix = True

        # [C] 테이블 데이터(table_data) 정규화 (힌트 제거 + 포맷 변환)
        if "table_data" in target_obj and target_obj["table_data"]:
            table_str = str(target_obj["table_data"])
            
            # 1. 볼드 태그 제거 (이미 HTML 테이블인 경우에도 내부 <b> 제거)
            cleaned = bold_tag_pattern.sub("", table_str)
            if cleaned != table_str:
                table_str = cleaned
                has_fix = True
            
            # 2. 마크다운 테이블 발견 시 HTML로 변환
            if table_str.strip().startswith("|"):
                converted = convert_md_table_to_html(table_str)
                if converted != table_str:
                    table_str = converted
                    table_convert_count += 1
                    has_fix = True
            
            target_obj["table_data"] = table_str

        if has_fix:
            fix_count += 1

    # 최종 저장
    with open(FILE_CONTENTS, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print("\n" + "="*50)
    print(f"🎉 [작업 완료] 총 {fix_count}개 문항의 정답 힌트가 제거되었습니다.")
    print(f"✅ 해설(explanation) 필드의 강조 태그는 안전하게 보호되었습니다.")
    print(f"📊 테이블 변환(MD->HTML): {table_convert_count}건")
    print(f"📁 결과 파일: {FILE_CONTENTS}")
    print("="*50)

if __name__ == "__main__":
    run_final_cleaning()