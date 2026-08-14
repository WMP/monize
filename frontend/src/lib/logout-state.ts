import toast from 'react-hot-toast';

/**
 * A logout the server never confirmed.
 *
 * `/auth/logout` is the only thing that can clear the HttpOnly refresh cookie
 * and invalidate the refresh-token family. When that request fails -- network
 * drop, reverse-proxy error, a concurrent rotation -- clearing the Zustand store
 * ends the session on this tab and nothing more: the credential is still live,
 * and another tab or a later refresh can pick it back up.
 *
 * So the client clears what it owns and records that the server half did not
 * happen. The login screen reads this flag and says so, with a retry, instead of
 * showing the ordinary signed-out state. Session storage, not local: the warning
 * belongs to this browsing session, and a closed tab has taken the risk with it
 * as far as this client can tell.
 *
 * This module owns both representations of that state -- the sessionStorage flag
 * and the toast that announces it -- so resolving it (a fresh sign-in, a
 * successful retry) clears them together and notifies any mounted notice.
 */
const KEY = 'monize:logout-incomplete';

/**
 * Shared react-hot-toast id for the failed-sign-out toast. AppHeader and the
 * retry both raise the failure under this id so repeated attempts dedup instead
 * of stacking, and `clearLogoutIncomplete` dismisses exactly this toast when the
 * state is resolved. It is only ever a failure toast, so the name stays honest.
 */
export const LOGOUT_FAILED_TOAST_ID = 'logout-failed';

// The flag lives outside React, so a mounted notice subscribes through
// useSyncExternalStore to hear when it is set or cleared (e.g. a sign-in in
// another flow clears it while the notice is still on screen).
const listeners = new Set<() => void>();

function emitChange(): void {
  for (const listener of listeners) listener();
}

export function subscribeLogoutIncomplete(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export function markLogoutIncomplete(): void {
  try {
    window.sessionStorage.setItem(KEY, '1');
  } catch {
    // Session storage unavailable (private mode, quota). The toast raised at the
    // same moment is the fallback; there is nothing else to do here.
  }
  emitChange();
}

export function isLogoutIncomplete(): boolean {
  try {
    return window.sessionStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function clearLogoutIncomplete(): void {
  // Dismiss unconditionally: the failure toast can outlive the flag when
  // sessionStorage is unavailable (private mode raised the toast but could not
  // persist the flag), and dismissing an id that is not on screen is a harmless
  // no-op. Otherwise the 12s failure toast lingers over a now-authenticated app.
  toast.dismiss(LOGOUT_FAILED_TOAST_ID);
  // The storage removal and the subscriber notification are genuine no-ops when
  // nothing was ever flagged -- and this runs on every login -- so guard those.
  if (!isLogoutIncomplete()) return;
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
  emitChange();
}
