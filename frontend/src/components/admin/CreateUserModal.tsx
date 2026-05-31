'use client';

import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { PasswordInput } from '@/components/ui/PasswordInput';
import { adminApi, CreateUserResponse } from '@/lib/admin';
import { passwordSchema, PASSWORD_REQUIREMENTS_TEXT, emailSchema } from '@/lib/zod-helpers';
import { getErrorMessage } from '@/lib/errors';

type CredentialMethod = 'invite' | 'password' | 'temporary';

// The password field is only validated when the "password" credential method
// is chosen; for invite/temporary it is left blank. A superRefine keeps the
// shared passwordSchema rules without forcing a password for the other methods.
const createUserSchema = z
  .object({
    email: emailSchema,
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    role: z.enum(['user', 'admin']),
    method: z.enum(['invite', 'password', 'temporary']),
    password: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.method === 'password') {
      const result = passwordSchema.safeParse(data.password ?? '');
      if (!result.success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['password'],
          message: result.error.issues[0]?.message ?? 'Invalid password.',
        });
      }
    }
  });

type CreateUserFormData = z.infer<typeof createUserSchema>;

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
  const defaultMethod: CredentialMethod = smtpConfigured ? 'invite' : 'password';

  const {
    control,
    register,
    handleSubmit,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateUserFormData>({
    resolver: zodResolver(createUserSchema),
    defaultValues: {
      email: '',
      firstName: '',
      lastName: '',
      role: 'user',
      method: defaultMethod,
      password: '',
    },
  });

  const method = useWatch({ control, name: 'method' });

  // Reset the form to its initial state whenever the modal transitions open.
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      reset({
        email: '',
        firstName: '',
        lastName: '',
        role: 'user',
        method: defaultMethod,
        password: '',
      });
    }
  }

  const onSubmit = async (data: CreateUserFormData) => {
    try {
      const result = await adminApi.createUser({
        email: data.email.trim(),
        firstName: data.firstName?.trim() || undefined,
        lastName: data.lastName?.trim() || undefined,
        role: data.role,
        password: data.method === 'password' ? data.password : undefined,
        sendInvite: data.method === 'invite',
      });
      onCreated(result);
      onClose();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to create user'));
    }
  };

  const inputClass =
    'w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100';

  return (
    <Modal isOpen={isOpen} onClose={onClose} maxWidth="lg" pushHistory>
      <form onSubmit={handleSubmit(onSubmit)}>
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
            error={errors.email?.message}
            {...register('email')}
          />

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="First name (optional)"
              placeholder="First name"
              {...register('firstName')}
            />
            <Input
              label="Last name (optional)"
              placeholder="Last name"
              {...register('lastName')}
            />
          </div>

          <Select
            label="Role"
            options={[
              { value: 'user', label: 'User' },
              { value: 'admin', label: 'Admin' },
            ]}
            {...register('role')}
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
                onChange={() => setValue('method', 'invite')}
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
                onChange={() => setValue('method', 'password')}
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
                onChange={() => setValue('method', 'temporary')}
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
                className={inputClass}
                {...register('password')}
              />
              {errors.password?.message ? (
                <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                  {errors.password.message}
                </p>
              ) : (
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {PASSWORD_REQUIREMENTS_TEXT}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="border-t border-gray-200 dark:border-gray-700 px-6 py-4 flex justify-end gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button type="submit" isLoading={isSubmitting}>
            Create User
          </Button>
        </div>
      </form>
    </Modal>
  );
}
