/** 인증 메일 재발송: 세션당 최대 5회, 90초 간격 쿨다운 */
const STORAGE_KEY_COUNT = 'finset_resend_verification_count';
const STORAGE_KEY_LAST = 'finset_resend_verification_last';
export const RESEND_COOLDOWN_SEC = 90;
export const RESEND_MAX_COUNT = 5;
const RESEND_COOLDOWN_MS = RESEND_COOLDOWN_SEC * 1000;

function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  return window.sessionStorage;
}

export function getResendCount(): number {
  const s = getStorage();
  if (!s) return 0;
  const v = s.getItem(STORAGE_KEY_COUNT);
  const n = parseInt(v ?? '0', 10);
  return Number.isNaN(n) ? 0 : Math.max(0, n);
}

export function getResendLast(): number | null {
  const s = getStorage();
  if (!s) return null;
  const v = s.getItem(STORAGE_KEY_LAST);
  const n = parseInt(v ?? '', 10);
  return Number.isNaN(n) ? null : n;
}

export function canResend(): { allowed: boolean; message?: string } {
  const count = getResendCount();
  const last = getResendLast();
  if (count >= RESEND_MAX_COUNT) {
    return { allowed: false, message: '재발송은 5번까지 가능합니다. 잠시 후 다시 시도해 주세요.' };
  }
  if (last != null) {
    const elapsed = Date.now() - last;
    if (elapsed < RESEND_COOLDOWN_MS) {
      const secLeft = Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000);
      return { allowed: false, message: `${secLeft}초 후에 다시 시도해 주세요.` };
    }
  }
  return { allowed: true };
}

export function recordResend(): void {
  const s = getStorage();
  if (!s) return;
  const count = getResendCount();
  s.setItem(STORAGE_KEY_COUNT, String(count + 1));
  s.setItem(STORAGE_KEY_LAST, String(Date.now()));
}
