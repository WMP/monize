'use client';

import { useState, useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/Button';
import { authApi } from '@/lib/auth';
import {
  isLogoutIncomplete,
  clearLogoutIncomplete,
} from '@/lib/logout-state';

// The flag is client-only and not reactive: it changes on a successful retry
// (handled below by `dismissed`) or on the next sign-out, never while this
// screen is mounted -- so `subscribe` is a no-op. `getServerSnapshot` returns
// false so the server-rendered /login and the first client render agree, and
// sessionStorage (which is undefined during SSR) is only read on the client.
const subscribe = () => () => {};
const getSnapshot = () => isLogoutIncomplete();
const getServerSnapshot = () => false;

/**
 * Shown on the login screen when the last sign-out cleared local state but the
 * server never confirmed it. The refresh cookie is HttpOnly, so at that point
 * the session may still be usable from another tab or a later refresh -- which
 * the ordinary signed-out screen would silently present as a completed logout.
 *
 * The retry is the only thing that can actually finish the job, so it stays on
 * screen until it succeeds rather than disappearing on a timer.
 */
export function IncompleteLogoutNotice() {
  const t = useTranslations('auth');
  const incomplete = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  // A successful retry clears the flag; `dismissed` hides the notice for the
  // rest of this render without depending on sessionStorage being reactive.
  const [dismissed, setDismissed] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);

  if (!incomplete || dismissed) return null;

  const retry = async () => {
    setIsRetrying(true);
    try {
      await authApi.logout();
      clearLogoutIncomplete();
      setDismissed(true);
      // Reuse AppHeader's 'logout-failed' toast id: this outcome is about the
      // same sign-out, so the success here replaces the failure toast that
      // AppHeader raised, and repeated retries never stack.
      toast.success(t('signIn.logoutRetrySucceeded'), { id: 'logout-failed' });
    } catch {
      // Still unreachable. Keep the warning up -- the session is still live.
      // Repeat AppHeader's 12s dwell: reusing the id would otherwise reset this
      // still-unresolved warning to the default (~4s) error duration.
      toast.error(t('signIn.logoutRetryFailed'), { duration: 12_000, id: 'logout-failed' });
    } finally {
      setIsRetrying(false);
    }
  };

  return (
    <div
      // A persistent banner, not a transient interruption: `status` (polite)
      // rather than `alert` (assertive) so a screen reader is not told about the
      // same failed sign-out twice -- AppHeader's toast already announced it
      // assertively just before this screen mounted.
      role="status"
      className="bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-lg p-4 space-y-3"
    >
      <p className="text-sm text-amber-800 dark:text-amber-200">
        {t('signIn.logoutNotConfirmedDetail')}
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={retry}
        isLoading={isRetrying}
      >
        {t('signIn.retryLogout')}
      </Button>
    </div>
  );
}
