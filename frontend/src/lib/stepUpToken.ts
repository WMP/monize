import { authApi } from '@/lib/auth';
import { create } from 'zustand';

/**
 * In-memory step-up token store.
 *
 * Tokens are bearer credentials -- they MUST NOT be persisted to localStorage
 * or sessionStorage. They live for ~5 minutes, die with the tab, and an XSS
 * payload reading window storage finds nothing.
 *
 * Keyed by purpose ("emergency-access", ...) so the same primitive can guard
 * other sensitive surfaces in the future without leaking a token between them.
 */
interface StepUpEntry {
  token: string;
  expiresAt: number; // epoch ms
}

interface StepUpState {
  entries: Record<string, StepUpEntry>;
  set: (purpose: string, token: string, expiresAt: string) => void;
  clear: (purpose: string) => void;
  clearAll: () => void;
  getValid: (purpose: string) => string | null;
  getExpiresAt: (purpose: string) => number | null;
}

const expiryTimers: Record<string, ReturnType<typeof setTimeout>> = {};

export const useStepUpTokenStore = create<StepUpState>((set, get) => ({
  entries: {},

  set: (purpose, token, expiresAt) => {
    const expiresAtMs = new Date(expiresAt).getTime();
    if (Number.isNaN(expiresAtMs)) return;

    // Replace any pending expiry for this purpose.
    if (expiryTimers[purpose]) {
      clearTimeout(expiryTimers[purpose]);
    }
    const delay = Math.max(0, expiresAtMs - Date.now());
    expiryTimers[purpose] = setTimeout(() => {
      get().clear(purpose);
    }, delay);

    set((state) => ({
      entries: { ...state.entries, [purpose]: { token, expiresAt: expiresAtMs } },
    }));
  },

  clear: (purpose) => {
    if (expiryTimers[purpose]) {
      clearTimeout(expiryTimers[purpose]);
      delete expiryTimers[purpose];
    }
    set((state) => {
      if (!state.entries[purpose]) return state;
      const { [purpose]: _removed, ...rest } = state.entries;
      return { entries: rest };
    });
  },

  clearAll: () => {
    for (const purpose of Object.keys(expiryTimers)) {
      clearTimeout(expiryTimers[purpose]);
      delete expiryTimers[purpose];
    }
    set({ entries: {} });
  },

  getValid: (purpose) => {
    const entry = get().entries[purpose];
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      get().clear(purpose);
      return null;
    }
    return entry.token;
  },

  getExpiresAt: (purpose) => {
    const entry = get().entries[purpose];
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      get().clear(purpose);
      return null;
    }
    return entry.expiresAt;
  },
}));

/**
 * Error thrown when an API call is rejected because step-up auth is
 * required or has expired. Callers (the page that owns the modal) catch
 * this and re-prompt the user.
 */
export class StepUpRequiredError extends Error {
  readonly purpose: string;
  readonly reason: 'required' | 'expired' | 'invalid';

  constructor(purpose: string, reason: 'required' | 'expired' | 'invalid') {
    super(`Step-up auth ${reason} for ${purpose}`);
    this.purpose = purpose;
    this.reason = reason;
    this.name = 'StepUpRequiredError';
  }
}

/**
 * OIDC users can't enroll Monize-managed 2FA and have no local password, so
 * step-up sends the user through `GET /auth/oidc/reauth?purpose=...`, which asks
 * the identity provider to challenge them (`prompt=login`). The OIDC callback
 * hands back a signed, purpose-bound, one-time artifact in the URL fragment,
 * which is what the server verifies -- this used to be a client-asserted
 * `oidcConfirmed=true` that the server took at face value (P2-005).
 *
 * We persist a sentinel in sessionStorage across the redirect so the
 * destination page can:
 *   - Recognize that we just returned from OIDC for step-up
 *   - Resume the action the user wanted (e.g. open the message editor)
 *
 * Stored as JSON in `stepUpOidcPending`. The Next.js auth callback respects
 * `postLoginReturnTo` to bring the user back to the right page.
 */
const PENDING_KEY = 'stepUpOidcPending';

