const RELOAD_KEY = 'examService_load_failed_reload';

/**
 * examService 동적 로더 (앱 초기화 시 정적 import 제거로 ReferenceError 방지)
 * 배포 후 이전 빌드 청크가 404일 수 있으므로 재시도 후 실패 시 한 번 새로고침.
 */
export function getExamService() {
  const clearReloadFlag = () => {
    try {
      sessionStorage.removeItem(RELOAD_KEY);
    } catch {
      // ignore
    }
  };
  return import('./examService')
    .then((m) => {
      clearReloadFlag();
      return m;
    })
    .catch(() =>
      import('./examService')
        .then((m) => {
          clearReloadFlag();
          return m;
        })
        .catch((err) => {
          if (typeof sessionStorage !== 'undefined' && !sessionStorage.getItem(RELOAD_KEY)) {
            sessionStorage.setItem(RELOAD_KEY, '1');
            window.location.reload();
          }
          return Promise.reject(err);
        })
    );
}
