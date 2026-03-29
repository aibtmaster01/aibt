/** 연속으로 이 개수만큼 초고속 답안이어야 의심 패턴으로 본다 */
export const RAPID_SOLVE_STREAK_REQUIRED = 5;

/**
 * 문제당 이 시간(초) 이하이면 "비정상적으로 빠름" 후보 (포함: 아래 또는 같음)
 * 너무 공격적으로 잡지 않도록 2초 — 실제 제재가 아닌 확인용
 */
export const RAPID_SOLVE_MAX_SECONDS_PER_QUESTION = 2;

/** "네, 학습 중이에요" 이후 같은 세션에서 다시 묻기 전 최소 추가 풀이 수 */
export const RAPID_PROMPT_COOLDOWN_AFTER_DISMISS_ANSWERS = 15;

/** 한 퀴즈 세션당 확인 팝업 최대 노출 횟수 */
export const RAPID_PROMPT_MAX_PER_QUIZ_SESSION = 2;

/**
 * 최근 streak개 답안의 elapsedSec가 모두 maxSeconds 이하인지 (부재 시 패턴 미충족)
 */
export function hasConsecutiveRapidAnswers(
  history: { elapsedSec?: number }[],
  streak: number = RAPID_SOLVE_STREAK_REQUIRED,
  maxSeconds: number = RAPID_SOLVE_MAX_SECONDS_PER_QUESTION,
): boolean {
  if (history.length < streak) return false;
  const slice = history.slice(-streak);
  return slice.every((r) => typeof r.elapsedSec === 'number' && r.elapsedSec <= maxSeconds);
}
