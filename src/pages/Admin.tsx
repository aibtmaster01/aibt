import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import {
  LayoutDashboard,
  Users,
  FileQuestion,
  CreditCard,
  Search,
  MoreVertical,
  Mail,
  ShieldAlert,
  ShieldCheck,
  CreditCard as TicketIcon,
  Lock,
  Unlock,
  ChevronLeft,
  ChevronRight,
  Smartphone,
  BookOpen,
  FileText,
} from 'lucide-react';
import { User } from '../types';
import { CERTIFICATIONS } from '../constants';
import { getCertDisplayName } from '../services/gradingService';
import { useAllCertificationInfos } from '../hooks/useCertificationInfo';
import { useAuth } from '../contexts/AuthContext';
import {
  subscribeToUsers,
  fetchUsersPage,
  updateUserMemberships,
  updateUserBanned,
  sendPasswordResetToUser,
  clearUserDevices,
  fetchUserQuestionCount,
  updateUserAdminMemo,
  fetchTodayVisitorCount,
  fetchVisitorCountsForRange,
  fetchErrorLogs,
  EXAM_SCHEDULES,
  USERS_PAGE_SIZE,
  type AdminUser,
  type MembershipUpdateInput,
  type ErrorLogEntry,
} from '../services/adminService';

type AdminMenu = 'dashboard' | 'users' | 'questions' | 'billing';

const ROWS_PER_PAGE = 10;

interface UserListRow {
  user: AdminUser;
  certCode: string | null;
  certName: string;
  certStatus: '유료' | '무료' | '만료' | '-';
  certId: string | null;
}

interface AdminProps {
  users?: User[];
  currentUser?: User | null;
  /** 메인 LNB에서 진입 시 사용. 이때 어드민 전용 LNB는 숨김 */
  initialMenu?: AdminMenu;
  hideSidebar?: boolean;
}

type PaymentFormEntry = { checked: boolean; startDate: string; expiryDate: string; targetScheduleId: string };

