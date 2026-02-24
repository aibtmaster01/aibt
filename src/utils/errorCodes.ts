/**
 * 오류 코드: 내부 원인 코드 → 유저에게 보여줄 난수형 코드 매핑
 * - 유저에게는 난수형 코드만 노출
 * - 유저가 해당 코드를 알려주면 docs/ERROR_CODE_LOOKUP.md 대조표로 원인 확인
 */

/** 내부 원인 코드 → 유저 표시용 코드 (고정값, 대조표와 일치해야 함) */
const INTERNAL_TO_DISPLAY: Record<string, string> = {
  ERR_FIREBASE_PERMISSION: '7K2M-A9P1',
  ERR_LOAD_QUESTIONS: 'B4N8-C3Q6',
  ERR_ACCESS_DENIED: 'D1R5-E8T2',
  ERR_EXAM_CONFIG: 'F6W9-G0Y4',
  ERR_CERT_NOT_FOUND: 'H2U7-J5I3',
  ERR_NETWORK: 'L8O0-M3S6',
  ERR_UNKNOWN: 'P4V1-Z9X2',
};

/** 유저 표시 코드 → 내부 코드 (개발자 대조용, ERROR_CODE_LOOKUP.md와 동기화) */
export const DISPLAY_TO_INTERNAL: Record<string, string> = Object.fromEntries(
  Object.entries(INTERNAL_TO_DISPLAY).map(([k, v]) => [v, k])
);

/**
 * 오류로부터 내부 원인 코드 반환 (로직용)
 */
export function getErrorCode(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  const code = (err as { code?: string })?.code ?? '';

  if (code === 'permission-denied' || /permission|insufficient permissions/i.test(msg)) {
    return 'ERR_FIREBASE_PERMISSION';
  }
  if (/문제를 불러올 수 없습니다|문제 로딩 실패/i.test(msg)) {
    return 'ERR_LOAD_QUESTIONS';
  }
  if (/접근이 제한|준비중/i.test(msg)) {
    return 'ERR_ACCESS_DENIED';
  }
  if (/시험 장부|등록되어 있지 않습니다/i.test(msg)) {
    return 'ERR_EXAM_CONFIG';
  }
  if (/해당 자격증|찾을 수 없습니다/i.test(msg)) {
    return 'ERR_CERT_NOT_FOUND';
  }
  if (/network|fetch|failed to fetch/i.test(msg)) {
    return 'ERR_NETWORK';
  }

  return 'ERR_UNKNOWN';
}

/**
 * 유저에게 보여줄 오류 코드 (내부 코드 → 난수형 표시 코드)
 * 유저가 이 코드를 알려주면 ERROR_CODE_LOOKUP.md 로 원인 조회
 */
export function getDisplayErrorCode(internalCode: string): string {
  return INTERNAL_TO_DISPLAY[internalCode] ?? INTERNAL_TO_DISPLAY.ERR_UNKNOWN;
}
