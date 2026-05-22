'use client';

import { useState } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { PasswordInput } from '@/components/ui/PasswordInput';
import { adminApi, CreateUserResponse } from '@/lib/admin';
import { passwordSchema, PASSWORD_REQUIREMENTS_TEXT } from '@/lib/zod-helpers';
import { getErrorMessage } from '@/lib/errors';

type CredentialMethod = 'invite' | 'password' | 'temporary';

interface CreateUserModalProps {
  isOpen: boolean;
  smtpConfigured: boolean;
  onClose: () => void;
  onCreated: (result: CreateUserResponse) => void;
}

export function CreateUserModal({
  isOpen,
  smtpConfigured,
  onClose,
  onCreated,
}: CreateUserModalProps) {
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [role, setRole] = useState<'admin' | 'user'>('user');
  const [method, setMethod] = useState<CredentialMethod>(
    smtpConfigured ? 'invite' : 'password',
  );
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Reset the form to its initial state whenever the modal transitions open.
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setEmail('');
      setFirstName('');
      setLastName('');
      setRole('user');
      setMethod(smtpConfigured ? 'invite' : 'password');
      setPassword('');
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      toast.error('Email is required.');
      return;
    }

    if (method === 'password') {
      const parsed = passwordSchema.safeParse(password);
      if (!parsed.success) {
        toast.error(parsed.error.issues[0]?.message ?? 'Invalid password.');
        return;
      }
    }

    setSubmitting(true);
    try {
      const result = await adminApi.createUser({
        email: trimmedEmail,
        firstName: firstName.trim() || undefined,
        lastName: lastName.trim() || undefined,
        role,
        password: method === 'password' ? password : undefined,
        sendInvite: method === 'invite',
      });
      onCreated(result);
      onClose();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to create user'));
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass =
    'w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100';

  return (
    <Modal isOpen={isOpen} onClose={onClose} maxWidth="lg" pushHistory>
      <form onSubmit={handleSubmit}>
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">
            Add User
          </h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Create a new account. You can email an invite, set a password
            yourself, or generate a temporary one to share.
          </p>
        </div>

        <div className="px-6 py-4 space-y-4">
          <Input
            type="email"
            label="Email"
            required
            placeholder="user@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="First name (optional)"
              placeholder="First name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
            />
            <Input
              label="Last name (optional)"
              placeholder="Last name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
            />
          </div>

          <Select
            label="Role"
            value={role}
            onChange={(e) => setRole(e.target.value as 'admin' | 'user')}
            options={[
              { value: 'user', label: 'User' },
              { value: 'admin', label: 'Admin' },
            ]}
          />

          <fieldset className="space-y-2">
            <legend className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Credentials
            </legend>

            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                name="credential-method"
                className="mt-1"
                checked={method === 'invite'}
                disabled={!smtpConfigured}
                onChange={() => setMethod('invite')}
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">
                Send an email invite to set a password
                {!smtpConfigured && (
                  <span className="block text-xs text-gray-500 dark:text-gray-400">
                    Requires SMTP to be configured.
                  </span>
                )}
              </span>
            </label>

            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                name="credential-method"
                className="mt-1"
                checked={method === 'password'}
                onChange={() => setMethod('password')}
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">
                Set a password now
              </span>
            </label>

            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                name="credential-method"
                className="mt-1"
                checked={method === 'temporary'}
                onChange={() => setMethod('temporary')}
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">
                Generate a temporary password
                <span className="block text-xs text-gray-500 dark:text-gray-400">
                  Shown once after creation. The user must change it on first
                  login.
                </span>
              </span>
            </label>
          </fieldset>

          {method === 'password' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Password
              </label>
              <PasswordInput
                required
                placeholder="Set a password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {PASSWORD_REQUIREMENTS_TEXT}
              </p>
            </div>
          )}
        </div>

        <div className="border-t border-gray-200 dark:border-gray-700 px-6 py-4 flex justify-end gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button type="submit" isLoading={submitting}>
            Create User
          </Button>
        </div>
      </form>
    </Modal>
  );
}
