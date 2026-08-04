import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  beginOidcReauth,
  takeOidcReauthIntent,
  clearOidcReauthIntent,
} from './oidc-reauth';
import { authApi } from './auth';

vi.mock('./auth', () => ({
  authApi: {
    initiateOidc: vi.fn(),
    initiateOidcStepUp: vi.fn(),
  },
}));

const stepUp = authApi.initiateOidcStepUp as ReturnType<typeof vi.fn>;
const login = authApi.initiateOidc as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
});

describe('beginOidcReauth', () => {
  // A destructive confirmation used to start the ORDINARY login redirect, which
  // asked the provider for nothing and produced a generic proof — so an IdP with a
  // live SSO session authorised a full-account restore with one click, and simply
  // signing in armed the same thing.
  it('starts a purpose-bound step-up rather than an ordinary login', () => {
    beginOidcReauth('backup-restore', '/settings');

    expect(stepUp).toHaveBeenCalledWith('backup-restore');
    expect(login).not.toHaveBeenCalled();
  });

  it.each([
    ['backup-restore'] as const,
    ['delete-account'] as const,
    ['delete-data'] as const,
  ])('passes %s through as the step-up purpose', (intent) => {
    beginOidcReauth(intent, '/settings');
    expect(stepUp).toHaveBeenCalledWith(intent);
  });

  it('stashes the intent and the page to return to', () => {
    beginOidcReauth('delete-data', '/settings?tab=danger', { scope: 'all' });

    expect(sessionStorage.getItem('postLoginReturnTo')).toBe(
      '/settings?tab=danger',
    );
    expect(takeOidcReauthIntent('delete-data')).toEqual({
      intent: 'delete-data',
      payload: { scope: 'all' },
    });
  });

  it('redirects even when session storage is unavailable', () => {
    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('denied');
      });

    beginOidcReauth('delete-account', '/settings');

    expect(stepUp).toHaveBeenCalledWith('delete-account');
    setItem.mockRestore();
  });
});

describe('takeOidcReauthIntent', () => {
  // The intent says which panel to reopen. It is never evidence that anything was
  // authorised — that lives in the HttpOnly cookie the client cannot read — so a
  // stale marker must not resume a second time.
  it('clears the intent on read', () => {
    beginOidcReauth('backup-restore', '/settings');

    expect(takeOidcReauthIntent('backup-restore')).not.toBeNull();
    expect(takeOidcReauthIntent('backup-restore')).toBeNull();
  });

  it('does not answer for a different intent', () => {
    beginOidcReauth('backup-restore', '/settings');

    expect(takeOidcReauthIntent('delete-account')).toBeNull();
    // ...and leaves the real one in place.
    expect(takeOidcReauthIntent('backup-restore')).not.toBeNull();
  });

  it('returns null when nothing is pending', () => {
    expect(takeOidcReauthIntent('backup-restore')).toBeNull();
  });

  it('survives a corrupt stored value', () => {
    sessionStorage.setItem('monize:oidc-reauth-intent', 'not json');
    expect(takeOidcReauthIntent('backup-restore')).toBeNull();
  });
});

describe('clearOidcReauthIntent', () => {
  it('drops a pending intent when the user cancels', () => {
    beginOidcReauth('delete-data', '/settings');
    clearOidcReauthIntent();
    expect(takeOidcReauthIntent('delete-data')).toBeNull();
  });
});
