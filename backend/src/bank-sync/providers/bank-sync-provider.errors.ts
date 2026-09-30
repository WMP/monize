/**
 * Why a bank-sync provider call failed, in the terms a caller acts on.
 *
 * - `unauthorized`: the provider refused the application's own credentials (a
 *   bad JWT, a wrong application id or key). The user's connection is fine; the
 *   credentials are what to fix.
 * - `session_expired`: the provider says the bank consent (the session) is gone
 *   or no longer allows this read. The connection is to be marked `expired` and
 *   the user re-authorizes.
 * - `rate_limited`: the provider or the bank throttled the call; try later.
 * - `bad_request`: the provider rejected this request as malformed or not
 *   allowed; repeating it unchanged will fail the same way.
 * - `unavailable`: the provider did not answer (transport failure, 5xx, the
 *   circuit breaker refusing the call). Never "no new transactions".
 * - `invalid_response`: the provider answered with a shape this build does not
 *   understand.
 */
export type BankSyncProviderErrorKind =
  | "unauthorized"
  | "session_expired"
  | "rate_limited"
  | "bad_request"
  | "unavailable"
  | "invalid_response";

/** Longest message carried; it is stored on a row and rendered in the UI. */
export const MAX_BANK_SYNC_PROVIDER_MESSAGE_LENGTH = 300;

/**
 * A failed provider call. The message is safe to store and to show: it is
 * bounded and built from the HTTP status and a bounded provider error code and
 * description, never from a credential, a token, a request header or a response
 * body beyond those two fields.
 */
export class BankSyncProviderError extends Error {
  constructor(
    readonly kind: BankSyncProviderErrorKind,
    message: string,
    /** The HTTP status, when the provider answered at all. */
    readonly status: number | null = null,
    /** The provider's own error code, bounded, when it sent one. */
    readonly providerCode: string | null = null,
  ) {
    super(message.slice(0, MAX_BANK_SYNC_PROVIDER_MESSAGE_LENGTH));
    this.name = "BankSyncProviderError";
  }
}

/** Narrowing helper, so a call site does not import the class to test it. */
export function isBankSyncProviderError(
  error: unknown,
): error is BankSyncProviderError {
  return error instanceof BankSyncProviderError;
}
