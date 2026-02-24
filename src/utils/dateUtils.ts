import type { User } from '../types';
import type { CertificationInfo } from '../types';
import { CERTIFICATIONS } from '../constants';
import { EXAM_SCHEDULES, EXAM_SCHEDULE_DATES } from '../constants';

/** 오늘 12:00 KST(한국시간) 기준 날짜 문자열 YYYY-MM-DD (로컬 기준 근사) */
function getTodayKSTDateString(): string {
  const now = new Date();
  const kstOffset = 9 * 60;
  const localOffset = now.getTimezoneOffset();
  const kst = new Date(now.getTime() + (kstOffset + localOffset) * 60 * 1000);
  const y = kst.getFullYear();
  const m = String(kst.getMonth() + 1).padStart(2, '0');
  const d = String(kst.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** YYYY-MM-DD 문자열을 12:00 KST 기준 날짜(ms)로 해석 */
function parseExamDate(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1).getTime();
}

/**
 * 자격증의 다음 시험일까지 D-Day (12:00 KST 컷오프).
 * 오늘 시험일이면 0, 지나면 음수, 없으면 null.
 */
export function getDaysLeft(certId: string): number | null {
  const cert = CERTIFICATIONS.find((c) => c.id === certId);
  const code = cert?.code;
  if (!code || !EXAM_SCHEDULES[code]?.length) return null;
  const scheduleDates = EXAM_SCHEDULES[code]
    .map((s) => ({ id: s.id, label: s.label, date: EXAM_SCHEDULE_DATES[s.id] ?? '' }))
    .filter((s) => s.date)
    .map((s) => ({ ...s, ms: parseExamDate(s.date) }));
  const todayStr = getTodayKSTDateString();
  const todayMs = parseExamDate(todayStr);
  for (const s of scheduleDates.sort((a, b) => a.ms - b.ms)) {
    if (s.ms >= todayMs) {
      const days = Math.floor((s.ms - todayMs) / (24 * 60 * 60 * 1000));
      return days;
    }
  }
  const last = scheduleDates[scheduleDates.length - 1];
  if (last) {
    const days = Math.floor((last.ms - todayMs) / (24 * 60 * 60 * 1000));
    return days;
  }
  return null;
}

/**
 * 특정 시험일(examDate YYYY-MM-DD)까지 D-Day.
 * 오늘 시험일이면 0, 지나면 음수.
 */
export function getDaysLeftForDate(examDate: string): number | null {
  if (!examDate || typeof examDate !== 'string') return null;
  const todayStr = getTodayKSTDateString();
  const todayMs = parseExamDate(todayStr);
  const examMs = parseExamDate(examDate);
  return Math.floor((examMs - todayMs) / (24 * 60 * 60 * 1000));
}

/**
 * 자격증의 가장 가까운 다음 시험일 정보.
 * 없으면 null (다음 연도 일정 미등록 등).
 */
export function getNearestExamDate(certId: string): { label: string; dateId?: string } | null {
  const cert = CERTIFICATIONS.find((c) => c.id === certId);
  const code = cert?.code;
  if (!code || !EXAM_SCHEDULES[code]?.length) return null;
  const scheduleDates = EXAM_SCHEDULES[code]
    .map((s) => ({ id: s.id, label: s.label, date: EXAM_SCHEDULE_DATES[s.id] ?? '' }))
    .filter((s) => s.date)
    .map((s) => ({ ...s, ms: parseExamDate(s.date) }));
  const todayStr = getTodayKSTDateString();
  const todayMs = parseExamDate(todayStr);
  for (const s of scheduleDates.sort((a, b) => a.ms - b.ms)) {
    if (s.ms >= todayMs) return { label: s.label, dateId: s.id };
  }
  const next = scheduleDates.sort((a, b) => a.ms - b.ms)[0];
  return next ? { label: next.label, dateId: next.id } : null;
}

/**
 * 구매한 회차 목록 (재수강 시 여러 개). purchasedScheduleIdsByCert 또는 passesByCert 기반.
 */
export function getPurchasedSchedulesForCert(
  user: User | null,
  certId: string
): { dateId: string; label: string; examDate: string }[] {
  if (!user) return [];
  const cert = CERTIFICATIONS.find((c) => c.id === certId);
  const code = cert?.code;
  if (!code || !EXAM_SCHEDULES[code]) return [];

  const ids: string[] = [];
  // 1) purchasedScheduleIdsByCert 우선
  const purchasedIds = user.purchasedScheduleIdsByCert?.[certId];
  if (purchasedIds?.length) {
    ids.push(...purchasedIds);
  } else {
    // 2) passesByCert에 examDate가 있으면 해당 schedule 추가
    const pass = user.passesByCert?.[certId];
    if (pass?.examDate) {
      const dateId = Object.entries(EXAM_SCHEDULE_DATES).find(([, d]) => d === pass.examDate)?.[0];
      if (dateId) ids.push(dateId);
    }
    // 3) 없으면 nearest 1개만 (기본값)
    const nearest = getNearestExamDate(certId);
    if (nearest?.dateId) ids.push(nearest.dateId);
  }

  const seen = new Set<string>();
  return ids
    .filter((id) => {
      if (seen.has(id)) return false;
      seen.add(id);
      return EXAM_SCHEDULES[code].some((s) => s.id === id);
    })
    .map((id) => {
      const s = EXAM_SCHEDULES[code].find((x) => x.id === id);
      const date = EXAM_SCHEDULE_DATES[id] ?? '';
      return {
        dateId: id,
        label: s?.label ?? id,
        examDate: date,
      };
    })
    .sort((a, b) => parseExamDate(a.examDate) - parseExamDate(b.examDate));
}

/**
 * 특정 schedule(dateId)에 대한 D-Day.
 */
export function getDaysLeftForDateId(certId: string, dateId: string | undefined): number | null {
  if (!dateId) return getDaysLeft(certId);
  const date = EXAM_SCHEDULE_DATES[dateId];
  return date ? getDaysLeftForDate(date) : getDaysLeft(certId);
}

/**
 * certification_info.exam_schedules 기준 가장 가까운 시험일 정보.
 * 표시: "필기 제12회", D-44, "2026년 4월 4일"
 */
export function getNearestExamFromCertInfo(certInfo: CertificationInfo | null): {
  round: number;
  type: string;
  examDate: string;
  resultAnnouncementDate: string;
  daysLeft: number | null;
  label: string;
} | null {
  const schedules = certInfo?.exam_schedules;
  if (!schedules?.length) return null;
  const todayStr = getTodayKSTDateString();
  const todayMs = parseExamDate(todayStr);
  const withMs = schedules
    .map((s) => ({ ...s, ms: parseExamDate(s.examDate) }))
    .sort((a, b) => a.ms - b.ms);
  for (const s of withMs) {
    if (s.ms >= todayMs) {
      const daysLeft = Math.floor((s.ms - todayMs) / (24 * 60 * 60 * 1000));
      const typeStr = s.type ?? '';
      return {
        round: s.round,
        type: s.type,
        examDate: s.examDate,
        resultAnnouncementDate: s.resultAnnouncementDate,
        daysLeft,
        label: typeStr ? `${typeStr} 제${s.round}회` : `제${s.round}회`,
      };
    }
  }
  const last = withMs[withMs.length - 1];
  if (!last) return null;
  const daysLeft = Math.floor((last.ms - todayMs) / (24 * 60 * 60 * 1000));
  const lastTypeStr = last.type ?? '';
  return {
    round: last.round,
    type: last.type,
    examDate: last.examDate,
    resultAnnouncementDate: last.resultAnnouncementDate,
    daysLeft,
    label: lastTypeStr ? `${lastTypeStr} 제${last.round}회` : `제${last.round}회`,
  };
}

/** examDate "2026-04-04" → "2026년 4월 4일" */
export function formatExamDateDisplay(examDate: string): string {
  if (!examDate || typeof examDate !== 'string') return '';
  const [y, m, d] = examDate.split('-').map((x) => parseInt(x, 10));
  if (Number.isNaN(y)) return examDate;
  return `${y}년 ${m ?? 0}월 ${d ?? 0}일`;
}

/**
 * 해당 자격증에 대해 유료(열공모드) 기능이 열려 있는지.
 * 이용권(passesByCert) active 우선, 레거시: paidCertIds 포함·expiredCertIds 미포함.
 */
export function isPremiumUnlocked(user: User | null, certId: string): boolean {
  if (!user) return false;
  const pass = user.passesByCert?.[certId];
  if (pass?.status === 'active') return true;
  return (user.paidCertIds?.includes(certId) ?? false) && !user.expiredCertIds?.includes(certId);
}
