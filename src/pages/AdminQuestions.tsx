import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  getRoundsForCert,
  getSubjectsForCertAndRound,
  getFilteredQuestionIds,
  getIndexItemByQid,
  fetchQuestionsForAdmin,
  updateQuestionInFirestore,
  uploadQuestionImage,
  clearQuestionImage,
} from '../services/adminQuestionService';
import { getQuestionIndexFromCache, syncQuestionIndex, type QuestionIndexItem } from '../services/db/localCacheDB';
import { CERTIFICATIONS } from '../constants';
import { RichText } from '../components/RichText';
import type { Question } from '../types';

const PAGE_SIZE = 20;
const CERT_QUESTIONS = ['BIGDATA'] as const; // 현재 문제 데이터 있는 자격증만

/** 지문/해설 검색용: HTML·LaTeX 제거, 엔티티 복원, 공백 정규화. "11</b>회", "11 회" 등도 "11회" 검색에 매칭 */
function normalizeTextForSearch(html: string): string {
  if (!html || typeof html !== 'string') return '';
  let s = html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\$\$[^$]*\$\$/g, ' ')
    .replace(/\$[^$]*\$/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
  s = s.replace(/(\d)\s+([가-힣a-zA-Z])/g, '$1$2');
  return s.toLowerCase();
}

