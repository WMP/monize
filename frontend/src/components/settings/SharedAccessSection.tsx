'use client';

import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { delegationApi, DelegateSummary } from '@/lib/delegation';
import { accountsApi } from '@/lib/accounts';
import { Account } from '@/types/account';
import { createLogger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/errors';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { UnsavedChangesDialog } from '@/components/ui/UnsavedChangesDialog';
import { useFormModal } from '@/hooks/useFormModal';
import { passwordSchema, PASSWORD_REQUIREMENTS_TEXT } from '@/lib/zod-helpers';
import { DelegateAccessModal } from './DelegateAccessModal';

const logger = createLogger('SharedAccess');

function sectionCount(d: DelegateSummary): number {
  const s = d.sections;
  if (!s) return 0;
  return [s.bills, s.investments, s.budgets, s.reports, s.ai].filter(Boolean)
    .length;
}

function accountCount(d: DelegateSummary): number {
  return d.grants.filter((g) => g.canRead).length;
}

function sharedDataCount(d: DelegateSummary): number {
  const c = d.capabilities;
  return [c.payees, c.categories, c.tags].reduce(
    (n, r) =>
      n + (r.create ? 1 : 0) + (r.edit ? 1 : 0) + (r.delete ? 1 : 0),
    0,
  );
}

export function SharedAccessSection() {
  const [delegates, setDelegates] = useState<DelegateSummary[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [password, setPassword] = useState('');
  const [sendInvite, setSendInvite] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const {
    showForm,
    editingItem,
    openEdit,
    close,
    modalProps,
    setFormDirty,
    unsavedChangesDialog,
    formSubmitRef,
  } = useFormModal<DelegateSummary>();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, a] = await Promise.all([
        delegationApi.listDelegates(),
        accountsApi.getAll(),
      ]);
      setDelegates(d);
      setAccounts(a);
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to load shared access'));
      logger.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!sendInvite && password) {
      const parsed = passwordSchema.safeParse(password);
      if (!parsed.success) {
        toast.error(PASSWORD_REQUIREMENTS_TEXT);
        return;
      }
    }

    setSubmitting(true);
    try {
      const res = await delegationApi.createDelegate({
        email: email.trim(),
        firstName: firstName.trim() || undefined,
        password: sendInvite ? undefined : password || undefined,
        sendInvite,
      });
      if (res.temporaryPassword) {
        toast.success(
          `Delegate created. Temporary password: ${res.temporaryPassword}`,
          { duration: 12000 },
        );
      } else if (res.invited) {
        toast.success('Invitation email sent');
      } else {
        toast.success('Delegate created');
      }
      setEmail('');
      setFirstName('');
      setPassword('');
      setSendInvite(false);
      await load();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to create delegate'));
      logger.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevoke = async (id: string) => {
    if (
      !window.confirm(
        'Remove this delegate? They lose access to your account. If they ' +
          'have no other shared access and no account of their own, their ' +
          'login is deleted entirely.',
      )
    ) {
      return;
    }
    try {
      await delegationApi.revokeDelegate(id);
      toast.success('Delegate removed');
      await load();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to revoke delegate'));
      logger.error(err);
    }
  };

  const handleResetPassword = async (id: string) => {
    try {
      const res = await delegationApi.resetPassword(id);
      toast.success(`Temporary password: ${res.temporaryPassword}`, {
        duration: 12000,
      });
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to reset password'));
      logger.error(err);
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 shadow dark:shadow-gray-700/50 rounded-lg p-6 mb-6">
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        Delegates sign in with their own credentials and never see your
        password. They only see the accounts and sections you grant them.
      </p>

      <form
        onSubmit={handleCreate}
        className="grid gap-3 sm:grid-cols-2 mb-6 border-b border-gray-200 dark:border-gray-700 pb-6"
      >
        <input
          type="email"
          required
          placeholder="Delegate email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-sm"
        />
        <input
          type="text"
          placeholder="First name (optional)"
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          className="rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-sm"
        />

        <div className="sm:col-span-2 flex items-center gap-3">
          <ToggleSwitch
            checked={sendInvite}
            onChange={setSendInvite}
            label="Send an email invite instead of setting a password"
          />
          <span className="text-sm text-gray-700 dark:text-gray-300">
            Send an email invite instead of setting a password
          </span>
        </div>

        {!sendInvite && (
          <div className="sm:col-span-2">
            <input
              type="password"
              placeholder="Set a password (optional)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-sm"
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {PASSWORD_REQUIREMENTS_TEXT} Leave blank to auto-generate a
              temporary password.
            </p>
          </div>
        )}

        <div className="sm:col-span-2">
          <button
            type="submit"
            disabled={submitting}
            className="rounded bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white px-4 py-2 text-sm font-medium"
          >
            {submitting ? 'Adding...' : 'Add delegate'}
          </button>
        </div>
      </form>

      {loading ? (
        <p className="text-sm text-gray-500">Loading...</p>
      ) : delegates.length === 0 ? (
        <p className="text-sm text-gray-500">No delegates yet.</p>
      ) : (
        <ul className="space-y-3">
          {delegates.map((d) => (
            <li
              key={d.id}
              className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 flex flex-wrap items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <p className="font-medium text-gray-900 dark:text-white truncate">
                  {d.delegate.email}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Status: {d.status} &middot; Sections: {sectionCount(d)}{' '}
                  &middot; Accounts: {accountCount(d)} &middot; Shared data:{' '}
                  {sharedDataCount(d)}
                </p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => openEdit(d)}>
                  Edit access
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleResetPassword(d.id)}
                >
                  Reset password
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => handleRevoke(d.id)}
                >
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal
        isOpen={showForm}
        onClose={close}
        maxWidth="4xl"
        {...modalProps}
      >
        {editingItem && (
          <DelegateAccessModal
            delegate={editingItem}
            accounts={accounts}
            onCancel={close}
            onSaved={() => {
              close();
              void load();
            }}
            setFormDirty={setFormDirty}
            submitRef={formSubmitRef}
          />
        )}
      </Modal>

      <UnsavedChangesDialog {...unsavedChangesDialog} />
    </div>
  );
}
