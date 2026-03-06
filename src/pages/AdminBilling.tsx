/**
 * 어드민 > 결제 관리 (쿠폰 등록)
 * - coupons 목록: 조회(회원관리 스타일), 상태, 사용자 이메일, 체크박스 → 이메일 일괄 복사, 자세히 팝업에서 폐기
 * - 신규 쿠폰 등록: 만료기일, 자격증, 유료기능 기간(일)
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { collection, getDocs, setDoc, doc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { CERTIFICATIONS } from '../constants';
import { getCertDisplayName } from '../services/gradingService';
import { useAllCertificationInfos } from '../hooks/useCertificationInfo';
import type { CouponDoc } from '../services/couponService';
import { Plus, Copy, Ban, Search, Eye } from 'lucide-react';

interface CouponRow extends CouponDoc {
  id: string;
}

const today = () => new Date().toISOString().slice(0, 10);

const BULK_COUNT = 30;
const RANDOM_CODE_LEN = 10;
const RANDOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateRandomCode(): string {
  let s = '';
  for (let i = 0; i < RANDOM_CODE_LEN; i++) {
    s += RANDOM_CODE_CHARS[Math.floor(Math.random() * RANDOM_CODE_CHARS.length)];
  }
  return s;
}

interface AdminBillingProps {
  onBack: () => void;
}

export default function AdminBilling({ onBack }: AdminBillingProps) {
  const [coupons, setCoupons] = useState<CouponRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [modal, setModal] = useState<'new' | 'bulk' | null>(null);
  const [newCode, setNewCode] = useState('');
  const [newCouponName, setNewCouponName] = useState('');
  const [newExpiryDate, setNewExpiryDate] = useState('');
  const [newCertCode, setNewCertCode] = useState('BIGDATA');
  const [newPremiumDays, setNewPremiumDays] = useState(365);
  const [submitting, setSubmitting] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [searchType, setSearchType] = useState<'code' | 'name' | 'user'>('code');
  const [searchQuery, setSearchQuery] = useState('');
  const [hideRevoked, setHideRevoked] = useState(true);
  const [detailRow, setDetailRow] = useState<CouponRow | null>(null);
  const [bulkExpiryDate, setBulkExpiryDate] = useState('');
  const [bulkCertCode, setBulkCertCode] = useState('BIGDATA');
  const [bulkPremiumDays, setBulkPremiumDays] = useState(365);
  const [bulkCouponName, setBulkCouponName] = useState('');
  const [bulkCodeMode, setBulkCodeMode] = useState<'auto' | 'manual'>('auto');
  const [bulkCodesList, setBulkCodesList] = useState<string[]>([]);
  const [bulkCodesText, setBulkCodesText] = useState('');

  const COUPON_NAME_MAX = 15;

  const { certInfos } = useAllCertificationInfos();

  const certName = useCallback(
    (code: string) => getCertDisplayName(CERTIFICATIONS.find((c) => c.code === code) ?? CERTIFICATIONS[0], certInfos[code] ?? null),
    [certInfos]
  );

  const formatTimestamp = useCallback((v: CouponRow['createdAt'] | CouponRow['redeemedAt']): string => {
    if (!v) return '—';
    if (typeof v === 'object' && v !== null && 'toDate' in v && typeof (v as { toDate?: () => Date }).toDate === 'function') {
      const d = (v as { toDate: () => Date }).toDate();
      return d.toISOString().slice(0, 10);
    }
    return '—';
  }, []);

  const reloadCoupons = useCallback(async () => {
    const snap = await getDocs(collection(db, 'coupons'));
    const rows: CouponRow[] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as CouponDoc) }));
    setCoupons(rows);
  }, []);

  const showToast = useCallback((type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  }, []);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const snap = await getDocs(collection(db, 'coupons'));
        const rows: CouponRow[] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as CouponDoc) }));
        setCoupons(rows);
      } catch (e) {
        showToast('error', (e as Error).message || '쿠폰 목록을 불러오지 못했습니다.');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [showToast]);

  const handleCopySelected = useCallback(() => {
    const emails = coupons.filter((c) => selectedIds.has(c.id) && c.redeemedBy).map((c) => c.redeemedBy as string);
    const unique = [...new Set(emails)];
    const text = unique.join(';');
    if (!text) {
      showToast('error', '선택한 행에 사용자 이메일이 없습니다.');
      return;
    }
    navigator.clipboard.writeText(text).then(() => showToast('success', `${unique.length}명 이메일 복사됨`)).catch(() => showToast('error', '복사 실패'));
  }, [coupons, selectedIds, showToast]);

  const downloadSelectedCsv = useCallback(() => {
    const selected = coupons.filter((c) => selectedIds.has(c.id));
    if (selected.length === 0) {
      showToast('error', '다운로드할 쿠폰을 선택해 주세요.');
      return;
    }

    const escapeCsv = (v: unknown) => {
      const s = (v ?? '').toString();
      // Excel 호환을 위해 항상 쌍따옴표로 감싸고 내부 따옴표는 이스케이프
      return `"${s.replace(/"/g, '""')}"`;
    };

    const rows = selected
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((row) => {
        const status = (() => {
          if (row.revoked) return '폐기됨';
          if (row.expiryDate && row.expiryDate < today()) return '만료';
          if (row.used) return '사용중';
          return '미사용';
        })();
        return [
          row.id,
          (row.couponName ?? '').slice(0, COUPON_NAME_MAX) || '—',
          row.expiryDate ?? '—',
          row.certCode ? certName(row.certCode) : '—',
          status,
          row.redeemedBy ?? '—',
          formatTimestamp(row.createdAt),
          formatTimestamp(row.redeemedAt),
        ];
      });

    const header = ['쿠폰코드', '쿠폰 이름', '만료기일', '자격증명', '상태', '사용자 이메일', '생성일', '사용시작일'];
    const csv = [
      '\uFEFF' + header.map(escapeCsv).join(','), // BOM 포함 (엑셀 한글 깨짐 방지)
      ...rows.map((r) => r.map(escapeCsv).join(',')),
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `coupons_selected_${today()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('success', `CSV 다운로드: ${selected.length}건`);
  }, [COUPON_NAME_MAX, certName, coupons, formatTimestamp, selectedIds, showToast]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleRevoke = async (id: string) => {
    setRevokingId(id);
    try {
      await updateDoc(doc(db, 'coupons', id), { revoked: true });
      showToast('success', '쿠폰이 폐기되었습니다.');
      await reloadCoupons();
    } catch (e) {
      showToast('error', (e as Error).message || '폐기 처리에 실패했습니다.');
    } finally {
      setRevokingId(null);
    }
  };

  const handleDeleteAll = async () => {
    if (coupons.length === 0) {
      showToast('error', '삭제할 쿠폰이 없습니다.');
      return;
    }
    if (!window.confirm(`전체 ${coupons.length}건의 쿠폰을 삭제합니다. 복구할 수 없습니다. 계속할까요?`)) return;
    setSubmitting(true);
    let done = 0;
    try {
      for (const row of coupons) {
        await deleteDoc(doc(db, 'coupons', row.id));
        done++;
      }
      showToast('success', `전체 ${done}건 삭제되었습니다.`);
      setSelectedIds(new Set());
      await reloadCoupons();
    } catch (e) {
      showToast('error', (e as Error).message || `일부 삭제 실패 (${done}건 처리됨)`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevokeSelected = async () => {
    if (selectedIds.size === 0) {
      showToast('error', '폐기할 쿠폰을 선택해 주세요.');
      return;
    }
    setSubmitting(true);
    let done = 0;
    try {
      for (const id of selectedIds) {
        await updateDoc(doc(db, 'coupons', id), { revoked: true });
        done++;
      }
      showToast('success', `${done}건 폐기되었습니다.`);
      setSelectedIds(new Set());
      await reloadCoupons();
    } catch (e) {
      showToast('error', (e as Error).message || `일부 폐기 실패 (${done}건 처리됨)`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateCoupon = async () => {
    const code = newCode.trim();
    if (!code) {
      showToast('error', '쿠폰 코드를 입력해 주세요.');
      return;
    }
    if (!newExpiryDate) {
      showToast('error', '만료기일을 선택해 주세요.');
      return;
    }
    if (newPremiumDays < 1) {
      showToast('error', '유료기능 기간은 1일 이상이어야 합니다.');
      return;
    }
    const couponName = newCouponName.trim().slice(0, COUPON_NAME_MAX);
    setSubmitting(true);
    try {
      await setDoc(doc(db, 'coupons', code), {
        couponName: couponName || undefined,
        expiryDate: newExpiryDate,
        certCode: newCertCode,
        premiumDays: newPremiumDays,
        used: false,
        createdAt: serverTimestamp(),
      });
      showToast('success', `쿠폰 ${code} 등록되었습니다.`);
      setModal(null);
      setNewCode('');
      setNewCouponName('');
      setNewExpiryDate('');
      setNewCertCode('BIGDATA');
      setNewPremiumDays(365);
      await reloadCoupons();
    } catch (e) {
      showToast('error', (e as Error).message || '등록에 실패했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleBulkGenerateCodes = useCallback(() => {
    const set = new Set<string>();
    while (set.size < BULK_COUNT) {
      set.add(generateRandomCode());
    }
    setBulkCodesList([...set]);
  }, []);

  const handleBulkSubmit = async () => {
    if (!bulkExpiryDate) {
      showToast('error', '만료기일을 선택해 주세요.');
      return;
    }
    if (bulkPremiumDays < 1) {
      showToast('error', '유료기능 기간은 1일 이상이어야 합니다.');
      return;
    }
    let codes: string[] = [];
    if (bulkCodeMode === 'auto') {
      codes = bulkCodesList.slice(0, BULK_COUNT);
    } else {
      codes = [...new Set(bulkCodesText.split(new RegExp('[\\n,]+', 'g')).map((s: string) => s.trim()).filter(Boolean))].slice(0, BULK_COUNT) as string[];
    }
    if (codes.length === 0) {
      showToast('error', bulkCodeMode === 'auto' ? '먼저 "30개 난수 생성"을 눌러 주세요.' : '쿠폰 코드를 한 줄에 하나씩 입력해 주세요.');
      return;
    }
    const couponName = bulkCouponName.trim().slice(0, COUPON_NAME_MAX);
    setSubmitting(true);
    let done = 0;
    try {
      for (const code of codes) {
        if (!code) continue;
        await setDoc(doc(db, 'coupons', code), {
          couponName: couponName || undefined,
          expiryDate: bulkExpiryDate,
          certCode: bulkCertCode,
          premiumDays: bulkPremiumDays,
          used: false,
          createdAt: serverTimestamp(),
        });
        done++;
      }
      showToast('success', `${done}개 쿠폰이 등록되었습니다.`);
      setModal(null);
      setBulkCodesList([]);
      setBulkCodesText('');
      setBulkCouponName('');
      setBulkExpiryDate('');
      setBulkCertCode('BIGDATA');
      setBulkPremiumDays(365);
      await reloadCoupons();
    } catch (e) {
      showToast('error', (e as Error).message || `${done}개 등록 후 실패했습니다.`);
    } finally {
      setSubmitting(false);
    }
  };

  const filteredCoupons = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let list = coupons;
    if (hideRevoked) list = list.filter((c) => !c.revoked);
    if (q) {
      list = list.filter((c) => {
        if (searchType === 'code') return c.id.toLowerCase().includes(q);
        if (searchType === 'name') return (c.couponName ?? '').toLowerCase().includes(q);
        if (searchType === 'user') return (c.redeemedBy ?? '').toLowerCase().includes(q);
        return true;
      });
    }
    return [...list].sort((a, b) => a.id.localeCompare(b.id));
  }, [coupons, searchQuery, searchType, hideRevoked]);

  const getStatus = (row: CouponRow): '폐기됨' | '만료' | '사용중' | '미사용' => {
    if (row.revoked) return '폐기됨';
    if (row.expiryDate && row.expiryDate < today()) return '만료';
    if (row.used) return '사용중';
    return '미사용';
  };

  return (
    <div className="p-6 md:p-8 max-w-6xl">
      <h1 className="text-2xl font-black text-slate-900 mb-6">쿠폰 관리</h1>

      {loading ? (
        <p className="text-slate-500">로딩 중...</p>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          {/* 쿠폰 조회 영역 (회원관리 스타일) */}
          <div className="p-4 border-b border-slate-100 space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input
                type="text"
                placeholder="쿠폰 코드, 쿠폰 이름 또는 사용자(이메일)로 검색..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#0034d3]/50 focus:border-[#0034d3]"
              />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={searchType}
                onChange={(e) => setSearchType(e.target.value as 'code' | 'name' | 'user')}
                className="px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#0034d3]/50"
              >
                <option value="code">조회: 쿠폰 코드</option>
                <option value="name">조회: 쿠폰 이름</option>
                <option value="user">조회: 사용자</option>
              </select>
              <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={hideRevoked}
                  onChange={(e) => setHideRevoked(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-[#0034d3] focus:ring-[#0034d3]"
                />
                폐기된 쿠폰 숨김
              </label>
              <button
                type="button"
                onClick={() => setModal('new')}
                className="px-4 py-2 rounded-lg bg-[#0034d3] text-white text-sm font-bold hover:bg-[#003087]"
              >
                신규 쿠폰 등록
              </button>
              <button
                type="button"
                onClick={() => setModal('bulk')}
                className="px-4 py-2 rounded-lg border border-[#0034d3] text-[#0034d3] text-sm font-bold hover:bg-[#0034d3]/10"
              >
                일괄등록 (30개)
              </button>
              <button
                type="button"
                onClick={handleCopySelected}
                disabled={selectedIds.size === 0}
                className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                이메일 복사 {selectedIds.size > 0 ? `(${selectedIds.size}명)` : ''}
              </button>
              <button
                type="button"
                onClick={downloadSelectedCsv}
                disabled={selectedIds.size === 0}
                className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                CSV 다운로드 {selectedIds.size > 0 ? `(${selectedIds.size}건)` : ''}
              </button>
              <button
                type="button"
                onClick={handleRevokeSelected}
                disabled={selectedIds.size === 0 || submitting}
                className="px-4 py-2 rounded-lg border border-amber-200 text-amber-700 text-sm font-bold hover:bg-amber-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                선택 폐기 {selectedIds.size > 0 ? `(${selectedIds.size})` : ''}
              </button>
              <button
                type="button"
                onClick={handleDeleteAll}
                disabled={coupons.length === 0 || submitting}
                className="px-4 py-2 rounded-lg border border-red-200 text-red-700 text-sm font-bold hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                전체 삭제
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="w-12 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={filteredCoupons.length > 0 && filteredCoupons.every((c) => selectedIds.has(c.id))}
                      onChange={() => {
                        if (selectedIds.size === filteredCoupons.length) setSelectedIds(new Set());
                        else setSelectedIds(new Set(filteredCoupons.map((c) => c.id)));
                      }}
                      className="w-4 h-4 rounded border-slate-300 text-[#0034d3] focus:ring-[#0034d3]"
                    />
                  </th>
                  <th className="w-14 px-4 py-3 font-black text-slate-500 uppercase text-center">No.</th>
                  <th className="px-4 py-3 font-black text-slate-500 uppercase">쿠폰코드</th>
                  <th className="px-4 py-3 font-black text-slate-500 uppercase whitespace-nowrap" style={{ minWidth: '15ch' }}>쿠폰 이름</th>
                  <th className="px-4 py-3 font-black text-slate-500 uppercase">만료기일</th>
                  <th className="px-4 py-3 font-black text-slate-500 uppercase">자격증</th>
                  <th className="px-4 py-3 font-black text-slate-500 uppercase">상태</th>
                  <th className="px-4 py-3 font-black text-slate-500 uppercase">사용자 (이메일)</th>
                  <th className="w-24 px-4 py-3 font-black text-slate-500 uppercase">자세히</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredCoupons.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-slate-400">
                      {coupons.length === 0
                        ? '등록된 쿠폰이 없습니다. 신규 쿠폰 등록 버튼으로 추가하세요.'
                        : '조회 결과가 없습니다. 검색 조건을 바꿔 보세요.'}
                    </td>
                  </tr>
                ) : (
                  filteredCoupons.map((row, idx) => (
                    <tr
                      key={row.id}
                      className={
                        row.revoked
                          ? 'bg-slate-50 text-slate-400 opacity-80'
                          : 'hover:bg-slate-50/60'
                      }
                    >
                      <td className="w-12 px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(row.id)}
                          onChange={() => toggleSelect(row.id)}
                          className="w-4 h-4 rounded border-slate-300 text-[#0034d3] focus:ring-[#0034d3]"
                        />
                      </td>
                      <td className="w-14 px-4 py-3 text-center text-slate-500 font-medium">{idx + 1}</td>
                      <td className="px-4 py-3 font-medium">
                        <span className={row.revoked ? 'text-slate-400 line-through' : 'text-slate-800'}>
                          {row.id}
                        </span>
                        {!hideRevoked && row.revoked && (
                          <span className="ml-2 inline-flex items-center rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-bold text-red-700">
                            폐기됨
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-600 whitespace-nowrap" style={{ minWidth: '15ch' }}>
                        {(row.couponName ?? '').slice(0, COUPON_NAME_MAX) || '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{row.expiryDate ?? '—'}</td>
                      <td className="px-4 py-3 text-slate-600">{row.certCode ? certName(row.certCode) : '—'}</td>
                      <td className="px-4 py-3">
                        {(() => {
                          const status = getStatus(row);
                          if (status === '폐기됨') {
                            return (
                              <span className="inline-flex items-center rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-bold text-red-700">
                                폐기됨
                              </span>
                            );
                          }
                          if (status === '만료') return <span className="text-slate-500 font-medium">만료</span>;
                          if (status === '사용중') return <span className="text-amber-600 font-bold">사용중</span>;
                          return <span className="text-slate-500">미사용</span>;
                        })()}
                      </td>
                      <td className="px-4 py-3 text-slate-600 break-all">{row.redeemedBy ?? '—'}</td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => setDetailRow(row)}
                          className="p-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
                          title="자세히 보기"
                        >
                          <Eye size={16} />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 자세히 팝업 */}
      {detailRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={() => setDetailRow(null)}>
          <div
            className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-black text-slate-900 mb-4">쿠폰 상세</h3>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-slate-500 font-medium">쿠폰 코드</dt>
                <dd className="text-slate-900 font-medium mt-0.5">{detailRow.id}</dd>
              </div>
              <div>
                <dt className="text-slate-500 font-medium">쿠폰 이름</dt>
                <dd className="text-slate-900 mt-0.5">{(detailRow.couponName ?? '').slice(0, COUPON_NAME_MAX) || '—'}</dd>
              </div>
              <div>
                <dt className="text-slate-500 font-medium">생성일</dt>
                <dd className="text-slate-900 mt-0.5">{formatTimestamp(detailRow.createdAt)}</dd>
              </div>
              <div>
                <dt className="text-slate-500 font-medium">자격증</dt>
                <dd className="text-slate-900 mt-0.5">{detailRow.certCode ? certName(detailRow.certCode) : '—'}</dd>
              </div>
              <div>
                <dt className="text-slate-500 font-medium">유료기능(일)</dt>
                <dd className="text-slate-900 mt-0.5">{detailRow.premiumDays ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-slate-500 font-medium">상태</dt>
                <dd className="mt-0.5">
                  {(() => {
                    const status = getStatus(detailRow);
                    if (status === '폐기됨') return <span className="text-red-600 font-bold">폐기됨</span>;
                    if (status === '만료') return <span className="text-slate-500 font-medium">만료</span>;
                    if (status === '사용중') return <span className="text-amber-600 font-bold">사용중</span>;
                    return <span className="text-slate-500">미사용</span>;
                  })()}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500 font-medium">사용시작일</dt>
                <dd className="text-slate-900 mt-0.5">{formatTimestamp(detailRow.redeemedAt)}</dd>
              </div>
              <div>
                <dt className="text-slate-500 font-medium">사용자 이메일</dt>
                <dd className="text-slate-900 mt-0.5 break-all">{detailRow.redeemedBy ?? '—'}</dd>
              </div>
            </dl>
            <div className="flex gap-3 mt-6">
              {!detailRow.revoked && (
                <button
                  type="button"
                  onClick={async () => {
                    await handleRevoke(detailRow.id);
                    setDetailRow(null);
                  }}
                  disabled={revokingId === detailRow.id}
                  className="flex-1 py-3 rounded-xl border border-amber-200 text-amber-700 font-bold hover:bg-amber-50 disabled:opacity-50"
                >
                  {revokingId === detailRow.id ? '처리 중...' : '폐기'}
                </button>
              )}
              <button
                type="button"
                onClick={() => setDetailRow(null)}
                className="flex-1 py-3 rounded-xl border border-slate-200 font-bold text-slate-600 hover:bg-slate-50"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {modal === 'new' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 my-8">
            <h3 className="text-lg font-black text-slate-900 mb-4">신규 쿠폰 등록</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">쿠폰 코드</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newCode}
                    onChange={(e) => setNewCode(e.target.value)}
                    placeholder="직접 입력 또는 오른쪽 버튼으로 난수 생성"
                    className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-[#0034d3]/50 focus:border-[#0034d3]"
                  />
                  <button
                    type="button"
                    onClick={() => setNewCode(generateRandomCode())}
                    className="px-4 py-2.5 rounded-xl border border-slate-200 text-sm font-bold text-slate-600 hover:bg-slate-50 whitespace-nowrap"
                  >
                    난수 생성
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">쿠폰 이름 (15자 이내, 목록 표시용)</label>
                <input
                  type="text"
                  value={newCouponName}
                  onChange={(e) => setNewCouponName(e.target.value.slice(0, COUPON_NAME_MAX))}
                  maxLength={COUPON_NAME_MAX}
                  placeholder="예: 베타 1차"
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-[#0034d3]/50 focus:border-[#0034d3]"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">쿠폰 만료기일</label>
                <input
                  type="date"
                  value={newExpiryDate}
                  onChange={(e) => setNewExpiryDate(e.target.value)}
                  min={today()}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-[#0034d3]/50 focus:border-[#0034d3]"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">자격증</label>
                <select
                  value={newCertCode}
                  onChange={(e) => setNewCertCode(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-[#0034d3]/50 focus:border-[#0034d3]"
                >
                  {CERTIFICATIONS.map((c) => (
                    <option key={c.id} value={c.code}>{getCertDisplayName(c, certInfos[c.code] ?? null)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">유료기능 기간 (일)</label>
                <input
                  type="number"
                  min={1}
                  value={newPremiumDays}
                  onChange={(e) => setNewPremiumDays(Number(e.target.value) || 1)}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-[#0034d3]/50 focus:border-[#0034d3]"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button type="button" onClick={() => setModal(null)} className="flex-1 py-3 rounded-xl border border-slate-200 font-bold text-slate-600 hover:bg-slate-50">
                취소
              </button>
              <button type="button" onClick={handleCreateCoupon} disabled={submitting} className="flex-1 py-3 rounded-xl bg-[#0034d3] font-bold text-white hover:bg-[#003087] disabled:opacity-50">
                {submitting ? '등록 중...' : '등록'}
              </button>
            </div>
          </div>
        </div>
      )}

      {modal === 'bulk' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6 my-8 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-black text-slate-900 mb-4">쿠폰 일괄등록 (30개)</h3>
            <p className="text-sm text-slate-500 mb-4">아래 공통 정보가 30개 쿠폰에 동일하게 적용됩니다.</p>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">만료기일</label>
                <input
                  type="date"
                  value={bulkExpiryDate}
                  onChange={(e) => setBulkExpiryDate(e.target.value)}
                  min={today()}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-[#0034d3]/50 focus:border-[#0034d3]"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">자격증</label>
                <select
                  value={bulkCertCode}
                  onChange={(e) => setBulkCertCode(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-[#0034d3]/50 focus:border-[#0034d3]"
                >
                  {CERTIFICATIONS.map((c) => (
                    <option key={c.id} value={c.code}>{getCertDisplayName(c, certInfos[c.code] ?? null)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">유료기능 기간 (일)</label>
                <input
                  type="number"
                  min={1}
                  value={bulkPremiumDays}
                  onChange={(e) => setBulkPremiumDays(Number(e.target.value) || 1)}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-[#0034d3]/50 focus:border-[#0034d3]"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">쿠폰 이름 (15자 이내, 공통)</label>
                <input
                  type="text"
                  value={bulkCouponName}
                  onChange={(e) => setBulkCouponName(e.target.value.slice(0, COUPON_NAME_MAX))}
                  maxLength={COUPON_NAME_MAX}
                  placeholder="예: 베타 2차"
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-[#0034d3]/50 focus:border-[#0034d3]"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">쿠폰 코드 (30개)</label>
                <div className="flex gap-2 mb-2">
                  <button
                    type="button"
                    onClick={() => setBulkCodeMode('auto')}
                    className={`px-3 py-2 rounded-lg text-sm font-bold ${bulkCodeMode === 'auto' ? 'bg-[#0034d3] text-white' : 'border border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                  >
                    자동생성
                  </button>
                  <button
                    type="button"
                    onClick={() => setBulkCodeMode('manual')}
                    className={`px-3 py-2 rounded-lg text-sm font-bold ${bulkCodeMode === 'manual' ? 'bg-[#0034d3] text-white' : 'border border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                  >
                    직접입력
                  </button>
                </div>
                {bulkCodeMode === 'auto' ? (
                  <div>
                    <button
                      type="button"
                      onClick={handleBulkGenerateCodes}
                      className="w-full py-2.5 rounded-xl border border-slate-200 text-sm font-bold text-slate-700 hover:bg-slate-50"
                    >
                      30개 난수 생성
                    </button>
                    {bulkCodesList.length > 0 && (
                      <p className="mt-2 text-xs text-slate-500">
                        생성됨: {bulkCodesList.length}개 — {bulkCodesList.slice(0, 3).join(', ')}
                        {bulkCodesList.length > 3 && ' ...'}
                      </p>
                    )}
                  </div>
                ) : (
                  <textarea
                    value={bulkCodesText}
                    onChange={(e) => setBulkCodesText(e.target.value)}
                    placeholder="한 줄에 하나씩 쿠폰 코드 입력 (최대 30개)"
                    rows={5}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-[#0034d3]/50 focus:border-[#0034d3] resize-y"
                  />
                )}
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button type="button" onClick={() => setModal(null)} className="flex-1 py-3 rounded-xl border border-slate-200 font-bold text-slate-600 hover:bg-slate-50">
                취소
              </button>
              <button type="button" onClick={handleBulkSubmit} disabled={submitting} className="flex-1 py-3 rounded-xl bg-[#0034d3] font-bold text-white hover:bg-[#003087] disabled:opacity-50">
                {submitting ? '등록 중...' : '30개 일괄 등록'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 px-6 py-3 rounded-xl shadow-lg font-bold text-sm ${toast.type === 'success' ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'}`}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
