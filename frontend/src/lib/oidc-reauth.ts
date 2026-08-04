import { authApi } from './auth';

/**
 * Sending a destructive OIDC user through the identity provider, and picking the
 * flow back up when they return.
 *
 * The three destructive flows used to send the literal string
 * `oidc-session-confirmed` and the server accepted any non-empty value, so the
 * UI's promise of reauthentication was decorative: a live session -- exactly what
 * an attacker at an unattended browser has -- was the whole check. The server now
 * requires the HttpOnly proof that the `/auth/oidc/step-up` callback issues --
 * purpose-bound, single-use, and only when the provider reports a fresh
 * authentication -- which means the client's job is no longer to assert anything.
 * It is to actually make the round trip happen and then resume.
 *
 * `intent` is what to resume, not a credential: it says which panel to reopen,
 * never that anything was authorised. Authorisation lives in the cookie the
 * client cannot read, and the server checks it on the request that matters.
 */
const INTENT_KEY = 'monize:oidc-reauth-intent';

export type OidcReauthIntent = 'backup-restore' | 'delete-account' | 'delete-data';

interface StoredIntent {
  intent: OidcReauthIntent;
  /** Opaque per-flow state that must survive the redirect (e.g. which datasets). */
  payload?: Record<string, unknown>;
}

/**
 * Stash the intent, ask to be returned to `returnTo`, and hand over to the
 * provider. Does not resolve: the browser navigates away.
 */
export function beginOidcReauth(
  intent: OidcReauthIntent,
  returnTo: string,
  payload?: Record<string, unknown>,
): void {
  try {
    sessionStorage.setItem(
      INTENT_KEY,
      JSON.stringify({ intent, payload } satisfies StoredIntent),
    );
    sessionStorage.setItem('postLoginReturnTo', returnTo);
  } catch {
    // Without session storage the redirect still re-authenticates; the user
    // simply has to reopen the panel by hand.
  }
  // The step-up route, not the login route: the purpose travels to the server so
  // the proof it issues unlocks this action and nothing else, and the provider is
  // asked for a genuinely fresh authentication rather than its SSO session.
  authApi.initiateOidcStepUp(intent);
}

/**
 * Read and clear the pending intent, if it is the one asked for. Clearing on
 * read is deliberate: a reopened panel must not resume a second time from a
 * stale marker.
 */
export function takeOidcReauthIntent(
  intent: OidcReauthIntent,
): StoredIntent | null {
  try {
    const raw = sessionStorage.getItem(INTENT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredIntent;
    if (parsed?.intent !== intent) return null;
    sessionStorage.removeItem(INTENT_KEY);
    return parsed;
  } catch {
    return null;
  }
}

/** Drop any pending intent, e.g. when the user cancels the flow. */
export function clearOidcReauthIntent(): void {
  try {
    sessionStorage.removeItem(INTENT_KEY);
  } catch {
    // Nothing to clear.
  }
}
