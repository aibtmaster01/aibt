/**
 * 클라이언트에서 발생한 오류를 Firestore error_logs 컬렉션에 기록.
 * 대시보드에서 관리자가 확인할 수 있도록 함.
 */
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../firebase';

function getMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function getStack(err: unknown): string | undefined {
  if (err instanceof Error && err.stack) return err.stack;
  return undefined;
}

export async function logClientError(err: unknown, context?: string): Promise<void> {
  try {
    const user = auth.currentUser;
    await addDoc(collection(db, 'error_logs'), {
      message: getMessage(err),
      stack: getStack(err),
      userId: user?.uid ?? null,
      userEmail: user?.email ?? null,
      url: typeof window !== 'undefined' ? window.location.href : undefined,
      context: context ?? null,
      timestamp: serverTimestamp(),
    });
  } catch {
    // 기록 실패 시 콘솔만 출력 (무한 루프 방지)
    console.error('[errorLogService] 기록 실패:', err);
  }
}
