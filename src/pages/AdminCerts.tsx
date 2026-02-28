import React, { useState, useMemo, useEffect } from 'react';
import { Plus, Save, X } from 'lucide-react';
import { CERTIFICATIONS, EXAM_SCHEDULES, EXAM_SCHEDULE_DATES, PROBLEM_TYPE_LABELS } from '../constants';
import { getCertDisplayName } from '../services/gradingService';
import { useAllCertificationInfos } from '../hooks/useCertificationInfo';
import { saveCertExamSchedules, fetchCertLearnerCounts, fetchExamSchedulesFromConfig } from '../services/adminService';
import type { ExamScheduleItem } from '../types';

const today = new Date().toISOString().slice(0, 10);

type ScheduleRow = { id: string } & ExamScheduleItem;

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function buildScheduleRows(certCode: string, list: ExamScheduleItem[]): ScheduleRow[] {
  return list.map((s, i) => ({
    id: `firestore-${certCode}-${i}-${s.examDate}`,
    year: s.year,
    round: s.round,
    type: s.type ?? '필기',
    examDate: s.examDate,
    resultAnnouncementDate: s.resultAnnouncementDate ?? addDays(s.examDate, 20),
  }));
}

function buildFallbackSchedules(certCode: string): ScheduleRow[] {
  const fallback = EXAM_SCHEDULES[certCode] ?? [];
  return fallback.map((s, i) => ({
    id: s.id,
    year: new Date().getFullYear(),
    round: i + 1,
    type: '필기',
    examDate: EXAM_SCHEDULE_DATES[s.id] ?? '',
    resultAnnouncementDate: addDays(EXAM_SCHEDULE_DATES[s.id] ?? today, 20),
  }));
}

