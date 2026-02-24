const STORAGE_KEY = 'aibt_guest_quiz_progress';

export interface GuestQuizProgress {
  certId: string;
  roundId: string;
  round: number;
  startedAt: string;
  answers: { qid: string; selected: number; isCorrect: boolean; isConfused: boolean }[];
  currentIndex: number;
}

export function saveGuestQuizProgress(data: GuestQuizProgress): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // ignore
  }
}

export function loadGuestQuizProgress(): GuestQuizProgress | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as unknown;
    if (!data || typeof data !== 'object' || !('certId' in data) || !('roundId' in data)) return null;
    return data as GuestQuizProgress;
  } catch {
    return null;
  }
}
