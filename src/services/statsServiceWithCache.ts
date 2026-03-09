/**
 * statsServiceWithCache.ts
 * 마이페이지용 캐시 우선 조회 (IndexedDB) → 유효하면 서버 요청 생략
 * - 새 시험 제출 또는 수동 새로고침 시에만 서버에서 갱신
 */

import {
  fetchUserTrendData,
  fetchDashboardStats,
  type FetchUserTrendDataResult,
  type FetchDashboardStatsResult,
  type TrendDataItem,
} from './statsService';
import {
  getUserStatsCache,
  setUserStatsCache,
  isUserStatsCacheValid,
  getUserStatsCacheKey,
  putExamResultsCacheBulk,
  type ExamResultsCacheRecord,
} from './db/localCacheDB';

export type MyPageCachedData = FetchUserTrendDataResult & FetchDashboardStatsResult;

/** 마이페이지 진입 시: 캐시 우선, forceRefresh 또는 캐시 없음/만료 시에만 Firestore 호출 */
export async function getCachedOrFetchMyPageData(
  uid: string,
  certCode: string,
  options?: { forceRefresh?: boolean }
): Promise<MyPageCachedData> {
  const forceRefresh = options?.forceRefresh === true;
  if (!forceRefresh) {
    try {
      const cached = await getUserStatsCache(uid, certCode);
      if (cached && isUserStatsCacheValid(cached)) {
        // 이전 오류로 빈 배열이 캐시된 경우 재요청 (합격률·학습기록 등이 안 보이는 현상 방지)
        const hasTrend = Array.isArray(cached.trendData) && cached.trendData.length > 0;
        const hasRadar = Array.isArray(cached.radarData) && cached.radarData.length > 0;
        const radarAllZero = hasRadar && cached.radarData.every((d) => (d as { A?: number }).A === 0);
        const subjectScoresEmptyOrZero =
          !Array.isArray(cached.subjectScores) ||
          cached.subjectScores.length === 0 ||
          cached.subjectScores.every((s) => (s as { score?: number }).score === 0);
        const weaknessEmpty = !Array.isArray(cached.weaknessTop3) || cached.weaknessTop3.length === 0;
        const dashboardLooksEmpty = !hasRadar || radarAllZero || subjectScoresEmptyOrZero || weaknessEmpty;
        // 트렌드(시험 이력)는 있는데 대시보드가 비었거나 전부 0이면 캐시 무효 → Firestore 재조회
        if (hasTrend && dashboardLooksEmpty) {
          // 캐시 사용하지 않고 아래에서 Firestore 재조회
        } else if (hasTrend || hasRadar) {
          let passRate: number | null = cached.recentPassRate ?? null;
          const inProgress = cached.diagnosticProgress?.status === 'in_progress';
          // 진단 진행 중이 아닐 때만 0% 보정 (트렌드 최근 회차 점수로). 진행 중이면 null 유지
          if (!inProgress && passRate === 0 && hasTrend) {
            const trend = cached.trendData;
            for (let i = trend.length - 1; i >= 0; i--) {
              const s = trend[i]?.score;
              if (s != null && s > 0) {
                passRate = s;
                break;
              }
            }
          }
          return {
            trendData: cached.trendData,
            recentPassRate: passRate,
            diagnosticProgress: cached.diagnosticProgress ?? { completed: 3, total: 3, status: 'completed' as const },
            encouragementMessage: cached.encouragementMessage ?? '',
            radarData: cached.radarData,
            subjectScores: cached.subjectScores,
            weaknessTop3: cached.weaknessTop3,
          };
        }
      }
    } catch {
      // IndexedDB 읽기 실패 시 캐시 스킵 → 아래에서 Firestore 조회
    }
  }

  const [trendResult, dashboardResult] = await Promise.all([
    fetchUserTrendData(uid, certCode),
    fetchDashboardStats(uid, certCode),
  ]);

  // 실력진단 3회 미만이면 recentPassRate는 null 유지. 3회 이상인데 0이면 트렌드 점수로 보정
  let savedPassRate: number | null = trendResult.recentPassRate;
  if (trendResult.diagnosticProgress?.status === 'completed' && savedPassRate === 0 && Array.isArray(trendResult.trendData) && trendResult.trendData.length > 0) {
    const trend = trendResult.trendData;
    for (let i = trend.length - 1; i >= 0; i--) {
      const s = trend[i]?.score;
      if (s != null && s > 0) {
        savedPassRate = s;
        break;
      }
    }
  }

  const result: MyPageCachedData = {
    ...trendResult,
    recentPassRate: savedPassRate,
    ...dashboardResult,
  };

  // 캐시 저장 실패해도 데이터는 반환 (IndexedDB 오류 시에도 대시보드 데이터 표시)
  const now = Date.now();
  try {
    await setUserStatsCache({
      key: getUserStatsCacheKey(uid, certCode),
      uid,
      certCode,
      trendData: trendResult.trendData,
      recentPassRate: savedPassRate,
      diagnosticProgress: trendResult.diagnosticProgress,
      encouragementMessage: trendResult.encouragementMessage,
      radarData: dashboardResult.radarData,
      subjectScores: dashboardResult.subjectScores,
      weaknessTop3: dashboardResult.weaknessTop3,
      lastUpdated: now,
    });
    const examRecords: ExamResultsCacheRecord[] = trendResult.trendData.map((t, i) => ({
      id: `${uid}_${t.examId ?? `exam_${i}`}`,
      uid,
      certCode,
      examId: t.examId ?? `exam_${i}`,
      resultData: {
        roundId: t.roundId ?? null,
        predicted_pass_rate: t.score,
        totalQuestions: t.totalQuestions,
        correctCount: t.correctCount,
        submittedAt: now - (trendResult.trendData.length - i) * 60000,
      },
      timestamp: now - (trendResult.trendData.length - i) * 60000,
    }));
    await putExamResultsCacheBulk(examRecords);
  } catch {
    // IndexedDB/캐시 오류 시 무시 — 화면에는 Firestore 데이터 반환
  }

  return result;
}

/** 트렌드만 캐시에서 가져오기 (리스트 페이징 시 캐시에 있으면 사용) */
export async function getCachedTrendDataOnly(
  uid: string,
  certCode: string
): Promise<TrendDataItem[] | null> {
  const cached = await getUserStatsCache(uid, certCode);
  if (cached && isUserStatsCacheValid(cached)) return cached.trendData;
  return null;
}
