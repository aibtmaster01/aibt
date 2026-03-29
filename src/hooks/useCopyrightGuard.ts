import { useEffect, useRef } from 'react';

export interface UseCopyrightGuardOptions {
  /** 보호 로직 활성화 */
  enabled: boolean;
  /** 이벤트 리스너 부착 대상 (문제·해설 영역) */
  targetRef: React.RefObject<HTMLElement | null>;
  /** CSS user-select 외에 selectstart 차단 */
  blockSelection?: boolean;
  /** contextmenu 기본 동작 차단 */
  blockContextMenu?: boolean;
  /**
   * 탭 전환·창 포커스 이탈 시 콜백 (스크린샷 감지 아님).
   * 과도한 알림 방지를 위해 쿨다운 적용.
   */
  onContextLeave?: () => void;
  /** onContextLeave 최소 간격(ms), 기본 120000 */
  contextLeaveCooldownMs?: number;
}

/**
 * 문제·해설 영역에 한정한 선택/우클릭 완화 제한 + visibility/blur 소프트 훅.
 * 전역 감시나 DevTools 감지는 포함하지 않음.
 */
export function useCopyrightGuard({
  enabled,
  targetRef,
  blockSelection = true,
  blockContextMenu = true,
  onContextLeave,
  contextLeaveCooldownMs = 120_000,
}: UseCopyrightGuardOptions): void {
  const lastLeaveRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    const el = targetRef.current;
    if (!el) return;

    const onSelectStart = (e: Event) => {
      if (blockSelection) e.preventDefault();
    };
    const onContextMenu = (e: MouseEvent) => {
      if (blockContextMenu) e.preventDefault();
    };

    el.addEventListener('selectstart', onSelectStart);
    el.addEventListener('contextmenu', onContextMenu);

    return () => {
      el.removeEventListener('selectstart', onSelectStart);
      el.removeEventListener('contextmenu', onContextMenu);
    };
  }, [enabled, targetRef, blockSelection, blockContextMenu]);

  useEffect(() => {
    if (!enabled || !onContextLeave) return;

    const maybeFire = () => {
      const now = Date.now();
      if (now - lastLeaveRef.current < contextLeaveCooldownMs) return;
      lastLeaveRef.current = now;
      onContextLeave();
    };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') maybeFire();
    };

    const onBlur = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        maybeFire();
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
    };
  }, [enabled, onContextLeave, contextLeaveCooldownMs]);
}
