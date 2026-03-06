/**
 * examService 동적 로더 (앱 초기화 시 정적 import 제거로 ReferenceError 방지)
 */
export function getExamService() {
  return import('./examService');
}
