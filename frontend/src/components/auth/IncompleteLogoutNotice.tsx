'use client';

import { useState, useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/Button';
import { authApi } from '@/lib/auth';
import {
  isLogoutIncomplete,
  clearLogoutIncomplete,
  subscribeLogoutIncomplete,
  LOGOUT_FAILED_TOAST_ID,
} from '@/lib/logout-state';

// The flag lives outside React (sessionStorage), so read it through
// useSyncExternalStore: it stays in sync when a sign-in in another flow clears
// the flag while this notice is mounted, and `getServerSnapshot` returns false
// so the server-rendered /login and the first client render agree (sessionStorage
// is undefined during SSR and is only read on the client).
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
  const incomplete = useSyncExternalStore(
    subscribeLogoutIncomplete,
    getSnapshot,
    getServerSnapshot,
  );
  const [isRetrying, setIsRetrying] = useState(false);

  if (!incomplete) return null;

  const retry = async () => {
    setIsRetrying(true);
    try {
      await authApi.logout();
      // Resolves the state: dismisses the failure toast and notifies this
      // notice to unmount. The success toast then stands alone.
      clearLogoutIncomplete();
      toast.success(t('signIn.logoutRetrySucceeded'));
    } catch {
      // Still unreachable. Keep the warning up -- the session is still live.
      // Reuse the shared id so repeated retries dedup, with AppHeader's 12s
      // dwell rather than the default (~4s) error duration.
      toast.error(t('signIn.logoutRetryFailed'), {
        duration: 12_000,
        id: LOGOUT_FAILED_TOAST_ID,
      });
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