export interface OidcStepUpPending {
  purpose: string;
  /** Optional opaque payload (mode, item id, ...) the caller wants back. */
  payload?: Record<string, unknown>;
}

export function stashOidcStepUpPending(args: {
  purpose: string;
  returnTo?: string;
  payload?: Record<string, unknown>;
}): void {
  try {
    sessionStorage.setItem(
      PENDING_KEY,
      JSON.stringify({ purpose: args.purpose, payload: args.payload }),
    );
    if (args.returnTo) {
      sessionStorage.setItem('postLoginReturnTo', args.returnTo);
    }
  } catch {
    // sessionStorage unavailable -- the caller will simply not be resumed.
  }
}

export function consumeOidcStepUpPending(
  purpose: string,
): OidcStepUpPending | null {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(PENDING_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  let parsed: OidcStepUpPending | null = null;
  try {
    parsed = JSON.parse(raw) as OidcStepUpPending;
  } catch {
    sessionStorage.removeItem(PENDING_KEY);
    return null;
  }
  if (!parsed || parsed.purpose !== purpose) return null;
  sessionStorage.removeItem(PENDING_KEY);
  return parsed;
}

/**
 * The re-authentication artifact minted by the OIDC callback, held across the
 * final hop from the callback page to the page that resumes the action.
 *
 * sessionStorage rather than a store: the callback page and the resuming page are
 * separate document loads. It is removed the moment it is read, and the server
 * refuses to spend the same artifact twice, so a copy left behind by a crashed
 * tab is worth nothing.
 */
const REAUTH_ARTIFACT_KEY = 'oidcReauthArtifact';

export function stashOidcReauthArtifact(token: string): void {
  try {
    sessionStorage.setItem(REAUTH_ARTIFACT_KEY, token);
  } catch {
    // sessionStorage unavailable -- the action will re-prompt, which is correct.
  }
}

export function consumeOidcReauthArtifact(): string | null {
  try {
    const token = sessionStorage.getItem(REAUTH_ARTIFACT_KEY);
    sessionStorage.removeItem(REAUTH_ARTIFACT_KEY);
    return token;
  } catch {
    return null;
  }
}

/**
 * Obtain a re-authentication artifact for `purpose`, or start the round trip that
 * produces one.
 *
 * Returns the artifact when the user has just come back from the identity
 * provider. Otherwise it navigates away and returns null -- the caller must stop.
 *
 * The redirect loses whatever the user had selected (a file to restore, a set of
 * checkboxes). That is the honest cost of a second factor that actually
 * challenges the user: the alternative was accepting a string the client made up.
 * Callers say so before redirecting, and the artifact survives on the far side, so
 * repeating the selection is all that is asked.
 */
export function takeOidcReauthArtifact(
  purpose: string,
  returnTo: string,
): string | null {
  const existing = consumeOidcReauthArtifact();
  if (existing) return existing;
  try {
    sessionStorage.setItem('postLoginReturnTo', returnTo);
  } catch {
    // Without it the user lands on the dashboard and has to navigate back.
  }
  authApi.beginOidcReauth(purpose);
  return null;
}

/**
 * Inspect an axios error and, if it carries a STEP_UP_* code from the
 * backend, throw a typed `StepUpRequiredError`. Otherwise rethrow as-is.
 *
 * Used to wrap calls to step-up gated endpoints so the page-level catch
 * block stays narrow.
 */
export function rethrowStepUpError(error: unknown): never {
  if (
    error &&
    typeof error === 'object' &&
    'response' in error &&
    error.response &&
    typeof error.response === 'object'
  ) {
    const data = (error.response as { data?: unknown }).data as
      | { code?: string; purpose?: string }
      | undefined;
    if (data?.code === 'STEP_UP_REQUIRED') {
      throw new StepUpRequiredError(data.purpose ?? '', 'required');
    }
    if (data?.code === 'STEP_UP_EXPIRED') {
      throw new StepUpRequiredError(data.purpose ?? '', 'expired');
    }
    if (data?.code === 'STEP_UP_INVALID') {
      throw new StepUpRequiredError(data.purpose ?? '', 'invalid');
    }
  }
  throw error;
}