export function AdminQuestions() {
  const [certCode, setCertCode] = useState<string>(CERT_QUESTIONS[0]);
  const [round, setRound] = useState<number>(1);
  const [subject, setSubject] = useState<number>(1);
  const [rounds, setRounds] = useState<number[]>([]);
  const [subjects, setSubjects] = useState<{ subject: number; name: string }[]>([]);
  const [allQids, setAllQids] = useState<string[]>([]);
  const [onlyWithImage, setOnlyWithImage] = useState(false);
  const [filteredByImageQids, setFilteredByImageQids] = useState<string[] | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [indexItems, setIndexItems] = useState<QuestionIndexItem[] | null>(null);
  const [pageQuestions, setPageQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [viewQid, setViewQid] = useState<string | null>(null);
  const [editQid, setEditQid] = useState<string | null>(null);
  const [uploadQid, setUploadQid] = useState<string | null>(null);
  const [imageDeletingQid, setImageDeletingQid] = useState<string | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [searchTarget, setSearchTarget] = useState<'지문' | '해설'>('지문');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [keywordFilteredQids, setKeywordFilteredQids] = useState<string[] | null>(null);
  const [keywordSearching, setKeywordSearching] = useState(false);
  const [exportingJson, setExportingJson] = useState(false);

  const certOptions = useMemo(
    () => CERTIFICATIONS.filter((c) => CERT_QUESTIONS.includes(c.code as typeof CERT_QUESTIONS[number])),
    []
  );

  useEffect(() => {
    if (!certCode) return;
    setLoading(true);
    getRoundsForCert(certCode)
      .then((r) => {
        setRounds(r);
        setRound((prev) => (r.includes(prev) ? prev : r[0] ?? 1));
      })
      .finally(() => setLoading(false));
  }, [certCode]);

  useEffect(() => {
    if (!certCode) return;
    setLoading(true);
    getSubjectsForCertAndRound(certCode, round)
      .then((s) => {
        setSubjects(s);
        setSubject((prev) => (s.some((x) => x.subject === prev) ? prev : s[0]?.subject ?? 1));
      })
      .finally(() => setLoading(false));
  }, [certCode, round]);

  const runSearch = useMemo(
    () => async () => {
      if (!certCode || subjects.length === 0) return;
      setLoading(true);
      setSearched(true);
      try {
        const [, qids] = await Promise.all([
          syncQuestionIndex(certCode),
          getFilteredQuestionIds(certCode, round, subject),
        ]);
        setAllQids(qids);
        setCurrentPage(1);
        setKeywordFilteredQids(null);
        const items = await getQuestionIndexFromCache(certCode);
        setIndexItems(items);
        setFilteredByImageQids(null);
      } finally {
        setLoading(false);
      }
    },
    [certCode, round, subject, subjects.length]
  );

  const runKeywordSearch = useCallback(async () => {
    const kw = searchKeyword.trim();
    if (!searched || allQids.length === 0) return;
    if (!kw) {
      setKeywordFilteredQids(null);
      setCurrentPage(1);
      return;
    }
    setKeywordSearching(true);
    try {
      const batchSize = 100;
      const matched: string[] = [];
      const field = searchTarget === '지문' ? 'content' : 'explanation';
      const normalizedKw = normalizeTextForSearch(kw);
      if (!normalizedKw) {
        setKeywordFilteredQids(null);
        setCurrentPage(1);
        setKeywordSearching(false);
        return;
      }
      for (let i = 0; i < allQids.length; i += batchSize) {
        const chunk = allQids.slice(i, i + batchSize);
        const questions = await fetchQuestionsForAdmin(certCode, chunk);
        questions.forEach((q) => {
          const raw = (searchTarget === '지문' ? q.content : q.explanation) ?? '';
          const normalized = normalizeTextForSearch(raw);
          if (normalized.includes(normalizedKw)) matched.push(q.id);
        });
      }
      setKeywordFilteredQids(matched);
      setCurrentPage(1);
    } finally {
      setKeywordSearching(false);
    }
  }, [certCode, searchKeyword, searchTarget, searched, allQids]);

  const displayQids = useMemo(() => {
    const base = keywordFilteredQids ?? allQids;
    if (onlyWithImage && filteredByImageQids) return filteredByImageQids;
    return base;
  }, [allQids, onlyWithImage, filteredByImageQids, keywordFilteredQids]);

  const totalPages = Math.max(1, Math.ceil(displayQids.length / PAGE_SIZE));
  const pageQids = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return displayQids.slice(start, start + PAGE_SIZE);
  }, [displayQids, currentPage]);

  useEffect(() => {
    if (!searched || pageQids.length === 0) {
      setPageQuestions([]);
      return;
    }
    setLoading(true);
    fetchQuestionsForAdmin(certCode, pageQids)
      .then(setPageQuestions)
      .finally(() => setLoading(false));
  }, [searched, certCode, pageQids.join(',')]);

  useEffect(() => {
    if (!searched || !onlyWithImage || allQids.length === 0) return;
    setLoading(true);
    const batch = 100;
    const withImage: string[] = [];
    (async () => {
      for (let i = 0; i < allQids.length; i += batch) {
        const chunk = allQids.slice(i, i + batch);
        const questions = await fetchQuestionsForAdmin(certCode, chunk);
        questions.forEach((q) => {
          if (q.imageUrl) withImage.push(q.id);
        });
      }
      setFilteredByImageQids(withImage);
      setCurrentPage(1);
    })().finally(() => setLoading(false));
  }, [searched, onlyWithImage, certCode, allQids.join(',')]);

  const viewQuestion = viewQid ? pageQuestions.find((q) => q.id === viewQid) : null;
  const editQuestion = editQid ? pageQuestions.find((q) => q.id === editQid) : null;

  return (
    <div className="p-6 md:p-8 max-w-[94rem]">
      <h1 className="text-2xl font-black text-slate-900 mb-6">문제 관리</h1>

      <div className="mb-4 rounded-2xl border border-slate-200 bg-slate-50/50 p-4">
        <p className="text-sm font-bold text-slate-600 mb-3">조건 조회</p>
        <div className="flex flex-wrap items-center gap-4 mb-3">
          <label className="flex items-center gap-2">
            <span className="text-sm font-bold text-slate-600">1. 자격증</span>
            <select
              value={certCode}
              onChange={(e) => setCertCode(e.target.value)}
              className="px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white"
            >
              {certOptions.map((c) => (
                <option key={c.id} value={c.code}>{c.name}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            <span className="text-sm font-bold text-slate-600">2. 모의고사회차</span>
            <select
              value={round}
              onChange={(e) => setRound(Number(e.target.value))}
              disabled={rounds.length === 0}
              className="px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white"
            >
              {rounds.map((r) => (
                <option key={r} value={r}>{r === 99 ? '라운드 99' : `${r}회차`}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            <span className="text-sm font-bold text-slate-600">3. 과목</span>
            <select
              value={subject}
              onChange={(e) => setSubject(Number(e.target.value))}
              disabled={subjects.length === 0}
              className="px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white"
            >
              {subjects.map((s) => (
                <option key={s.subject} value={s.subject}>{s.subject}. {s.name}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={onlyWithImage}
              onChange={(e) => setOnlyWithImage(e.target.checked)}
              className="w-4 h-4 rounded border-slate-300 text-[#0034d3]"
            />
            <span className="text-sm font-medium text-slate-700">이미지 문제만 모아보기</span>
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <span className="text-sm font-bold text-slate-600">4. 지문/해설 검색</span>
          <select
            value={searchTarget}
            onChange={(e) => setSearchTarget(e.target.value as '지문' | '해설')}
            className="px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white min-w-[5rem]"
          >
            <option value="지문">지문</option>
            <option value="해설">해설</option>
          </select>
          <input
            type="text"
            value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
            placeholder="검색어 입력"
            className="px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white min-w-[12rem] max-w-[20rem] placeholder:text-slate-400"
          />
          <button
            type="button"
            onClick={runKeywordSearch}
            disabled={!searched || allQids.length === 0 || keywordSearching}
            className="px-4 py-2 rounded-xl bg-slate-600 text-white font-semibold text-sm hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {keywordSearching ? '검색 중...' : '키워드 검색'}
          </button>
          {keywordFilteredQids !== null && (
            <span className="text-xs text-slate-500">
              {searchKeyword.trim() ? `"${searchKeyword.trim()}" ${searchTarget} 검색: ${keywordFilteredQids.length}건` : ''}
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={runSearch}
            disabled={loading || subjects.length === 0}
            className="flex-1 min-w-[120px] py-3 rounded-xl bg-[#0034d3] text-white font-bold text-sm hover:bg-[#003087] disabled:opacity-50"
          >
            검색
          </button>
          <button
            type="button"
            onClick={async () => {
              if (!searched || displayQids.length === 0) return;
              setExportingJson(true);
              try {
                const batchSize = 100;
                const out: Record<string, unknown> = {};
                for (let i = 0; i < displayQids.length; i += batchSize) {
                  const chunk = displayQids.slice(i, i + batchSize);
                  const questions = await fetchQuestionsForAdmin(certCode, chunk);
                  questions.forEach((q) => {
                    const answer1 = q.answer ?? 1;
                    const opts = q.options ?? [];
                    const answerIdx = Math.max(0, Math.min(opts.length - 1, answer1 - 1));
                    out[q.id] = {
                      question_text: q.content ?? '',
                      options: opts,
                      answer_idx: answerIdx,
                      explanation: q.explanation ?? '',
                      wrong_feedback: q.wrongFeedback ?? undefined,
                      image: q.imageUrl ?? undefined,
                      table_data: q.tableData ?? undefined,
                      core_concept: q.core_concept ?? undefined,
                      subject_number: q.subject_number ?? undefined,
                      problem_types: q.problem_types ?? undefined,
                      tags: q.tags ?? [],
                      trend: q.trend ?? undefined,
                      difficulty_level: q.difficulty_level ?? undefined,
                      core_id: q.core_id ?? undefined,
                      sub_core_id: q.sub_core_id ?? undefined,
                      round: q.round ?? undefined,
                    };
                  });
                }
                const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `questions_export_${certCode}_${Date.now()}.json`;
                a.click();
                URL.revokeObjectURL(url);
              } finally {
                setExportingJson(false);
              }
            }}
            disabled={!searched || displayQids.length === 0 || exportingJson}
            className="shrink-0 px-5 py-3 rounded-xl bg-emerald-600 text-white font-semibold text-sm hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {exportingJson ? '내보내는 중...' : 'JSON 내보내기'}
          </button>
          <button
            type="button"
            onClick={() => alert('추후 구현입니다.')}
            className="shrink-0 px-5 py-3 rounded-xl bg-slate-100 text-slate-600 font-semibold text-sm hover:bg-slate-200 transition-colors"
          >
            문제 추가
          </button>
        </div>
      </div>

      {saveError && (
        <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-800 text-sm">{saveError}</div>
      )}

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase w-12">No</th>
                <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase min-w-[160px] w-40">고유값</th>
                <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase w-28 max-w-[120px]">개념명</th>
                <th className="px-2 py-3 text-xs font-bold text-slate-500 uppercase w-32">이미지</th>
                <th className="px-2 py-3 text-xs font-bold text-slate-500 uppercase w-14">테이블</th>
                <th className="px-2 py-3 text-xs font-bold text-slate-500 uppercase w-20">이미지</th>
                <th className="px-2 py-3 text-xs font-bold text-slate-500 uppercase w-20">문제보기</th>
                <th className="px-2 py-3 text-xs font-bold text-slate-500 uppercase w-20">문제수정</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {!searched ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-500">자격증·회차·과목을 선택한 뒤 <strong>검색</strong> 버튼을 눌러 주세요.</td></tr>
              ) : loading && pageQuestions.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-500">로딩 중...</td></tr>
              ) : pageQuestions.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-500">조회된 문제가 없습니다.</td></tr>
              ) : (
                pageQuestions.map((q, idx) => {
                  const rowIndex = (currentPage - 1) * PAGE_SIZE + idx + 1;
                  return (
                    <tr key={q.id} className="hover:bg-slate-50/50">
                      <td className="px-4 py-3 text-sm text-slate-600">{rowIndex}</td>
                      <td className="px-4 py-3 font-mono text-sm text-slate-900 min-w-[140px] max-w-[220px] truncate" title={q.id}>{q.id}</td>
                      <td className="px-4 py-3 text-sm text-slate-700 max-w-[110px] truncate" title={q.core_concept ?? ''}>
                        {q.core_concept ?? '—'}
                      </td>
                      <td className="px-2 py-3">
                        <ImageNameCell imageValue={q.imageUrl} />
                      </td>
                      <td className="px-2 py-3 text-center">
                        {(() => {
                          const hasTable = q.tableData != null && (typeof q.tableData === 'string' ? q.tableData.trim() !== '' : true);
                          return hasTable ? <span className="text-emerald-600 font-bold">O</span> : <span className="text-slate-400 font-medium">X</span>;
                        })()}
                      </td>
                      <td className="px-2 py-3">
                        <ImageViewCell
                          qId={q.id}
                          imageUrl={q.imageUrl}
                          certCode={certCode}
                          onUploadStart={() => setUploadQid(q.id)}
                          onUploadEnd={() => setUploadQid(null)}
                          onRefresh={() => {
                            fetchQuestionsForAdmin(certCode, [q.id]).then(([nq]) => {
                              if (nq) setPageQuestions((prev) => prev.map((x) => (x.id === q.id ? nq : x)));
                            });
                          }}
                          onClearImage={async () => {
                            setImageDeletingQid(q.id);
                            try {
                              await clearQuestionImage(certCode, q.id);
                              const [nq] = await fetchQuestionsForAdmin(certCode, [q.id]);
                              if (nq) setPageQuestions((prev) => prev.map((x) => (x.id === q.id ? nq : x)));
                            } finally {
                              setImageDeletingQid(null);
                            }
                          }}
                          uploading={uploadQid === q.id}
                          deleting={imageDeletingQid === q.id}
                        />
                      </td>
                      <td className="px-2 py-3">
                        <button
                          type="button"
                          onClick={() => setViewQid(q.id)}
                          className="text-sm font-semibold text-[#0034d3] hover:underline"
                        >
                          문제보기
                        </button>
                      </td>
                      <td className="px-2 py-3">
                        <button
                          type="button"
                          onClick={() => setEditQid(q.id)}
                          className="text-sm font-semibold text-slate-700 hover:underline"
                        >
                          문제수정
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 py-4 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage <= 1}
              className="px-3 py-1.5 rounded-lg border border-slate-200 text-sm font-medium disabled:opacity-50"
            >
              이전
            </button>
            <span className="text-sm text-slate-600">
              {currentPage} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages}
              className="px-3 py-1.5 rounded-lg border border-slate-200 text-sm font-medium disabled:opacity-50"
            >
              다음
            </button>
          </div>
        )}
      </div>

      {viewQuestion && (
        <ViewModal
          question={viewQuestion}
          indexItem={getIndexItemByQid(indexItems, viewQuestion.id)}
          onClose={() => setViewQid(null)}
        />
      )}
      {editQuestion && (
        <EditModal
          certCode={certCode}
          question={editQuestion}
          onSave={() => {
            setEditQid(null);
            setSaveError(null);
            fetchQuestionsForAdmin(certCode, [editQuestion.id]).then(([nq]) => {
              if (nq) setPageQuestions((prev) => prev.map((x) => (x.id === editQuestion.id ? nq : x)));
            });
          }}
          onClose={() => { setEditQid(null); setSaveError(null); }}
          onError={setSaveError}
        />
      )}
      {imagePreviewUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={() => setImagePreviewUrl(null)}>
          <div className="relative max-w-[90vw] max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
            <button type="button" onClick={() => setImagePreviewUrl(null)} className="absolute -top-10 right-0 text-white font-bold">닫기</button>
            <img src={imagePreviewUrl} alt="문제 이미지" className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-xl" />
          </div>
        </div>
      )}
    </div>
  );
}

/** 이미지 열: 문제 데이터의 image 값. null이면 회색 "null", 있으면 검은색으로 표시 */
function ImageNameCell({ imageValue }: { imageValue?: string | null }) {
  if (imageValue == null || imageValue === '') {
    return <span className="text-sm text-slate-400">null</span>;
  }
  return (
    <span className="text-sm text-slate-900 max-w-[200px] truncate block" title={imageValue}>
      {imageValue}
    </span>
  );
}

/**
 * 이미지 열: 값이 Firebase Storage URL(http/https)이 아니면 "업로드필요", Storage URL이면 "이미지삭제".
 */
function ImageViewCell({
  qId,
  imageUrl,
  certCode,
  onUploadStart,
  onUploadEnd,
  onRefresh,
  onClearImage,
  uploading,
  deleting,
}: {
  qId: string;
  imageUrl?: string | null;
  certCode: string;
  onUploadStart: () => void;
  onUploadEnd: () => void;
  onRefresh: () => void;
  onClearImage?: () => Promise<void>;
  uploading: boolean;
  deleting?: boolean;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    onUploadStart();
    try {
      await uploadQuestionImage(certCode, qId, file);
      onRefresh();
    } finally {
      onUploadEnd();
      e.target.value = '';
    }
  };
  const isStorageUrl = typeof imageUrl === 'string' && (imageUrl.startsWith('http://') || imageUrl.startsWith('https://'));
  if (!isStorageUrl) {
    return (
      <div className="flex items-center gap-2">
        {uploading ? (
          <span className="text-xs text-slate-500">업로드 중...</span>
        ) : (
          <>
            <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} />
            <button type="button" onClick={() => inputRef.current?.click()} className="text-sm font-medium text-red-600 hover:underline">
              업로드필요
            </button>
          </>
        )}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onClearImage?.()}
      disabled={deleting}
      className="text-sm font-medium text-slate-600 hover:text-red-600 hover:underline disabled:opacity-50"
    >
      {deleting ? '삭제 중...' : '이미지삭제'}
    </button>
  );
}

function ViewModal({
  question,
  indexItem,
  onClose,
}: {
  question: Question;
  indexItem?: QuestionIndexItem;
  onClose: () => void;
}) {
  const answerDisplay = question.answer ?? 1;
  const stats = indexItem?.stats ? Object.entries(indexItem.stats) : [];
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-xl max-w-5xl w-full max-h-[90vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-start mb-4">
          <h2 className="text-lg font-black text-slate-900 font-mono truncate max-w-[calc(100%-4rem)]" title={question.id}>{question.id}</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">닫기</button>
        </div>
        <div className="space-y-4 text-sm">
          <div>
            <p className="font-bold text-[#0034d3] mb-1">문제</p>
            <div className="text-slate-900 leading-relaxed [&_table]:w-full [&_table]:min-w-[400px] [&_table]:border-collapse [&_table]:text-sm [&_th]:border [&_th]:border-slate-300 [&_th]:bg-slate-100 [&_th]:p-2 [&_td]:border [&_td]:border-slate-300 [&_td]:p-2 [&_code]:bg-slate-100 [&_code]:text-pink-600 [&_code]:px-1 [&_code]:rounded [&_.katex]:text-[inherit]">
              <RichText key={`q-${question.id}`} content={question.content ?? ''} as="div" />
            </div>
          </div>
          {question.tableData != null && (
            <div>
              <p className="font-bold text-[#0034d3] mb-1">표</p>
              <div className="w-full overflow-x-auto [&_table]:w-full [&_table]:min-w-[400px] [&_table]:border-collapse [&_table]:text-sm [&_th]:border [&_th]:border-slate-300 [&_th]:bg-slate-100 [&_th]:p-2 [&_td]:border [&_td]:border-slate-300 [&_td]:p-2">
                {typeof question.tableData === 'string' ? (
                  <RichText content={question.tableData} as="div" />
                ) : Array.isArray(question.tableData?.headers) && Array.isArray(question.tableData?.rows) ? (
                  <table>
                    <thead>
                      <tr>
                        {question.tableData.headers.map((h, i) => (
                          <th key={i}><RichText content={h} as="span" /></th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {question.tableData.rows.map((row, ri) => (
                        <tr key={ri}>
                          {row.map((cell, ci) => (
                            <td key={ci}><RichText content={cell} as="span" /></td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : null}
              </div>
            </div>
          )}
          {question.imageUrl && (
            <div>
              <p className="font-bold text-[#0034d3] mb-1">이미지</p>
              <img src={question.imageUrl} alt="문제" className="max-w-full max-h-64 object-contain rounded-lg border border-slate-200" />
            </div>
          )}
          <div>
            <p className="font-bold text-[#0034d3] mb-1">보기</p>
            <ul className="list-decimal list-inside space-y-1 text-slate-800">
              {question.options?.map((o, i) => (
                <li key={i}><RichText content={o} as="span" /></li>
              ))}
            </ul>
          </div>
          <div>
            <p className="font-bold text-[#0034d3] mb-1">정답</p>
            <p className="text-slate-900">{Math.min(4, Math.max(1, answerDisplay))}번</p>
          </div>
          {question.explanation && (
            <div>
              <p className="font-bold text-[#0034d3] mb-1">해설</p>
              <div className="text-slate-800 leading-relaxed [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-slate-300 [&_td]:border [&_td]:border-slate-300 [&_code]:bg-slate-100 [&_code]:text-pink-600 [&_code]:px-1 [&_code]:rounded">
                <RichText content={question.explanation} as="div" />
              </div>
            </div>
          )}
          {question.wrongFeedback && Object.keys(question.wrongFeedback).length > 0 && (
            <div>
              <p className="font-bold text-[#0034d3] mb-1">오답 피드백</p>
              <ul className="space-y-1 text-slate-800">
                {Object.entries(question.wrongFeedback).map(([key, val]) => (
                  <li key={key}><strong>{key}번:</strong> <RichText content={val} as="span" /></li>
                ))}
              </ul>
            </div>
          )}
          {(question.core_concept || (question.problem_types?.length ?? 0) > 0 || (question.tags?.length ?? 0) > 0) && (
            <div>
              <p className="font-bold text-[#0034d3] mb-1">개념 · 유형 · 태그</p>
              <div className="space-y-2 text-slate-800 text-sm">
                <p><span className="text-slate-500">개념:</span> {question.core_concept ?? '—'}</p>
                <p><span className="text-slate-500">유형:</span> {(question.problem_types?.length ? question.problem_types.join(', ') : null) ?? '—'}</p>
                <p><span className="text-slate-500">태그:</span> {(question.tags?.length ? question.tags.join(', ') : null) ?? '—'}</p>
              </div>
            </div>
          )}
          {stats.length > 0 && (
            <div>
              <p className="font-bold text-[#0034d3] mb-1">stats (태그)</p>
              <div className="flex flex-wrap gap-2">
                {stats.map(([k, v]) => (
                  <span key={k} className="px-2 py-1 rounded-lg bg-slate-100 text-slate-700 text-xs">
                    {k}: {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function EditModal({
  certCode,
  question,
  onSave,
  onClose,
  onError,
}: {
  certCode: string;
  question: Question;
  onSave: () => void;
  onClose: () => void;
  onError: (msg: string) => void;
}) {
  const hasImageValue = question.imageUrl != null && question.imageUrl !== '';
  const [question_text, setQuestion_text] = useState(question.content);
  const [options, setOptions] = useState<string[]>(question.options ?? []);
  const [answer, setAnswer] = useState(question.answer ?? 1);
  const [explanation, setExplanation] = useState(question.explanation ?? '');
  const [wrong_feedback, setWrong_feedback] = useState<Record<string, string>>(question.wrongFeedback ?? {});
  const [imageRequired, setImageRequired] = useState<boolean>(hasImageValue);
  const [tableData, setTableData] = useState<Question['tableData']>(question.tableData ?? null);
  const [tableDataRaw, setTableDataRaw] = useState<string>(() => {
    const t = question.tableData;
    if (t == null) return '';
    if (typeof t === 'string') return t;
    return JSON.stringify(t, null, 2);
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setQuestion_text(question.content);
    setOptions(question.options ?? []);
    setAnswer(question.answer ?? 1);
    setExplanation(question.explanation ?? '');
    setWrong_feedback(question.wrongFeedback ?? {});
    setImageRequired(question.imageUrl != null && question.imageUrl !== '');
    setTableData(question.tableData ?? null);
    const t = question.tableData;
    setTableDataRaw(t == null ? '' : typeof t === 'string' ? t : JSON.stringify(t, null, 2));
  }, [question.id]);

  const resolveTableData = (): Question['tableData'] => {
    const raw = tableDataRaw.trim();
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (
        parsed &&
        typeof parsed === 'object' &&
        Array.isArray((parsed as { headers?: unknown }).headers) &&
        Array.isArray((parsed as { rows?: unknown }).rows)
      ) {
        return parsed as { headers: string[]; rows: string[][] };
      }
    } catch {
      // not JSON → treat as HTML string
    }
    return raw;
  };

  const handleSave = async () => {
    setSaving(true);
    onError('');
    try {
      await updateQuestionInFirestore(certCode, question.id, {
        question_text,
        options,
        answer,
        explanation,
        wrong_feedback: Object.keys(wrong_feedback).length ? wrong_feedback : undefined,
        image: imageRequired ? `${question.id}.png` : null,
        table_data: resolveTableData(),
      });
      onSave();
    } catch (e) {
      onError(e instanceof Error ? e.message : '저장 실패');
    } finally {
      setSaving(false);
    }
  };

  const opts = [...options];
  while (opts.length < 4) opts.push('');
  const setOptionAt = (i: number, v: string) => {
    const next = opts.map((o, j) => (j === i ? v : o));
    setOptions(next.slice(0, 4));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-2xl shadow-xl max-w-5xl w-full max-h-[90vh] overflow-y-auto p-6">
        <div className="flex justify-between items-start mb-4">
          <h2 className="text-lg font-black text-slate-900">문제수정 · {question.id}</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">닫기</button>
        </div>
        <div className="space-y-4 text-sm">
          <div>
            <label className="block font-bold text-slate-600 mb-1">문제 (question_text)</label>
            <textarea
              value={question_text}
              onChange={(e) => setQuestion_text(e.target.value)}
              rows={4}
              className="w-full px-3 py-2 rounded-xl border border-slate-200"
            />
          </div>
          <div>
            <label className="block font-bold text-slate-600 mb-1">보기 (options)</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-6 text-slate-600 shrink-0">{i + 1}번</span>
                  <input
                    type="text"
                    value={opts[i] ?? ''}
                    onChange={(e) => setOptionAt(i, e.target.value)}
                    placeholder={`${i + 1}번 보기`}
                    className="flex-1 min-w-0 px-3 py-2 rounded-xl border border-slate-200"
                  />
                </div>
              ))}
            </div>
          </div>
          <div>
            <label className="block font-bold text-slate-600 mb-1">정답 (1~4 입력, DB에는 0-based 저장)</label>
            <input
              type="number"
              min={1}
              max={Math.max(1, options.length)}
              value={answer}
              onChange={(e) => setAnswer(Number(e.target.value) || 1)}
              className="w-20 px-3 py-2 rounded-xl border border-slate-200"
            />
          </div>
          <div>
            <label className="block font-bold text-slate-600 mb-1">해설 (explanation)</label>
            <textarea
              value={explanation}
              onChange={(e) => setExplanation(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 rounded-xl border border-slate-200"
            />
          </div>
          <div>
            <label className="block font-bold text-slate-600 mb-1">표 (table_data)</label>
            <p className="text-xs text-slate-500 mb-1">
              HTML 문자열 또는 JSON 객체 <code className="bg-slate-100 px-1 rounded">&#123; &quot;headers&quot;: [...], &quot;rows&quot;: [[...], ...] &#125;</code> 형식. 비우면 표 없음.
            </p>
            <textarea
              value={tableDataRaw}
              onChange={(e) => setTableDataRaw(e.target.value)}
              rows={6}
              placeholder='예: {"headers":["열1","열2"],"rows":[["a","b"],["c","d"]]} 또는 <table>...</table>'
              className="w-full px-3 py-2 rounded-xl border border-slate-200 font-mono text-sm"
            />
            <button
              type="button"
              onClick={() => { setTableDataRaw(''); setTableData(null); }}
              className="mt-1 text-sm text-slate-500 hover:text-red-600 hover:underline"
            >
              표 없음으로 초기화
            </button>
          </div>
          <div>
            <label className="block font-bold text-slate-600 mb-1">이미지 필요여부</label>
            <div className="flex gap-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="imageRequired"
                  checked={imageRequired === true}
                  onChange={() => setImageRequired(true)}
                  className="w-4 h-4 text-[#0034d3] border-slate-300"
                />
                <span className="text-sm font-medium text-slate-700">Yes</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="imageRequired"
                  checked={imageRequired === false}
                  onChange={() => setImageRequired(false)}
                  className="w-4 h-4 text-[#0034d3] border-slate-300"
                />
                <span className="text-sm font-medium text-slate-700">No</span>
              </label>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Yes: 이미지 이름 {question.id}.png 로 저장 · No: image를 null로 저장
            </p>
          </div>
          <div>
            <label className="block font-bold text-slate-600 mb-1">오답 피드백 (1번~4번, 키: 1,2,3,4)</label>
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center gap-2 mb-2">
                <span className="w-6 text-slate-600">{i}번</span>
                <input
                  value={wrong_feedback[String(i)] ?? ''}
                  onChange={(e) => setWrong_feedback((prev) => ({ ...prev, [String(i)]: e.target.value }))}
                  placeholder={`${i}번 선택 시 피드백`}
                  className="flex-1 px-3 py-2 rounded-lg border border-slate-200"
                />
              </div>
            ))}
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 font-semibold">취소</button>
          <button type="button" onClick={handleSave} disabled={saving} className="px-4 py-2 rounded-xl bg-[#0034d3] text-white font-semibold disabled:opacity-50">{saving ? '저장 중…' : '저장'}</button>
        </div>
      </div>
    </div>
  );
}
