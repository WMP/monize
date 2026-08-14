import { describe, it, expect, vi, beforeEach } from 'vitest';
import toast from 'react-hot-toast';
import {
  markLogoutIncomplete,
  isLogoutIncomplete,
  clearLogoutIncomplete,
  subscribeLogoutIncomplete,
  LOGOUT_FAILED_TOAST_ID,
} from './logout-state';

describe('logout-state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
  });

  it('records and reads the incomplete-logout flag', () => {
    expect(isLogoutIncomplete()).toBe(false);
    markLogoutIncomplete();
    expect(isLogoutIncomplete()).toBe(true);
    clearLogoutIncomplete();
    expect(isLogoutIncomplete()).toBe(false);
  });

  // Resolving the state must take down the toast too, or the 12s failure toast
  // lingers over a now-authenticated app after a fresh sign-in.
  it('dismisses the shared failure toast when the flag is cleared', () => {
    markLogoutIncomplete();
    clearLogoutIncomplete();
    expect(toast.dismiss).toHaveBeenCalledWith(LOGOUT_FAILED_TOAST_ID);
  });

  // clearLogoutIncomplete runs on every sign-in. The toast dismiss is
  // unconditional (a private-mode toast can outlive the flag), but the
  // subscriber notification is guarded, so an ordinary sign-in wakes no one.
  it('dismisses the toast but does not notify when the flag was never set', () => {
    const listener = vi.fn();
    subscribeLogoutIncomplete(listener);

    clearLogoutIncomplete();

    expect(toast.dismiss).toHaveBeenCalledWith(LOGOUT_FAILED_TOAST_ID);
    expect(listener).not.toHaveBeenCalled();
  });

  it('notifies subscribers when the flag is set or cleared', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeLogoutIncomplete(listener);

    markLogoutIncomplete();
    clearLogoutIncomplete();
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    markLogoutIncomplete();
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
