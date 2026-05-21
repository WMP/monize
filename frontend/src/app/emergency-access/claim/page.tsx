'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import '@/lib/zodConfig';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Link from 'next/link';
import Image from 'next/image';
import toast from 'react-hot-toast';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { emergencyAccessApi } from '@/lib/emergency-access';
import {
  passwordSchema,
  PASSWORD_REQUIREMENTS_TEXT,
} from '@/lib/zod-helpers';
import { getErrorMessage } from '@/lib/errors';
import type { EmergencyAccessClaimPreview } from '@/types/emergency-access';

const schema = z
  .object({
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

type FormData = z.infer<typeof schema>;

function EmergencyClaimForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const [loadingPreview, setLoadingPreview] = useState(true);
  const [preview, setPreview] = useState<EmergencyAccessClaimPreview | null>(
    null,
  );
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  useEffect(() => {
    if (!token) {
      setLoadingPreview(false);
      return;
    }
    let cancelled = false;
    emergencyAccessApi
      .previewClaim(token)
      .then((p) => {
        if (!cancelled) setPreview(p);
      })
      .catch((err) => {
        if (cancelled) return;
        setPreviewError(
          getErrorMessage(
            err,
            'This emergency access link is invalid, expired, or has already been used.',
          ),
        );
      })
      .finally(() => {
        if (!cancelled) setLoadingPreview(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (!token) {
    return (
      <div className="text-center space-y-4">
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <p className="text-sm text-red-800 dark:text-red-200">
            Missing emergency access token.
          </p>
        </div>
      </div>
    );
  }

  if (loadingPreview) {
    return (
      <div className="flex justify-center items-center py-8">
        <LoadingSpinner />
      </div>
    );
  }

  if (previewError || !preview) {
    return (
      <div className="text-center space-y-4">
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <p className="text-sm text-red-800 dark:text-red-200">
            {previewError ?? 'Link is no longer valid.'}
          </p>
        </div>
        <Link
          href="/login"
          className="inline-block font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300"
        >
          Back to sign in
        </Link>
      </div>
    );
  }

  const ownerName =
    [preview.ownerFirstName, preview.ownerLastName].filter(Boolean).join(' ') ||
    'the account owner';

  const onSubmit = async (data: FormData) => {
    setSubmitting(true);
    try {
      await emergencyAccessApi.completeClaim(token, data.newPassword);
      toast.success(`You now have access to ${ownerName}'s account.`);
      router.push('/dashboard');
    } catch (err) {
      toast.error(
        getErrorMessage(
          err,
          'Failed to complete emergency access claim. The link may have expired or already been used.',
        ),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mt-8 space-y-6">
      <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4 space-y-2">
        <p className="text-sm text-blue-900 dark:text-blue-100">
          Hi {preview.contactFirstName}, you were designated as an emergency
          contact on <strong>{ownerName}</strong>&apos;s Monize account.
        </p>
        <p className="text-sm text-blue-900 dark:text-blue-100">
          Setting a password here will sign you in as the account holder and
          give you full access to the account. Existing sessions are revoked
          and the previous credentials are replaced.
        </p>
      </div>

      {preview.message && (
        <div className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">
            Message from {preview.ownerFirstName ?? 'the owner'}
          </h3>
          <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap font-mono">
            {preview.message}
          </p>
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div>
          <Input
            label="New Password"
            type="password"
            autoComplete="new-password"
            error={errors.newPassword?.message}
            {...register('newPassword')}
          />
          {!errors.newPassword && (
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {PASSWORD_REQUIREMENTS_TEXT}
            </p>
          )}
        </div>
        <Input
          label="Confirm Password"
          type="password"
          autoComplete="new-password"
          error={errors.confirmPassword?.message}
          {...register('confirmPassword')}
        />
        <Button
          type="submit"
          variant="primary"
          size="lg"
          isLoading={submitting}
          className="w-full"
        >
          Claim emergency access
        </Button>
      </form>
    </div>
  );
}

export default function EmergencyClaimPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <Image
            src="/icons/monize-logo.svg"
            alt="Monize"
            width={96}
            height={96}
            className="mx-auto rounded-xl"
            priority
          />
          <h2 className="mt-4 text-center text-3xl font-extrabold text-gray-900 dark:text-gray-100">
            Emergency Access
          </h2>
        </div>
        <Suspense
          fallback={
            <div className="text-center text-gray-500 dark:text-gray-400">
              Loading...
            </div>
          }
        >
          <EmergencyClaimForm />
        </Suspense>
      </div>
    </div>
  );
}