export const Admin: React.FC<AdminProps> = ({ users: usersProp, currentUser: currentUserProp, initialMenu, hideSidebar }) => {
  const { user: authUser } = useAuth();
  const [menu, setMenu] = useState<AdminMenu>(initialMenu ?? 'dashboard');
  const effectiveMenu = hideSidebar ? (initialMenu ?? 'dashboard') : menu;
  const [firestoreUsers, setFirestoreUsers] = useState<AdminUser[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);
  const [dropdownAnchor, setDropdownAnchor] = useState<{ top: number; left: number } | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [modal, setModal] = useState<'payment' | 'confirmBan' | 'confirmUnban' | 'confirmClearDevices' | 'memo' | null>(null);
  const [targetUser, setTargetUser] = useState<AdminUser | null>(null);
  const [questionCounts, setQuestionCounts] = useState<Record<string, number>>({});
  const [todayVisitors, setTodayVisitors] = useState<number | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterCertId, setFilterCertId] = useState<string>('');
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  const [currentPage, setCurrentPage] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [memoText, setMemoText] = useState('');
  const [lastUserDoc, setLastUserDoc] = useState<DocumentSnapshot | null>(null);
  const [hasMoreUsers, setHasMoreUsers] = useState(false);
  const [usersNextLoading, setUsersNextLoading] = useState(false);
  const [usersLoadError, setUsersLoadError] = useState<string | null>(null);
  const [trendStart, setTrendStart] = useState<string>(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().slice(0, 10);
  });
  const [trendEnd, setTrendEnd] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [visitorTrend, setVisitorTrend] = useState<{ date: string; count: number }[]>([]);
  const [trendLoading, setTrendLoading] = useState(false);
  const [errorLogs, setErrorLogs] = useState<ErrorLogEntry[]>([]);
  const [errorLogsLoading, setErrorLogsLoading] = useState(false);

  const today = new Date().toISOString().slice(0, 10);

  const paymentFormInitial = useMemo(
    () =>
      Object.fromEntries(
        CERTIFICATIONS.map((c) => [c.code, { checked: false, startDate: '', expiryDate: '', targetScheduleId: '' }])
      ),
    []
  );
  const [paymentForm, setPaymentForm] = useState<Record<string, PaymentFormEntry>>(paymentFormInitial);

  const closeDropdown = useCallback(() => {
    setOpenDropdownId(null);
    setDropdownAnchor(null);
  }, []);

  const showToast = useCallback((type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const users: AdminUser[] = useMemo(() => {
    if (firestoreUsers.length > 0) return firestoreUsers;
    if (!usersProp?.length) return [];
    return usersProp.map((u) => ({
      ...u,
      isBanned: false,
      registeredDevices: [],
      adminMemo: '',
      rawMemberships: undefined,
    })) as AdminUser[];
  }, [firestoreUsers, usersProp]);

  useEffect(() => {
    const unsub = subscribeToUsers(
      (users, lastDoc) => {
        setUsersLoadError(null);
        setLastUserDoc(lastDoc);
        setHasMoreUsers(users.length >= USERS_PAGE_SIZE);
        setFirestoreUsers((prev) =>
          prev.length <= USERS_PAGE_SIZE ? users : [...users, ...prev.slice(USERS_PAGE_SIZE)]
        );
      },
      (err) => {
        setUsersLoadError(err?.message || '회원 목록을 불러오지 못했습니다.');
      }
    );
    return () => unsub();
  }, []);

  const filteredUsers = useMemo(
    () =>
      users.filter(
        (u) =>
          (u.email ?? '').toLowerCase().includes(searchQuery.toLowerCase()) ||
          (u.name ?? '').toLowerCase().includes(searchQuery.toLowerCase())
      ),
    [users, searchQuery]
  );

  const filteredUserIds = useMemo(
    () => [...new Set(filteredUsers.map((u) => u.id))].sort().join(','),
    [filteredUsers]
  );

  useEffect(() => {
    if (menu !== 'users' || filteredUsers.length === 0) return;
    const userIds = filteredUserIds ? filteredUserIds.split(',') : [];
    if (userIds.length === 0) return;
    Promise.all(userIds.map((id) => fetchUserQuestionCount(id).catch(() => 0))).then((counts) => {
      const next: Record<string, number> = {};
      userIds.forEach((id, i) => {
        next[id] = counts[i];
      });
      setQuestionCounts((prev) => ({ ...prev, ...next }));
    });
  }, [menu, filteredUserIds]);

  const { certInfos } = useAllCertificationInfos();
  const buildRows = useCallback(
    (userList: AdminUser[]): UserListRow[] => {
      const rows: UserListRow[] = [];
      for (const u of userList) {
        const raw = u.rawMemberships || {};
        const certCodes =
          Object.keys(raw).length > 0
            ? Object.keys(raw)
            : u.subscriptions.map((s) => CERTIFICATIONS.find((c) => c.id === s.id)?.code).filter(Boolean) as string[];

        if (certCodes.length === 0) {
          rows.push({ user: u, certCode: null, certName: '-', certStatus: '무료', certId: null });
        } else {
          for (const code of certCodes) {
            const cert = CERTIFICATIONS.find((c) => c.code === code);
            if (!cert) continue;
            let status: '유료' | '무료' | '만료' = '무료';
            const entry = raw[code];
            if (entry?.tier === 'PREMIUM') {
              status = entry.expiry_date && entry.expiry_date < today ? '만료' : '유료';
            } else if (u.paidCertIds?.includes(cert.id)) {
              status = u.expiredCertIds?.includes(cert.id) ? '만료' : '유료';
            }
            rows.push({
              user: u,
              certCode: code,
              certName: getCertDisplayName(cert, certInfos[code] ?? null),
              certStatus: status,
              certId: cert.id,
            });
          }
        }
      }
      return rows;
    },
    [today, certInfos]
  );

  const allRows = useMemo(() => buildRows(filteredUsers), [filteredUsers, buildRows]);
  const filteredRows = useMemo(() => {
    return allRows.filter((row) => {
      const matchStatus = !filterStatus || row.certStatus === filterStatus || (filterStatus === 'Admin' && row.user.isAdmin);
      const matchCert = !filterCertId || row.certId === filterCertId;
      return matchStatus && matchCert;
    });
  }, [allRows, filterStatus, filterCertId]);
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / ROWS_PER_PAGE));
  const paginatedRows = useMemo(() => {
    const start = (currentPage - 1) * ROWS_PER_PAGE;
    return filteredRows.slice(start, start + ROWS_PER_PAGE);
  }, [filteredRows, currentPage]);

  useEffect(() => setCurrentPage(1), [searchQuery, filterStatus, filterCertId]);

  const toggleUserSelection = useCallback((userId: string) => {
    setSelectedUserIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }, []);

  const handleCopyEmails = useCallback(() => {
    if (selectedUserIds.size === 0) return;
    const emails = users.filter((u) => selectedUserIds.has(u.id)).map((u) => u.email).filter(Boolean);
    const text = [...new Set(emails)].join(';');
    navigator.clipboard.writeText(text).then(() => showToast('success', `${emails.length}명 이메일 복사됨`)).catch(() => showToast('error', '복사 실패'));
  }, [selectedUserIds, users, showToast]);

  const stats = useMemo(
    () => {
      const premiumCount = users.filter((u) => u.isPremium).length;
      const premiumTodayCount = users.filter((u) => {
        const raw = u.rawMemberships || {};
        return Object.values(raw).some(
          (e) => e.tier === 'PREMIUM' && e.start_date === today
        );
      }).length;
      return {
        total: users.length,
        premium: premiumCount,
        premiumToday: premiumTodayCount,
        todayNew: users.filter((u) => u.createdAt?.slice(0, 10) === today).length,
      };
    },
    [users, today]
  );

  useEffect(() => {
    if (menu !== 'dashboard') return;
    fetchTodayVisitorCount(today).then(setTodayVisitors).catch(() => setTodayVisitors(0));
  }, [menu, today]);

  useEffect(() => {
    if (effectiveMenu !== 'dashboard') return;
    setTrendLoading(true);
    fetchVisitorCountsForRange(trendStart, trendEnd)
      .then(setVisitorTrend)
      .catch(() => setVisitorTrend([]))
      .finally(() => setTrendLoading(false));
  }, [effectiveMenu, trendStart, trendEnd]);

  useEffect(() => {
    if (effectiveMenu !== 'dashboard') return;
    setErrorLogsLoading(true);
    fetchErrorLogs(100)
      .then(setErrorLogs)
      .catch(() => setErrorLogs([]))
      .finally(() => setErrorLogsLoading(false));
  }, [effectiveMenu]);

  const effectiveUser = currentUserProp ?? authUser ?? null;

  const handlePaymentModalOpen = async (user: AdminUser) => {
    setTargetUser(user);
    setModal('payment');
    closeDropdown();
    const raw = user.rawMemberships || {};
    const form = { ...paymentFormInitial };
    for (const cert of CERTIFICATIONS) {
      const entry = raw[cert.code];
      if (entry) {
        form[cert.code] = {
          checked: true,
          startDate: entry.start_date || '',
          expiryDate: entry.expiry_date || '',
          targetScheduleId: entry.target_schedule_id || '',
        };
      }
    }
    setPaymentForm(form);
    try {
      const count = await fetchUserQuestionCount(user.id);
      setQuestionCounts((prev) => ({ ...prev, [user.id]: count }));
    } catch {
      setQuestionCounts((prev) => ({ ...prev, [user.id]: 0 }));
    }
  };

  const handlePaymentSubmit = async () => {
    if (!targetUser) return;
    const updates: MembershipUpdateInput[] = [];
    for (const [code, v] of Object.entries(paymentForm) as [string, PaymentFormEntry][]) {
      if (!v.checked) continue;
      const cert = CERTIFICATIONS.find((c) => c.code === code);
      if (!cert) continue;
      updates.push({
        code,
        tier: 'PREMIUM',
        startDate: v.startDate || undefined,
        expiryDate: v.expiryDate || undefined,
        targetScheduleId: v.targetScheduleId || undefined,
      });
    }
    if (updates.length === 0) {
      showToast('error', '자격증을 선택하고 만료일을 입력해주세요.');
      return;
    }
    setIsSubmitting(true);
    try {
      await updateUserMemberships(targetUser.id, updates);
      showToast('success', '권한이 수정되었습니다.');
      setModal(null);
      setTargetUser(null);
    } catch (e) {
      showToast('error', (e as Error).message || '저장에 실패했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePasswordReset = async (user: AdminUser) => {
    closeDropdown();
    try {
      await sendPasswordResetToUser(user.email);
      showToast('success', `${user.email}로 비밀번호 재설정 메일을 발송했습니다.`);
    } catch (e) {
      showToast('error', (e as Error).message || '메일 발송에 실패했습니다.');
    }
  };

  const handleBanClick = (user: AdminUser) => {
    setTargetUser(user);
    setModal(user.isBanned ? 'confirmUnban' : 'confirmBan');
    closeDropdown();
  };

  const handleBanConfirm = async () => {
    if (!targetUser) return;
    setIsSubmitting(true);
    try {
      await updateUserBanned(targetUser.id, modal === 'confirmBan');
      showToast('success', modal === 'confirmBan' ? '이용이 정지되었습니다.' : '정지가 해제되었습니다.');
      setModal(null);
      setTargetUser(null);
    } catch (e) {
      showToast('error', (e as Error).message || '처리에 실패했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClearDevicesClick = (user: AdminUser) => {
    setTargetUser(user);
    setModal('confirmClearDevices');
    closeDropdown();
  };

  const handleClearDevicesConfirm = async () => {
    if (!targetUser) return;
    setIsSubmitting(true);
    try {
      await clearUserDevices(targetUser.id);
      showToast('success', '모든 기기가 초기화되었습니다.');
      setModal(null);
      setTargetUser(null);
    } catch (e) {
      showToast('error', (e as Error).message || '처리에 실패했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleMemoOpen = (user: AdminUser) => {
    setTargetUser(user);
    setMemoText(user.adminMemo || '');
    setModal('memo');
    closeDropdown();
  };

  const handleMemoSave = async () => {
    if (!targetUser) return;
    setIsSubmitting(true);
    try {
      await updateUserAdminMemo(targetUser.id, memoText);
      showToast('success', '메모가 저장되었습니다.');
      setModal(null);
      setTargetUser(null);
    } catch (e) {
      showToast('error', (e as Error).message || '저장에 실패했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const getRowBg = (row: UserListRow) => {
    if (row.user.isBanned) return 'bg-red-50/50';
    if (row.certStatus === '만료') return 'bg-slate-50';
    return 'bg-white';
  };

  if (effectiveUser && !effectiveUser.isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#edf1f5]">
        <div className="text-center">
          <ShieldAlert className="w-16 h-16 text-red-400 mx-auto mb-4" />
          <p className="text-slate-600 font-bold">접근 권한이 없습니다.</p>
          <p className="text-slate-400 text-sm mt-2">관리자 계정으로 로그인해주세요.</p>
        </div>
      </div>
    );
  }

  const menuItems: { id: AdminMenu; label: string; icon: React.ReactNode; disabled?: boolean }[] = [
    { id: 'dashboard', label: '대시보드', icon: <LayoutDashboard size={20} /> },
    { id: 'users', label: '회원 관리', icon: <Users size={20} /> },
    { id: 'questions', label: '문제 관리', icon: <FileQuestion size={20} />, disabled: true },
    { id: 'billing', label: '정산 및 쿠폰', icon: <CreditCard size={20} />, disabled: true },
  ];

  return (
    <div className="min-h-screen bg-[#edf1f5] flex">
      {!hideSidebar && (
        <aside className="w-64 bg-white border-r border-slate-200 shrink-0 flex flex-col">
          <div className="p-6 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 bg-[#0034d3] rounded-lg flex items-center justify-center">
                <ShieldCheck className="text-white" size={20} />
              </div>
              <span className="font-black text-slate-900">Admin</span>
            </div>
          </div>
          <nav className="p-3 flex-1">
            {menuItems.map((item) => (
              <button
                key={item.id}
                onClick={() => !item.disabled && setMenu(item.id)}
                disabled={item.disabled}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left font-semibold transition-colors ${
                  menu === item.id && !item.disabled ? 'bg-[#0034d3]/20 text-slate-800' : item.disabled ? 'text-slate-300 cursor-not-allowed' : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                {item.icon}
                <span>{item.label}</span>
                {item.disabled && <span className="ml-auto text-xs text-slate-400">준비중</span>}
              </button>
            ))}
          </nav>
        </aside>
      )}

      <main className="flex-1 overflow-auto p-6 md:p-8">
        {effectiveMenu === 'dashboard' && (
          <>
            <div className="max-w-5xl">
              <h1 className="text-2xl font-black text-slate-900 mb-6">대시보드</h1>

              <h2 className="text-lg font-bold text-slate-700 mb-3">회원 요약</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
                  <p className="text-slate-500 text-sm font-bold mb-1">총 가입자 수</p>
                  <p className="text-3xl font-black text-slate-900">{stats.total}</p>
                </div>
                <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
                  <p className="text-slate-500 text-sm font-bold mb-1">유료 회원 수</p>
                  <p className="text-3xl font-black text-[#0034d3]">
                    {stats.premium}
                    {stats.premiumToday > 0 && (
                      <span className="ml-2 text-lg font-bold text-green-600">(↑ {stats.premiumToday})</span>
                    )}
                  </p>
                </div>
                <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
                  <p className="text-slate-500 text-sm font-bold mb-1">오늘 신규 가입</p>
                  <p className="text-3xl font-black text-slate-900">{stats.todayNew}</p>
                </div>
                <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
                  <p className="text-slate-500 text-sm font-bold mb-1">오늘 방문자 수</p>
                  <p className="text-3xl font-black text-slate-900">
                    {todayVisitors !== null ? todayVisitors : '—'}
                  </p>
                </div>
              </div>

              <h2 className="text-lg font-bold text-slate-700 mb-3">회원수 추이 (방문자 수)</h2>
              <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 mb-6">
                <div className="flex flex-wrap items-center gap-3 mb-4">
                  <button
                    type="button"
                    onClick={() => {
                      const d = new Date();
                      d.setDate(1);
                      setTrendStart(d.toISOString().slice(0, 10));
                      setTrendEnd(new Date().toISOString().slice(0, 10));
                    }}
                    className="px-3 py-2 rounded-xl border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    이번 달
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const d = new Date();
                      d.setMonth(d.getMonth() - 1);
                      d.setDate(1);
                      setTrendStart(d.toISOString().slice(0, 10));
                      const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
                      setTrendEnd(end.toISOString().slice(0, 10));
                    }}
                    className="px-3 py-2 rounded-xl border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    지난달
                  </button>
                  <label className="flex items-center gap-2 text-sm text-slate-600">
                    <span>시작일</span>
                    <input
                      type="date"
                      value={trendStart}
                      onChange={(e) => setTrendStart(e.target.value)}
                      className="px-3 py-2 rounded-lg border border-slate-200 text-sm"
                    />
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-600">
                    <span>종료일</span>
                    <input
                      type="date"
                      value={trendEnd}
                      onChange={(e) => setTrendEnd(e.target.value)}
                      className="px-3 py-2 rounded-lg border border-slate-200 text-sm"
                    />
                  </label>
                </div>
                {trendLoading ? (
                  <p className="text-slate-500 text-sm py-4">로딩 중...</p>
                ) : visitorTrend.length === 0 ? (
                  <p className="text-slate-500 text-sm py-4">해당 기간 데이터가 없습니다.</p>
                ) : (
                  <div className="w-full h-64">
                    <ResponsiveContainer width="100%" height="100%" minWidth={100} minHeight={100}>
                      <LineChart data={visitorTrend} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis
                          dataKey="date"
                          tick={{ fontSize: 11, fill: '#64748b' }}
                          tickFormatter={(v) => v.slice(5).replace('-', '/')}
                        />
                        <YAxis tick={{ fontSize: 11, fill: '#64748b' }} allowDecimals={false} />
                        <Tooltip
                          contentStyle={{ borderRadius: '12px', border: '1px solid #e2e8f0' }}
                          labelFormatter={(v) => v}
                          formatter={(value: number) => [`${value}명`, '방문자']}
                        />
                        <Line type="monotone" dataKey="count" stroke="#0034d3" strokeWidth={2} dot={{ fill: '#0034d3', r: 3 }} name="방문자 수" />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>

              <h2 className="text-lg font-bold text-slate-700 mb-3">오류 로그 (클라이언트)</h2>
              <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden mb-6">
                {errorLogsLoading ? (
                  <div className="p-6 text-slate-500 text-sm">로딩 중...</div>
                ) : errorLogs.length === 0 ? (
                  <div className="p-6 text-slate-500 text-sm">기록된 오류가 없습니다. (Firebase Console 또는 error_logs 컬렉션)</div>
                ) : (
                  <div className="overflow-x-auto max-h-64 overflow-y-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-slate-50 sticky top-0">
                        <tr>
                          <th className="px-4 py-3 font-bold text-slate-600 w-36">시간</th>
                          <th className="px-4 py-3 font-bold text-slate-600 w-28">사용자</th>
                          <th className="px-4 py-3 font-bold text-slate-600">메시지</th>
                          <th className="px-4 py-3 font-bold text-slate-600 w-24">상세</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {errorLogs.map((log) => (
                          <tr key={log.id} className="hover:bg-slate-50/50">
                            <td className="px-4 py-2 text-slate-600 whitespace-nowrap">{log.timestamp ? new Date(log.timestamp).toLocaleString('ko-KR') : '—'}</td>
                            <td className="px-4 py-2 text-slate-700">{log.userEmail || log.userId || '—'}</td>
                            <td className="px-4 py-2 text-slate-900 max-w-md truncate" title={log.message}>{log.message}</td>
                            <td className="px-4 py-2">
                              {log.stack || log.context ? (
                                <details className="cursor-pointer">
                                  <summary className="text-[#0034d3] font-medium">보기</summary>
                                  <pre className="mt-1 p-2 bg-slate-50 rounded text-xs overflow-x-auto whitespace-pre-wrap max-h-32 overflow-y-auto">
                                    {log.context}
                                    {log.stack || ''}
                                  </pre>
                                </details>
                              ) : (
                                '—'
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {effectiveMenu === 'users' && (
          <div className="max-w-6xl">
            <h1 className="text-2xl font-black text-slate-900 mb-6">회원 관리</h1>
            {usersLoadError && (
              <div className="mb-4 p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-sm">
                <p className="font-bold">목록 로드 오류</p>
                <p className="mt-1">{usersLoadError}</p>
                <p className="mt-2 text-amber-700">
                  Firestore 규칙에서 관리자만 users 컬렉션을 읽을 수 있습니다. 로그인한 계정의 Firestore 문서에 <code className="bg-amber-100 px-1 rounded">isAdmin: true</code>가 있는지 확인하세요.
                </p>
              </div>
            )}
            {!usersLoadError && users.length === 0 && (
              <div className="mb-4 p-4 rounded-xl bg-slate-50 border border-slate-200 text-slate-700 text-sm">
                <p className="font-bold">회원이 없거나 목록이 비어 있습니다</p>
                <p className="mt-1">회원 목록은 <strong>Firestore → users 컬렉션</strong>을 읽습니다. Auth에만 있고 Firestore users에 문서가 없으면 안 보입니다.</p>
                <p className="mt-1 text-slate-600">Auth 사용자를 Firestore에 동기화하려면: <code className="bg-slate-100 px-1 rounded text-xs">backend/scripts/sync_auth_to_firestore.py</code> 실행. 관리자 계정은 Firestore 문서에 <code className="bg-slate-100 px-1 rounded text-xs">isAdmin: true</code>인지 확인하세요.</p>
              </div>
            )}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
              <div className="p-4 border-b border-slate-100 space-y-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                  <input
                    type="text"
                    placeholder="이메일 또는 이름으로 검색..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#0034d3]/50 focus:border-[#0034d3]"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <select
                    value={filterStatus}
                    onChange={(e) => setFilterStatus(e.target.value)}
                    className="px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#0034d3]/50"
                  >
                    <option value="">상태: 전체</option>
                    <option value="유료">유료</option>
                    <option value="무료">무료</option>
                    <option value="만료">만료</option>
                    <option value="Admin">Admin</option>
                  </select>
                  <select
                    value={filterCertId}
                    onChange={(e) => setFilterCertId(e.target.value)}
                    className="px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#0034d3]/50"
                  >
                    <option value="">자격증: 전체</option>
                    {CERTIFICATIONS.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={handleCopyEmails}
                    disabled={selectedUserIds.size === 0}
                    className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    이메일 복사 {selectedUserIds.size > 0 ? `(${selectedUserIds.size}명)` : ''}
                  </button>
                  {hasMoreUsers && (
                    <button
                      type="button"
                      disabled={usersNextLoading || !lastUserDoc}
                      onClick={async () => {
                        if (!lastUserDoc) return;
                        setUsersNextLoading(true);
                        try {
                          const { users: nextUsers, lastDoc: nextDoc, hasMore } = await fetchUsersPage(USERS_PAGE_SIZE, lastUserDoc);
                          setFirestoreUsers((prev) => [...prev, ...nextUsers]);
                          setLastUserDoc(nextDoc);
                          setHasMoreUsers(hasMore);
                        } finally {
                          setUsersNextLoading(false);
                        }
                      }}
                      className="px-4 py-2 rounded-lg bg-[#0034d3] text-white text-sm font-bold hover:bg-[#003087] disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {usersNextLoading ? '불러오는 중…' : '다음 20명 보기'}
                    </button>
                  )}
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="w-12 px-4 py-4">
                        <input
                          type="checkbox"
                          checked={paginatedRows.length > 0 && paginatedRows.every((r) => selectedUserIds.has(r.user.id))}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedUserIds((prev) => {
                                const next = new Set(prev);
                                paginatedRows.forEach((r) => next.add(r.user.id));
                                return next;
                              });
                            } else {
                              setSelectedUserIds((prev) => {
                                const next = new Set(prev);
                                paginatedRows.forEach((r) => next.delete(r.user.id));
                                return next;
                              });
                            }
                          }}
                          className="w-4 h-4 rounded border-slate-300 text-[#0034d3] focus:ring-[#0034d3]"
                        />
                      </th>
                      <th className="px-6 py-4 text-xs font-black text-slate-500 uppercase">가입일</th>
                      <th className="px-6 py-4 text-xs font-black text-slate-500 uppercase">이메일</th>
                      <th className="px-6 py-4 text-xs font-black text-slate-500 uppercase">이름</th>
                      <th className="px-6 py-4 text-xs font-black text-slate-500 uppercase">상태</th>
                      <th className="px-6 py-4 text-xs font-black text-slate-500 uppercase">자격증명</th>
                      <th className="px-6 py-4 text-xs font-black text-slate-500 uppercase">푼 문제</th>
                      <th className="px-6 py-4 text-xs font-black text-slate-500 uppercase w-24">관리</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {paginatedRows.map((row, idx) => {
                      const prevRow = paginatedRows[idx - 1];
                      return (
                        <tr
                          key={`${row.user.id}-${row.certCode || 'empty'}`}
                          className={`${getRowBg(row)} hover:bg-slate-50/60 transition-colors`}
                        >
                          <td className="w-12 px-4 py-4">
                            <input
                              type="checkbox"
                              checked={selectedUserIds.has(row.user.id)}
                              onChange={() => toggleUserSelection(row.user.id)}
                              className="w-4 h-4 rounded border-slate-300 text-[#0034d3] focus:ring-[#0034d3]"
                            />
                          </td>
                          <td className="px-6 py-4 text-sm text-slate-500">
                            {row.user.createdAt ? row.user.createdAt.slice(0, 10) : '-'}
                          </td>
                          <td className="px-6 py-4 font-medium text-slate-900">{row.user.email}</td>
                          <td className="px-6 py-4 text-slate-700">
                            {row.user.name}
                            {row.user.isBanned && <span className="ml-1 text-red-600 text-xs font-bold">[정지]</span>}
                          </td>
                          <td className="px-6 py-4">
                            <span
                              className={`inline-flex px-2.5 py-1 rounded-full text-xs font-bold ${
                                row.user.isAdmin ? 'bg-red-100 text-red-600' :
                                row.certStatus === '유료' ? 'bg-[#0034d3]/20 text-slate-800' :
                                row.certStatus === '만료' ? 'bg-slate-200 text-slate-600' :
                                row.certStatus === '무료' ? 'bg-slate-100 text-slate-600' : 'bg-slate-100 text-slate-400'
                              }`}
                            >
                              {row.user.isAdmin ? 'Admin' : row.certStatus}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-sm text-slate-600">{row.certName}</td>
                          <td className="px-6 py-4 text-sm text-slate-600">
                            {(!prevRow || prevRow.user.id !== row.user.id) && row.user.id in questionCounts
                              ? `${questionCounts[row.user.id]}개`
                              : (!prevRow || prevRow.user.id !== row.user.id) ? '-' : ''}
                          </td>
                          <td className="px-6 py-4 relative">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (openDropdownId === row.user.id) {
                                  closeDropdown();
                                } else {
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  setDropdownAnchor({ top: rect.bottom + 4, left: Math.min(rect.right - 208, window.innerWidth - 220) });
                                  setOpenDropdownId(row.user.id);
                                }
                              }}
                              className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600"
                            >
                              <MoreVertical size={18} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {filteredRows.length === 0 ? (
                <div className="py-12 text-center text-slate-400">
                  {searchQuery || filterStatus || filterCertId ? '필터/검색 결과가 없습니다.' : '등록된 회원이 없습니다.'}
                </div>
              ) : (
                <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between">
                  <span className="text-sm text-slate-500">총 {filteredRows.length}건 (구독 행 기준)</span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      disabled={currentPage <= 1}
                      className="p-2 rounded-lg border border-slate-200 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50"
                    >
                      <ChevronLeft size={18} />
                    </button>
                    <span className="text-sm font-medium text-slate-700">
                      {currentPage} / {totalPages}
                    </span>
                    <button
                      onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      disabled={currentPage >= totalPages}
                      className="p-2 rounded-lg border border-slate-200 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50"
                    >
                      <ChevronRight size={18} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {(effectiveMenu === 'questions' || effectiveMenu === 'billing') && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-12 text-center text-slate-400">
            <p className="font-bold">준비 중입니다.</p>
          </div>
        )}
      </main>

      {modal === 'payment' && targetUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6 my-8">
            <h3 className="text-lg font-black text-slate-900 mb-1">수기 결제 / 권한 상세 수정</h3>
            <p className="text-sm text-slate-500 mb-4">{targetUser.email}</p>
            <div className="flex flex-wrap gap-2 mb-4 p-3 bg-slate-50 rounded-xl">
              <span className="text-xs font-bold text-slate-500">구독 요약:</span>
              {CERTIFICATIONS.map((cert) => {
                const entry = targetUser.rawMemberships?.[cert.code];
                const status = !entry ? '-' : entry.tier === 'PREMIUM' ? (entry.expiry_date && entry.expiry_date < today ? '만료' : '유료') : '무료';
                return (
                  <span
                    key={cert.code}
                    className={`px-2 py-1 rounded text-xs font-bold ${
                      status === '유료' ? 'bg-[#0034d3]/20 text-slate-800' :
                      status === '만료' ? 'bg-slate-200 text-slate-600' :
                      status === '무료' ? 'bg-slate-100 text-slate-600' : 'bg-slate-100 text-slate-400'
                    }`}
                  >
                    {getCertDisplayName(cert, certInfos[cert.code] ?? null)}: {status}
                  </span>
                );
              })}
            </div>
            <div className="flex items-center gap-2 mb-4 text-sm text-slate-600">
              <BookOpen size={16} />
              <span>푼 문제: {targetUser.id in questionCounts ? `${questionCounts[targetUser.id]}개` : '로딩 중...'}</span>
            </div>
            <div className="flex items-center gap-2 mb-6 text-sm text-slate-600">
              <Smartphone size={16} />
              <span>등록 기기: {(targetUser.registeredDevices?.length ?? 0)}개</span>
              {targetUser.registeredDevices?.length ? (
                <span className="ml-2 text-slate-400 text-xs">
                  ({targetUser.registeredDevices.slice(0, 2).join(', ')}
                  {(targetUser.registeredDevices?.length ?? 0) > 2 ? '...' : ''})
                </span>
              ) : null}
            </div>
            <div className="space-y-4 mb-6 max-h-64 overflow-y-auto">
              {CERTIFICATIONS.map((cert) => {
                const schedules = EXAM_SCHEDULES[cert.code] || [];
                return (
                  <div key={cert.id} className="p-4 border border-slate-200 rounded-xl space-y-3">
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        id={`cert-${cert.code}`}
                        checked={paymentForm[cert.code]?.checked ?? false}
                        onChange={(e) => setPaymentForm((prev) => ({ ...prev, [cert.code]: { ...prev[cert.code], checked: e.target.checked } }))}
                        className="w-4 h-4 rounded border-slate-300 text-[#0034d3] focus:ring-[#0034d3]"
                      />
                      <label htmlFor={`cert-${cert.code}`} className="font-bold text-slate-800">{getCertDisplayName(cert, certInfos[cert.code] ?? null)}</label>
                    </div>
                    <div className="grid grid-cols-2 gap-3 pl-7">
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">시작일</label>
                        <input
                          type="date"
                          value={paymentForm[cert.code]?.startDate ?? ''}
                          onChange={(e) => setPaymentForm((prev) => ({ ...prev, [cert.code]: { ...prev[cert.code], startDate: e.target.value } }))}
                          disabled={!paymentForm[cert.code]?.checked}
                          className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm disabled:opacity-50 disabled:bg-slate-50"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">종료일 (오늘 이전 = 만료)</label>
                        <input
                          type="date"
                          value={paymentForm[cert.code]?.expiryDate ?? ''}
                          onChange={(e) => setPaymentForm((prev) => ({ ...prev, [cert.code]: { ...prev[cert.code], expiryDate: e.target.value } }))}
                          disabled={!paymentForm[cert.code]?.checked}
                          className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm disabled:opacity-50 disabled:bg-slate-50"
                        />
                      </div>
                    </div>
                    <div className="pl-7">
                      <label className="block text-xs text-slate-500 mb-1">타겟 시험 회차</label>
                      <select
                        value={paymentForm[cert.code]?.targetScheduleId ?? ''}
                        onChange={(e) => setPaymentForm((prev) => ({ ...prev, [cert.code]: { ...prev[cert.code], targetScheduleId: e.target.value } }))}
                        disabled={!paymentForm[cert.code]?.checked}
                        className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm disabled:opacity-50 disabled:bg-slate-50"
                      >
                        <option value="">선택</option>
                        {schedules.map((s) => (
                          <option key={s.id} value={s.id}>{s.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex gap-3">
              <button onClick={() => { setModal(null); setTargetUser(null); }} className="flex-1 py-3 rounded-xl border border-slate-200 font-bold text-slate-600 hover:bg-slate-50">취소</button>
              <button onClick={handlePaymentSubmit} disabled={isSubmitting} className="flex-1 py-3 rounded-xl bg-[#0034d3] font-bold text-slate-900 hover:bg-[#003087] disabled:opacity-50">{isSubmitting ? '저장 중...' : '저장'}</button>
            </div>
          </div>
        </div>
      )}

      {(modal === 'confirmBan' || modal === 'confirmUnban') && targetUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6">
            <h3 className="text-lg font-black text-slate-900 mb-2">{modal === 'confirmBan' ? '이용 정지' : '정지 해제'}</h3>
            <p className="text-slate-600 text-sm mb-6">
              정말 {targetUser.name}({targetUser.email})님을 {modal === 'confirmBan' ? '정지' : '해제'}하시겠습니까?
            </p>
            <div className="flex gap-3">
              <button onClick={() => { setModal(null); setTargetUser(null); }} className="flex-1 py-3 rounded-xl border border-slate-200 font-bold text-slate-600 hover:bg-slate-50">취소</button>
              <button onClick={handleBanConfirm} disabled={isSubmitting} className={`flex-1 py-3 rounded-xl font-bold ${modal === 'confirmBan' ? 'bg-red-500 text-white hover:bg-red-600' : 'bg-emerald-500 text-white hover:bg-emerald-600'} disabled:opacity-50`}>
                {isSubmitting ? '처리 중...' : modal === 'confirmBan' ? '정지' : '해제'}
              </button>
            </div>
          </div>
        </div>
      )}

      {modal === 'confirmClearDevices' && targetUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6">
            <h3 className="text-lg font-black text-slate-900 mb-2">기기 초기화</h3>
            <p className="text-slate-600 text-sm mb-6">
              {targetUser.name}({targetUser.email})님의 등록 기기 ({(targetUser.registeredDevices?.length ?? 0)}개)를 모두 초기화합니다. 이후 새 기기에서 다시 로그인할 수 있습니다.
            </p>
            <div className="flex gap-3">
              <button onClick={() => { setModal(null); setTargetUser(null); }} className="flex-1 py-3 rounded-xl border border-slate-200 font-bold text-slate-600 hover:bg-slate-50">취소</button>
              <button onClick={handleClearDevicesConfirm} disabled={isSubmitting} className="flex-1 py-3 rounded-xl bg-[#003087] font-bold text-white hover:bg-[#003087] disabled:opacity-50">{isSubmitting ? '처리 중...' : '초기화'}</button>
            </div>
          </div>
        </div>
      )}

      {modal === 'memo' && targetUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-black text-slate-900 mb-1">관리자 메모</h3>
            <p className="text-sm text-slate-500 mb-4">{targetUser.email}</p>
            <textarea
              value={memoText}
              onChange={(e) => setMemoText(e.target.value)}
              placeholder="이 사용자에 대한 메모를 입력하세요..."
              rows={5}
              className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#0034d3]/50 focus:border-[#0034d3]"
            />
            <div className="flex gap-3 mt-4">
              <button onClick={() => { setModal(null); setTargetUser(null); }} className="flex-1 py-3 rounded-xl border border-slate-200 font-bold text-slate-600 hover:bg-slate-50">취소</button>
              <button onClick={handleMemoSave} disabled={isSubmitting} className="flex-1 py-3 rounded-xl bg-[#0034d3] font-bold text-slate-900 hover:bg-[#003087] disabled:opacity-50">{isSubmitting ? '저장 중...' : '저장'}</button>
            </div>
          </div>
        </div>
      )}

      {openDropdownId && dropdownAnchor && (() => {
        const openRow = allRows.find((r) => r.user.id === openDropdownId);
        if (!openRow) return null;
        return createPortal(
          <>
            <div className="fixed inset-0 z-[100]" onClick={closeDropdown} aria-hidden="true" />
            <div
              className="fixed z-[101] w-52 rounded-xl shadow-xl border border-slate-200 py-2 bg-white"
              style={{ top: dropdownAnchor.top, left: dropdownAnchor.left }}
            >
              <button onClick={() => handlePaymentModalOpen(openRow.user)} className="w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-100">
                <TicketIcon size={16} /> 수기 결제 / 권한 수정
              </button>
              <button onClick={() => handleMemoOpen(openRow.user)} className="w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-100">
                <FileText size={16} /> 메모
              </button>
              <button onClick={() => handlePasswordReset(openRow.user)} className="w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-100">
                <Mail size={16} /> 비밀번호 재설정 메일
              </button>
              <button onClick={() => handleClearDevicesClick(openRow.user)} className="w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-100">
                <Smartphone size={16} /> 기기 초기화
              </button>
              <button onClick={() => handleBanClick(openRow.user)} className="w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-100">
                {openRow.user.isBanned ? <><Unlock size={16} /> 정지 해제</> : <><Lock size={16} /> 이용 정지</>}
              </button>
            </div>
          </>,
          document.body
        );
      })()}

      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 px-6 py-3 rounded-xl shadow-lg font-bold text-sm ${toast.type === 'success' ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'}`}>
          {toast.message}
        </div>
      )}
    </div>
  );
};
