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
    const cached = await getUserStatsCache(uid, certCode);
    if (cached && isUserStatsCacheValid(cached)) {
      // 이전 오류로 빈 배열이 캐시된 경우 재요청 (합격률·학습기록 등이 안 보이는 현상 방지)
      const hasTrend = Array.isArray(cached.trendData) && cached.trendData.length > 0;
      if (hasTrend || (Array.isArray(cached.radarData) && cached.radarData.length > 0)) {
        let passRate = cached.recentPassRate;
        // 다른 화면 갔다 왔을 때 캐시만 쓰면 0%로 나오는 현상 방지: 트렌드가 있으면 최근 회차 점수로 보정
        if (passRate === 0 && hasTrend) {
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
          radarData: cached.radarData,
          subjectScores: cached.subjectScores,
          weaknessTop3: cached.weaknessTop3,
        };
      }
    }
  }

  const [trendResult, dashboardResult] = await Promise.all([
    fetchUserTrendData(uid, certCode),
    fetchDashboardStats(uid, certCode),
  ]);

  // Firestore에서 predicted_pass_rate가 비어 있으면 0으로 내려올 수 있음 → 트렌드 최근 회차 점수로 보정 후 캐시 저장
  let savedPassRate = trendResult.recentPassRate;
  if (savedPassRate === 0 && Array.isArray(trendResult.trendData) && trendResult.trendData.length > 0) {
    const trend = trendResult.trendData;
    for (let i = trend.length - 1; i >= 0; i--) {
      const s = trend[i]?.score;
      if (s != null && s > 0) {
        savedPassRate = s;
        break;
      }
    }
  }

  const now = Date.now();
  await setUserStatsCache({
    key: getUserStatsCacheKey(uid, certCode),
    uid,
    certCode,
    trendData: trendResult.trendData,
    recentPassRate: savedPassRate,
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

  return {
    ...trendResult,
    recentPassRate: savedPassRate,
    ...dashboardResult,
  };
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
