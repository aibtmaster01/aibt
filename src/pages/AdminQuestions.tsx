import React, { useState, useEffect, useMemo } from 'react';
import {
  getRoundsForCert,
  getSubjectsForCertAndRound,
  getFilteredQuestionIds,
  getIndexItemByQid,
  fetchQuestionsForAdmin,
  updateQuestionInFirestore,
  uploadQuestionImage,
} from '../services/adminQuestionService';
import { getQuestionIndexFromCache, syncQuestionIndex, type QuestionIndexItem } from '../services/db/localCacheDB';
import { CERTIFICATIONS } from '../constants';
import { RichText } from '../components/RichText';
import type { Question } from '../types';

const PAGE_SIZE = 20;
const CERT_QUESTIONS = ['BIGDATA'] as const; // 현재 문제 데이터 있는 자격증만

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
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

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
        const items = await getQuestionIndexFromCache(certCode);
        setIndexItems(items);
        setFilteredByImageQids(null);
      } finally {
        setLoading(false);
      }
    },
    [certCode, round, subject, subjects.length]
  );

  const displayQids = useMemo(() => {
    if (onlyWithImage && filteredByImageQids) return filteredByImageQids;
    return allQids;
  }, [allQids, onlyWithImage, filteredByImageQids]);

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
    <div className="p-6 md:p-8 max-w-6xl">
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
        <div className="flex gap-3">
          <button
            type="button"
            onClick={runSearch}
            disabled={loading || subjects.length === 0}
            className="flex-1 py-3 rounded-xl bg-[#0034d3] text-white font-bold text-sm hover:bg-[#003087] disabled:opacity-50"
          >
            검색
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
                <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase w-16">인덱스</th>
                <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase w-28">고유값</th>
                <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase w-40">이미지</th>
                <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase w-28">이미지 보기</th>
                <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase w-28">문제보기</th>
                <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase w-28">문제수정</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {!searched ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">자격증·회차·과목을 선택한 뒤 <strong>검색</strong> 버튼을 눌러 주세요.</td></tr>
              ) : loading && pageQuestions.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">로딩 중...</td></tr>
              ) : pageQuestions.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">조회된 문제가 없습니다.</td></tr>
              ) : (
                pageQuestions.map((q, idx) => {
                  const rowIndex = (currentPage - 1) * PAGE_SIZE + idx + 1;
                  return (
                    <tr key={q.id} className="hover:bg-slate-50/50">
                      <td className="px-4 py-3 text-sm text-slate-600">{rowIndex}</td>
                      <td className="px-4 py-3 font-mono text-sm text-slate-900 max-w-[120px] truncate" title={q.id}>{q.id}</td>
                      <td className="px-4 py-3">
                        <ImageNameCell imageValue={q.imageUrl} />
                      </td>
                      <td className="px-4 py-3">
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
                          onShowImage={(url) => setImagePreviewUrl(url)}
                          uploading={uploadQid === q.id}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => setViewQid(q.id)}
                          className="text-sm font-semibold text-[#0034d3] hover:underline"
                        >
                          문제보기
                        </button>
                      </td>
                      <td className="px-4 py-3">
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
 * 이미지 보기 열: image가 null이면 회색 "null".
 * 이미지 필요 시 스토리지에 파일 있으면 파란 "이미지보기", 없으면 빨간 "업로드필요".
 */
function ImageViewCell({
  qId,
  imageUrl,
  certCode,
  onUploadStart,
  onUploadEnd,
  onRefresh,
  onShowImage,
  uploading,
}: {
  qId: string;
  imageUrl?: string | null;
  certCode: string;
  onUploadStart: () => void;
  onUploadEnd: () => void;
  onRefresh: () => void;
  onShowImage: (url: string) => void;
  uploading: boolean;
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
  if (imageUrl == null || imageUrl === '') {
    return <span className="text-sm text-slate-400">null</span>;
  }
  const hasFileInStorage = imageUrl.startsWith('http');
  if (hasFileInStorage) {
    return (
      <button
        type="button"
        onClick={() => onShowImage(imageUrl)}
        className="text-sm font-medium text-[#0034d3] hover:underline"
      >
        이미지보기
      </button>
    );
  }
  return (
    <div className="flex items-center gap-2">
      {uploading ? (
        <span className="text-xs text-slate-500">업로드 중...</span>
      ) : (
        <>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleUpload}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="text-sm font-medium text-red-600 hover:underline"
          >
            업로드필요
          </button>
        </>
      )}
    </div>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-start mb-4">
          <h2 className="text-lg font-black text-slate-900">문제보기</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">닫기</button>
        </div>
        <div className="space-y-4 text-sm">
          <div>
            <p className="font-bold text-[#0034d3] mb-1">문제</p>
            <div className="text-slate-900 leading-relaxed [&_table]:w-full [&_table]:min-w-[400px] [&_table]:border-collapse [&_table]:text-sm [&_th]:border [&_th]:border-slate-300 [&_th]:bg-slate-100 [&_th]:p-2 [&_td]:border [&_td]:border-slate-300 [&_td]:p-2 [&_code]:bg-slate-100 [&_code]:text-pink-600 [&_code]:px-1 [&_code]:rounded">
              <RichText content={question.content} as="div" />
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
            <p className="text-slate-900">{answerDisplay}번 (인덱스+1)</p>
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
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setQuestion_text(question.content);
    setOptions(question.options ?? []);
    setAnswer(question.answer ?? 1);
    setExplanation(question.explanation ?? '');
    setWrong_feedback(question.wrongFeedback ?? {});
    setImageRequired(question.imageUrl != null && question.imageUrl !== '');
  }, [question.id]);

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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
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
