'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Button } from '@/components/ui/Button';
import { UserManagementTable } from '@/components/admin/UserManagementTable';
import { ResetPasswordModal } from '@/components/admin/ResetPasswordModal';
import { CreateUserModal } from '@/components/admin/CreateUserModal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useAuthStore } from '@/store/authStore';
import { adminApi, CreateUserResponse } from '@/lib/admin';
import { userSettingsApi } from '@/lib/user-settings';
import { AdminUser } from '@/types/auth';
import { createLogger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/errors';

const logger = createLogger('AdminUsers');

export default function AdminUsersPage() {
  const router = useRouter();
  const { user: currentUser } = useAuthStore();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [smtpConfigured, setSmtpConfigured] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);

  // Reset password modal state. Reused to surface a generated temporary
  // password both for admin resets and for newly created accounts.
  const [resetPasswordModal, setResetPasswordModal] = useState<{
    isOpen: boolean;
    temporaryPassword: string;
    userName: string;
    title?: string;
    description?: string;
  }>({ isOpen: false, temporaryPassword: '', userName: '' });

  // Confirm dialog state
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    variant: 'danger' | 'warning' | 'info';
    confirmLabel: string;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    variant: 'danger',
    confirmLabel: 'Confirm',
    onConfirm: () => {},
  });

  // Redirect non-admins
  useEffect(() => {
    if (currentUser && currentUser.role !== 'admin') {
      router.push('/dashboard');
    }
  }, [currentUser, router]);

  const loadUsers = useCallback(async () => {
    try {
      const data = await adminApi.getUsers();
      setUsers(data);
    } catch (error) {
      logger.error('Failed to load users:', error);
      toast.error(getErrorMessage(error, 'Failed to load users'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    userSettingsApi
      .getSmtpStatus()
      .then((status) => setSmtpConfigured(status.configured))
      .catch(() => setSmtpConfigured(false));
  }, []);

  const handleUserCreated = (result: CreateUserResponse) => {
    loadUsers();
    const userName =
      [result.firstName, result.lastName].filter(Boolean).join(' ') ||
      result.email ||
      'the new user';
    if (result.temporaryPassword) {
      setResetPasswordModal({
        isOpen: true,
        temporaryPassword: result.temporaryPassword,
        userName,
        title: result.upgraded ? 'Account Upgraded' : 'User Created',
        description: result.upgraded
          ? `An existing shared user was upgraded to a full account. Share this temporary password with ${userName}.`
          : `A temporary password was generated for ${userName}. Share it with them to sign in.`,
      });
    } else if (result.invited) {
      toast.success(`Invite email sent to ${result.email}`);
    } else {
      toast.success(
        result.upgraded
          ? `${userName} was upgraded to a full account`
          : `${userName} has been created`,
      );
    }
  };

  const handleChangeRole = async (user: AdminUser, role: 'admin' | 'user') => {
    if (role === user.role) return;

    const action = role === 'admin' ? 'promote' : 'demote';
    const userName = user.firstName || user.email || 'this user';

    setConfirmDialog({
      isOpen: true,
      title: `${role === 'admin' ? 'Promote' : 'Demote'} User?`,
      message: `Are you sure you want to ${action} ${userName} to ${role}?`,
      variant: role === 'admin' ? 'info' : 'warning',
      confirmLabel: role === 'admin' ? 'Promote to Admin' : 'Demote to User',
      onConfirm: async () => {
        try {
          const updated = await adminApi.updateUserRole(user.id, role);
          setUsers((prev) => prev.map((u) => (u.id === user.id ? updated : u)));
          toast.success(`${userName} is now ${role === 'admin' ? 'an admin' : 'a user'}`);
        } catch (error) {
          toast.error(getErrorMessage(error, `Failed to ${action} user`));
          // Reload to reset the select back to the actual value
          loadUsers();
        }
        setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
      },
    });
  };

  const handleToggleStatus = async (user: AdminUser) => {
    const newStatus = !user.isActive;
    const userName = user.firstName || user.email || 'this user';
    const action = newStatus ? 'enable' : 'disable';

    if (!newStatus) {
      // Confirm before disabling
      setConfirmDialog({
        isOpen: true,
        title: 'Disable User?',
        message: `Are you sure you want to disable ${userName}? They will be unable to log in.`,
        variant: 'warning',
        confirmLabel: 'Disable User',
        onConfirm: async () => {
          try {
            const updated = await adminApi.updateUserStatus(user.id, false);
            setUsers((prev) => prev.map((u) => (u.id === user.id ? updated : u)));
            toast.success(`${userName} has been disabled`);
          } catch (error) {
            toast.error(getErrorMessage(error, 'Failed to disable user'));
          }
          setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
        },
      });
    } else {
      // Enable without confirmation
      try {
        const updated = await adminApi.updateUserStatus(user.id, true);
        setUsers((prev) => prev.map((u) => (u.id === user.id ? updated : u)));
        toast.success(`${userName} has been enabled`);
      } catch (error) {
        toast.error(getErrorMessage(error, `Failed to ${action} user`));
      }
    }
  };

  const handleResetPassword = (user: AdminUser) => {
    const userName = user.firstName || user.email || 'this user';

    setConfirmDialog({
      isOpen: true,
      title: 'Reset Password?',
      message: `This will generate a new temporary password for ${userName}. They will be required to change it on next login.`,
      variant: 'warning',
      confirmLabel: 'Reset Password',
      onConfirm: async () => {
        try {
          const result = await adminApi.resetUserPassword(user.id);
          setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
          setResetPasswordModal({
            isOpen: true,
            temporaryPassword: result.temporaryPassword,
            userName: userName,
          });
        } catch (error) {
          toast.error(getErrorMessage(error, 'Failed to reset password'));
          setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
        }
      },
    });
  };

  const handleDeleteUser = (user: AdminUser) => {
    const userName = user.firstName || user.email || 'this user';

    setConfirmDialog({
      isOpen: true,
      title: 'Delete User?',
      message:
        `Are you sure you want to delete ${userName}? This will permanently ` +
        'remove their account and all associated data. This action cannot ' +
        'be undone. If they are a delegate of another account, their own ' +
        'data is removed but their login is kept so the delegation still ' +
        'works -- they become a delegate-only user.',
      variant: 'danger',
      confirmLabel: 'Delete User',
      onConfirm: async () => {
        try {
          const res = await adminApi.deleteUser(user.id);
          setUsers((prev) => prev.filter((u) => u.id !== user.id));
          if (res.downgraded) {
            toast.success(
              `${userName}'s own data was removed; their delegate access remains.`,
            );
          } else {
            toast.success(`${userName} has been deleted`);
          }
        } catch (error) {
          toast.error(getErrorMessage(error, 'Failed to delete user'));
        }
        setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
      },
    });
  };

  if (currentUser?.role !== 'admin') {
    return null;
  }

  return (
    <ProtectedRoute>
      <PageLayout>
        <main className="px-4 sm:px-6 lg:px-12 pt-6 pb-8">
          <PageHeader
            title="User Management"
            subtitle={`${users.length} user${users.length !== 1 ? 's' : ''}`}
            actions={
              <Button onClick={() => setCreateModalOpen(true)}>Add User</Button>
            }
          />

          <div className="bg-white dark:bg-gray-900 shadow rounded-lg overflow-hidden">
          {isLoading ? (
            <LoadingSpinner text="Loading users..." />
          ) : (
            <UserManagementTable
              users={users}
              currentUserId={currentUser.id}
              onChangeRole={handleChangeRole}
              onToggleStatus={handleToggleStatus}
              onResetPassword={handleResetPassword}
              onDeleteUser={handleDeleteUser}
            />
          )}
        </div>
        </main>

        <ConfirmDialog
          isOpen={confirmDialog.isOpen}
          title={confirmDialog.title}
          message={confirmDialog.message}
          variant={confirmDialog.variant}
          confirmLabel={confirmDialog.confirmLabel}
          onConfirm={confirmDialog.onConfirm}
          onCancel={() => setConfirmDialog((prev) => ({ ...prev, isOpen: false }))}
        />

        <ResetPasswordModal
          isOpen={resetPasswordModal.isOpen}
          temporaryPassword={resetPasswordModal.temporaryPassword}
          userName={resetPasswordModal.userName}
          title={resetPasswordModal.title}
          description={resetPasswordModal.description}
          onClose={() => setResetPasswordModal((prev) => ({ ...prev, isOpen: false }))}
        />

        <CreateUserModal
          isOpen={createModalOpen}
          smtpConfigured={smtpConfigured}
          onClose={() => setCreateModalOpen(false)}
          onCreated={handleUserCreated}
        />
      </PageLayout>
    </ProtectedRoute>
  );
}
