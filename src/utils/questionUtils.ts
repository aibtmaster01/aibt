/**
 * 문제 정답 인덱스 정규화
 * - 데이터 소스에 따라 answer가 0-based(0,1,2,3) 또는 1-based(1,2,3,4)로 들어올 수 있음.
 * - 앱 전체는 1-based(①=1, ②=2, ...)로 통일해 채점/표시 일관성 유지.
 */
export function to1BasedAnswer(raw: number, optionCount: number): number {
  if (optionCount <= 0) return 1;
  if (raw >= 1 && raw <= optionCount) return raw;
  if (raw >= 0 && raw < optionCount) return raw + 1;
  return 1;
}

/**
 * wrong_feedback 변환: 배열 또는 Record(0-based/1-based) → 1-based Record.
 * UI가 1-based 선택 번호 사용.
 */
export function wrongFeedbackTo1Based(
  raw: Record<string, string> | string[] | undefined
): Record<string, string> | undefined {
  if (!raw) return undefined;
  if (Array.isArray(raw)) {
    const out: Record<string, string> = {};
    raw.forEach((v, i) => {
      if (typeof v === 'string') out[String(i + 1)] = v;
    });
    return Object.keys(out).length ? out : undefined;
  }
  if (typeof raw !== 'object') return undefined;
  const hasZero = Object.prototype.hasOwnProperty.call(raw, '0');
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v !== 'string') continue;
    if (!hasZero) {
      out[k] = v;
      continue;
    }
    const num = parseInt(k, 10);
    if (Number.isNaN(num)) out[k] = v;
    else out[String(num + 1)] = v;
  }
  return Object.keys(out).length ? out : undefined;
}
