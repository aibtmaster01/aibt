const STORAGE_KEY = 'aibt_guest_quiz_progress';

export interface GuestQuizProgress {
  certId: string;
  roundId: string;
  round: number;
  startedAt: string;
  answers: { qid: string; selected: number; isCorrect: boolean; isConfused: boolean }[];
  currentIndex: number;
}

/** localStorage 사용: 이메일 인증 등으로 탭 전환/새로고침 후 복귀해도 1~20번 세션 유지 */
export function saveGuestQuizProgress(data: GuestQuizProgress): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // ignore
  }
}

export function loadGuestQuizProgress(): GuestQuizProgress | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as unknown;
    if (!data || typeof data !== 'object' || !('certId' in data) || !('roundId' in data)) return null;
    return data as GuestQuizProgress;
  } catch {
    return null;
  }
}