export function AdminCerts() {
  const { certInfos, loading } = useAllCertificationInfos();
  const [editMode, setEditMode] = useState(false);
  const [schedules, setSchedules] = useState<Record<string, ScheduleRow[]>>({});
  /** 수정 모드 진입 시점의 스냅샷 (수정 여부 비교용) */
  const [schedulesSnapshotAtEdit, setSchedulesSnapshotAtEdit] = useState<Record<string, ScheduleRow[]> | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, { learning: number; paying: number; graduated: number }> | null>(null);
  const [countsLoading, setCountsLoading] = useState(true);

  const certsInOrder = useMemo(
    () => CERTIFICATIONS.filter((c) => ['BIGDATA', 'SQLD', 'ADSP'].includes(c.code)),
    []
  );

  // config 문서에서 exam_schedules 직접 조회 (저장 후 새로고침 시에도 반영되도록)
  useEffect(() => {
    let cancelled = false;
    const codes = certsInOrder.map((c) => c.code);
    Promise.all(codes.map((code) => fetchExamSchedulesFromConfig(code)))
      .then((results) => {
        if (cancelled) return;
        const next: Record<string, ScheduleRow[]> = {};
        codes.forEach((code, i) => {
          const list = results[i];
          next[code] = list?.length
            ? buildScheduleRows(code, list)
            : buildFallbackSchedules(code);
        });
        setSchedules(next);
      })
      .catch(() => {
        if (!cancelled) {
          const next: Record<string, ScheduleRow[]> = {};
          certsInOrder.forEach((c) => {
            next[c.code] = buildFallbackSchedules(c.code);
          });
          setSchedules(next);
        }
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    setCountsLoading(true);
    fetchCertLearnerCounts()
      .then(setCounts)
      .catch(() => setCounts(null))
      .finally(() => setCountsLoading(false));
  }, []);

  const addScheduleRow = (certCode: string) => {
    const list = schedules[certCode] ?? [];
    const nextRound = list.length > 0 ? Math.max(...list.map((r) => r.round)) + 1 : 1;
    setSchedules((prev) => ({
      ...prev,
      [certCode]: [
        ...(prev[certCode] ?? []),
        {
          id: `new-${Date.now()}`,
          year: new Date().getFullYear(),
          round: nextRound,
          type: '필기',
          examDate: '',
          resultAnnouncementDate: '',
        },
      ],
    }));
  };

  const updateScheduleRow = (certCode: string, id: string, field: 'examDate' | 'resultAnnouncementDate', value: string) => {
    setSchedules((prev) => ({
      ...prev,
      [certCode]: (prev[certCode] ?? []).map((row) =>
        row.id === id ? { ...row, [field]: value } : row
      ),
    }));
  };

  const removeScheduleRow = (certCode: string, id: string) => {
    setSchedules((prev) => ({
      ...prev,
      [certCode]: (prev[certCode] ?? []).filter((r) => r.id !== id),
    }));
  };

  const serializeSchedulesForCompare = (s: Record<string, ScheduleRow[]>) => {
    const out: Record<string, { year: number; round: number; type: string; examDate: string; resultAnnouncementDate: string }[]> = {};
    certsInOrder.forEach((cert) => {
      const rows = s[cert.code] ?? [];
      out[cert.code] = rows
        .filter((r) => r.examDate.trim() !== '')
        .map(({ year, round, type, examDate, resultAnnouncementDate }) => ({
          year,
          round,
          type,
          examDate,
          resultAnnouncementDate: resultAnnouncementDate || addDays(examDate, 20),
        }));
    });
    return JSON.stringify(out);
  };

  const handleSave = async () => {
    setSaveError(null);
    if (schedulesSnapshotAtEdit != null && serializeSchedulesForCompare(schedules) === serializeSchedulesForCompare(schedulesSnapshotAtEdit)) {
      alert('수정한 내용이 없습니다.');
      return;
    }
    setSaving(true);
    try {
      for (const cert of certsInOrder) {
        const rows = schedules[cert.code] ?? [];
        const valid = rows.filter((r) => r.examDate.trim() !== '');
        const items: ExamScheduleItem[] = valid.map(({ id: _id, ...item }) => ({
          year: item.year,
          round: item.round,
          type: item.type,
          examDate: item.examDate,
          resultAnnouncementDate: item.resultAnnouncementDate || addDays(item.examDate, 20),
        }));
        if (items.length > 0) {
          await saveCertExamSchedules(cert.code, items);
        }
      }
      setEditMode(false);
      setSchedulesSnapshotAtEdit(null);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : '저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 md:p-8 max-w-5xl pb-24">
      <h1 className="text-2xl font-black text-slate-900 mb-6">자격증 관리</h1>

      {saveError && (
        <div className="mb-4 p-4 rounded-xl bg-red-50 border border-red-200 text-red-800 text-sm">
          {saveError}
        </div>
      )}

      <div className="space-y-8">
        {certsInOrder.map((cert) => {
          const displayName = getCertDisplayName(cert, certInfos[cert.code] ?? null) || cert.name;
          const rows = schedules[cert.code] ?? [];

          return (
            <div
              key={cert.id}
              className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden"
            >
              <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/80">
                <h2 className="text-lg font-black text-slate-900">{displayName}</h2>
              </div>

              <div className="p-6 space-y-6">
                {/* 자격증 정보: 시험회차, 시험일자 */}
                <div>
                  <h3 className="text-sm font-bold text-slate-600 mb-3">시험회차 · 시험일자</h3>
                  <div className="space-y-2">
                    {rows.map((row) => {
                      const isPast = row.examDate && row.examDate < today;
                      const label = `${row.type || '필기'} 제${row.round}회`;
                      return (
                        <div
                          key={row.id}
                          className="flex flex-wrap items-center gap-3 py-2 px-3 rounded-xl bg-slate-50 border border-slate-100"
                        >
                          <span className="min-w-[120px] text-sm font-medium text-slate-700">
                            {label}
                          </span>
                          {editMode ? (
                            <>
                              <input
                                type="date"
                                value={row.examDate}
                                onChange={(e) => updateScheduleRow(cert.code, row.id, 'examDate', e.target.value)}
                                disabled={isPast}
                                className="px-3 py-2 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-[#0034d3]/50 focus:border-[#0034d3] disabled:bg-slate-100 disabled:text-slate-500"
                              />
                              {isPast && (
                                <span className="text-xs text-slate-500">지난 일자 (수정 불가)</span>
                              )}
                              {row.id.startsWith('new-') && (
                                <button
                                  type="button"
                                  onClick={() => removeScheduleRow(cert.code, row.id)}
                                  className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-200 hover:text-slate-600"
                                  aria-label="삭제"
                                >
                                  <X size={16} />
                                </button>
                              )}
                            </>
                          ) : (
                            <span className="text-sm text-slate-600">
                              {row.examDate || '—'}
                            </span>
                          )}
                        </div>
                      );
                    })}
                    {editMode && (
                      <button
                        type="button"
                        onClick={() => addScheduleRow(cert.code)}
                        className="flex items-center gap-2 px-4 py-2 rounded-xl border border-dashed border-slate-300 text-slate-600 hover:bg-slate-50 hover:border-[#0034d3]/50 hover:text-[#0034d3] text-sm font-semibold transition-colors"
                      >
                        <Plus size={18} /> 회차 추가
                      </button>
                    )}
                  </div>
                </div>

                {/* 문제유형 */}
                <div>
                  <h3 className="text-sm font-bold text-slate-600 mb-2">문제유형</h3>
                  <div className="flex flex-wrap gap-2">
                    {PROBLEM_TYPE_LABELS.map((label) => (
                      <span
                        key={label}
                        className="px-3 py-1.5 rounded-lg bg-[#99ccff]/40 text-slate-700 text-sm font-medium"
                      >
                        {label}
                      </span>
                    ))}
                  </div>
                </div>

                {/* 학습자 수(자격증 활성화) / 결제 학습자 수(만료 제외) / 졸업한 학습자 수(만료) */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4">
                    <p className="text-xs font-bold text-slate-500 uppercase mb-1">현재 학습중인 학습자 수</p>
                    <p className="text-2xl font-black text-slate-900">
                      {countsLoading ? '…' : (counts?.[cert.code]?.learning ?? 0)}
                    </p>
                    <p className="text-xs text-slate-400 mt-1">자격증 시험 활성화된 회원</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4">
                    <p className="text-xs font-bold text-slate-500 uppercase mb-1">결제중인 학습자 수</p>
                    <p className="text-2xl font-black text-[#0034d3]">
                      {countsLoading ? '…' : (counts?.[cert.code]?.paying ?? 0)}
                    </p>
                    <p className="text-xs text-slate-400 mt-1">만료 제외</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4">
                    <p className="text-xs font-bold text-slate-500 uppercase mb-1">졸업한 학습자 수</p>
                    <p className="text-2xl font-black text-slate-600">
                      {countsLoading ? '…' : (counts?.[cert.code]?.graduated ?? 0)}
                    </p>
                    <p className="text-xs text-slate-400 mt-1">이용권 만료 회원</p>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 우측 하단 고정: 수정하기 / 저장하기·취소 */}
      <div className="fixed bottom-6 right-6 flex items-center gap-3">
        {editMode ? (
          <>
            <button
              type="button"
              onClick={() => { setEditMode(false); setSchedulesSnapshotAtEdit(null); }}
              disabled={saving}
              className="px-5 py-2.5 rounded-xl border border-slate-300 text-slate-600 font-bold text-sm hover:bg-slate-50 disabled:opacity-50"
            >
              취소
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#0034d3] text-white font-bold text-sm hover:bg-[#003087] disabled:opacity-50"
            >
              <Save size={18} />
              {saving ? '저장 중…' : '저장하기'}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => {
              setEditMode(true);
              setSchedulesSnapshotAtEdit(JSON.parse(JSON.stringify(schedules)));
            }}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-800 text-white font-bold text-sm hover:bg-slate-700"
          >
            수정하기
          </button>
        )}
      </div>
    </div>
  );
}
