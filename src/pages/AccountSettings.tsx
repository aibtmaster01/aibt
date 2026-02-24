import React, { useState } from 'react';
import type { User } from '../types';
import {
  updateDisplayName,
  changePassword,
  deleteAccount,
  AuthError,
} from '../services/authService';
import { User as UserIcon, Mail, Lock, Trash2, Ticket } from 'lucide-react';

export interface AccountSettingsProps {
  user: User;
  onBack: () => void;
  onUpdateUser: (updater: (prev: User) => User) => void;
  onLogout: () => void;
}

export const AccountSettings: React.FC<AccountSettingsProps> = ({
  user,
  onBack,
  onUpdateUser,
  onLogout,
}) => {
  const [familyName, setFamilyName] = useState(user.familyName || '김');
  const [givenName, setGivenName] = useState(user.givenName || user.name.replace(/^김/, '') || '');
  const [nameSaving, setNameSaving] = useState(false);
  const [nameError, setNameError] = useState('');

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState('');

  const [couponCode, setCouponCode] = useState('');

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);

  const handleSaveName = async () => {
    const f = familyName.trim();
    const g = givenName.trim();
    if (!f || !g) {
      setNameError('성과 이름을 모두 입력해 주세요.');
      return;
    }
    setNameError('');
    setNameSaving(true);
    try {
      await updateDisplayName(user.id, f, g);
      onUpdateUser((u) => ({ ...u, familyName: f, givenName: g, name: f + g }));
    } catch (e) {
      setNameError(e instanceof AuthError ? e.message : '저장에 실패했습니다.');
    } finally {
      setNameSaving(false);
    }
  };

  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword || !newPasswordConfirm) {
      setPasswordError('모든 항목을 입력해 주세요.');
      return;
    }
    if (newPassword.length < 6) {
      setPasswordError('새 비밀번호는 6자 이상이어야 합니다.');
      return;
    }
    if (newPassword !== newPasswordConfirm) {
      setPasswordError('새 비밀번호가 일치하지 않습니다.');
      return;
    }
    setPasswordError('');
    setPasswordSaving(true);
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setNewPasswordConfirm('');
    } catch (e) {
      setPasswordError(e instanceof AuthError ? e.message : '비밀번호 변경에 실패했습니다.');
    } finally {
      setPasswordSaving(false);
    }
  };

  const handleDeleteAccount = async () => {
    const pwd = deletePassword.trim();
    if (!pwd) {
      setDeleteError('비밀번호를 입력해 주세요.');
      return;
    }
    setDeleteError('');
    setDeleteLoading(true);
    try {
      await deleteAccount(pwd);
      setShowDeleteModal(false);
      onLogout();
    } catch (e) {
      setDeleteError(e instanceof AuthError ? e.message : '탈퇴 처리에 실패했습니다.');
    } finally {
      setDeleteLoading(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto px-5 py-8">
      <h1 className="text-2xl font-black text-slate-900 mb-8">계정 설정</h1>

      {/* 이름 (성 + 이름) */}
      <section className="bg-white rounded-2xl border border-slate-200 p-6 mb-6 shadow-sm">
        <div className="flex items-center gap-2 text-slate-700 font-semibold mb-3">
          <UserIcon size={18} /> 이름
        </div>
        <div className="flex gap-3 mb-3">
          <input
            type="text"
            value={familyName}
            onChange={(e) => setFamilyName(e.target.value)}
            className="w-24 px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-[#0034d3] focus:border-transparent"
            placeholder="성"
            required
          />
          <input
            type="text"
            value={givenName}
            onChange={(e) => setGivenName(e.target.value)}
            className="flex-1 px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-[#0034d3] focus:border-transparent"
            placeholder="이름"
            required
          />
          <button
            type="button"
            onClick={handleSaveName}
            disabled={nameSaving}
            className="px-5 py-3 rounded-xl font-bold bg-[#0034d3] text-white hover:bg-[#003087] disabled:opacity-60"
          >
            {nameSaving ? '저장 중…' : '저장'}
          </button>
        </div>
        {nameError && <p className="mt-2 text-sm text-red-500">{nameError}</p>}
      </section>

      {/* 이메일 (읽기 전용) */}
      <section className="bg-white rounded-2xl border border-slate-200 p-6 mb-6 shadow-sm">
        <div className="flex items-center gap-2 text-slate-700 font-semibold mb-3">
          <Mail size={18} /> 이메일
        </div>
        <p className="text-slate-600">{user.email}</p>
        <p className="text-slate-400 text-sm mt-1">이메일은 변경할 수 없습니다.</p>
      </section>

      {/* 쿠폰 입력 */}
      <section className="bg-white rounded-2xl border border-slate-200 p-6 mb-6 shadow-sm">
        <div className="flex items-center gap-2 text-slate-700 font-semibold mb-3">
          <Ticket size={18} /> 쿠폰
        </div>
        <div className="flex gap-3">
          <input
            type="text"
            value={couponCode}
            onChange={(e) => setCouponCode(e.target.value)}
            className="flex-1 px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-[#0034d3] focus:border-transparent"
            placeholder="쿠폰 코드 입력"
          />
          <button
            type="button"
            disabled={!couponCode}
            className="px-5 py-3 rounded-xl font-bold bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            등록
          </button>
        </div>
        <p className="text-slate-400 text-sm mt-2">보유한 쿠폰 코드를 입력하면 혜택을 적용할 수 있습니다.</p>
      </section>

      {/* 비밀번호 변경 */}
      <section className="bg-white rounded-2xl border border-slate-200 p-6 mb-6 shadow-sm">
        <div className="flex items-center gap-2 text-slate-700 font-semibold mb-3">
          <Lock size={18} /> 비밀번호 변경
        </div>
        <div className="space-y-3">
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-[#0034d3]"
            placeholder="현재 비밀번호"
          />
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-[#0034d3]"
            placeholder="새 비밀번호"
          />
          <input
            type="password"
            value={newPasswordConfirm}
            onChange={(e) => setNewPasswordConfirm(e.target.value)}
            className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-[#0034d3]"
            placeholder="새 비밀번호 확인"
          />
        </div>
        {passwordError && <p className="mt-2 text-sm text-red-500">{passwordError}</p>}
        <button
          type="button"
          onClick={handleChangePassword}
          disabled={passwordSaving}
          className="mt-4 px-5 py-3 rounded-xl font-bold bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-60"
        >
          {passwordSaving ? '변경 중…' : '비밀번호 변경'}
        </button>
      </section>

      {/* 회원 탈퇴 */}
      <section className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
        <div className="flex items-center gap-2 text-slate-700 font-semibold mb-3">
          <Trash2 size={18} /> 회원 탈퇴
        </div>
        <p className="text-slate-500 text-sm mb-4">
          탈퇴 시 모든 데이터가 삭제되며 복구할 수 없습니다.
        </p>
        <button
          type="button"
          onClick={() => setShowDeleteModal(true)}
          className="px-5 py-3 rounded-xl font-bold border-2 border-red-200 text-red-600 hover:bg-red-50"
        >
          회원 탈퇴
        </button>
      </section>

      {/* 회원 탈퇴 확인 모달 */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-5">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => !deleteLoading && setShowDeleteModal(false)}
          />
          <div className="bg-white w-full max-w-sm rounded-[2rem] p-8 relative z-10 shadow-2xl">
            <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center text-red-600 mx-auto mb-6">
              <Trash2 size={24} />
            </div>
            <h3 className="text-xl font-black text-slate-900 mb-2 text-center">회원 탈퇴</h3>
            <p className="text-slate-500 text-sm mb-4 text-center">
              정말 탈퇴하시겠습니까? 모든 데이터가 삭제되며 복구할 수 없습니다.
            </p>
            <input
              type="password"
              value={deletePassword}
              onChange={(e) => setDeletePassword(e.target.value)}
              placeholder="비밀번호 입력"
              className="w-full px-4 py-3 rounded-xl border border-slate-200 mb-2 focus:outline-none focus:ring-2 focus:ring-red-500"
            />
            {deleteError && <p className="text-sm text-red-500 mb-2">{deleteError}</p>}
            <div className="flex gap-3 mt-4">
              <button
                type="button"
                onClick={() => setShowDeleteModal(false)}
                disabled={deleteLoading}
                className="flex-1 py-3 rounded-xl font-bold border-2 border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-60"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleDeleteAccount}
                disabled={deleteLoading}
                className="flex-1 py-3 rounded-xl font-bold bg-red-600 text-white hover:bg-red-700 disabled:opacity-60"
              >
                {deleteLoading ? '처리 중…' : '탈퇴하기'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
