/**
 * Per-security control over whether the quote provider is asked for prices, and
 * the pure state machine that auto-disables a security after a run of provider
 * "no such symbol" answers (and re-enables it if the data comes back).
 *
 * Kept free of NestJS and the database so every transition is unit-testable
 * against plain objects -- `SecurityPriceService` is the only caller that turns
 * an outcome into a row write.
 */

export const PRICE_FETCH_STATUSES = [
  "active",
  "auto_disabled",
  "disabled",
] as const;

export type PriceFetchStatus = (typeof PRICE_FETCH_STATUSES)[number];

/**
 * The user may only set 'active' or 'disabled' by hand -- 'auto_disabled' is a
 * conclusion the system reaches, never an instruction the client sends.
 */
export const USER_SETTABLE_PRICE_FETCH_STATUSES: readonly PriceFetchStatus[] = [
  "active",
  "disabled",
];

/**
 * Consecutive provider "no such symbol" (HTTP 404/422) answers before an
 * `active` security is auto-disabled. Count-based rather than time-based: one
 * quote refresh runs per day, so this is roughly "a week and a half of the
 * symbol being genuinely absent". Only definitive absent answers are counted --
 * a throttle, a timeout or an outage never is -- so a provider being down
 * cannot walk the whole catalogue up to this threshold.
 */
export const PRICE_FETCH_ABSENT_THRESHOLD = 10;

/**
 * How long an `auto_disabled` security waits between re-probes. It is asked for
 * a price once the cooldown since its last 404 has elapsed; a success returns it
 * to `active`, another 404 resets the clock for another cooldown. Weekly keeps
 * the re-probe traffic negligible while still recovering a security whose data
 * returns.
 */
export const AUTO_DISABLE_REPROBE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

/** The outcome of one attempt to price a security, from the fetch's point of view. */
export type PriceFetchAttemptOutcome = "success" | "absent";

/** The subset of a Security row the state machine reads. */
export interface PriceFetchStateInput {
  priceFetchStatus: PriceFetchStatus;
  priceFetchFailureCount: number;
  priceFetchLastFailureAt: Date | null;
  priceFetchAutoDisabledAt: Date | null;
}

/** The subset that decides whether a provider is configured at all. */
export interface ProviderConfigInput {
  skipPriceUpdates: boolean;
  quoteProvider: string | null;
  msnInstrumentId: string | null;
}

/**
 * A security is provider-configured when skipPriceUpdates is false, OR the user
 * opted in with a per-security provider override or an MSN instrument id.
 * QIF/OFX imports set skipPriceUpdates on auto-generated symbols, and picking a
 * provider is the explicit opt-in that overrides it (mirrors the auto-clear in
 * `SecuritiesService.update`).
 */
export function isProviderConfigured(s: ProviderConfigInput): boolean {
  if (!s.skipPriceUpdates) return true;
  return Boolean(s.quoteProvider) || Boolean(s.msnInstrumentId);
}

/**
 * "Active" for fetch purposes: anything that is neither user-disabled nor
 * system-auto-disabled. Written as an exclusion so a row whose status is unset
 * (a freshly constructed entity before its column default is applied) is treated
 * as active rather than silently skipped.
 */
export function isActiveStatus(
  status: PriceFetchStatus | null | undefined,
): boolean {
  return status !== "auto_disabled" && status !== "disabled";
}

/** `active` and provider-configured: fetched on every normal refresh. */
export function canFetchActive(
  s: PriceFetchStateInput & ProviderConfigInput,
): boolean {
  return isActiveStatus(s.priceFetchStatus) && isProviderConfigured(s);
}

/**
 * `auto_disabled`, provider-configured, and the re-probe cooldown since its last
 * 404 has elapsed. A never-stamped `auto_disabled` row (defensive) is due at
 * once. `disabled` is never due -- the user turned it off.
 */
export function isReprobeDue(
  s: PriceFetchStateInput & ProviderConfigInput,
  now: Date,
): boolean {
  if (s.priceFetchStatus !== "auto_disabled") return false;
  if (!isProviderConfigured(s)) return false;
  const last = s.priceFetchLastFailureAt;
  if (!last) return true;
  return now.getTime() - last.getTime() >= AUTO_DISABLE_REPROBE_INTERVAL_MS;
}

/**
 * Whether a quote refresh should ask the provider for this security now: an
 * active one always, an auto-disabled one only when it is due for a re-probe. A
 * `disabled` security is never fetched.
 */
export function shouldAttemptFetch(
  s: PriceFetchStateInput & ProviderConfigInput,
  now: Date,
): boolean {
  return canFetchActive(s) || isReprobeDue(s, now);
}

/** The mutable fields a fetch outcome writes back onto the Security row. */
export type PriceFetchStateUpdate = Partial<
  Pick<
    PriceFetchStateInput,
    | "priceFetchStatus"
    | "priceFetchFailureCount"
    | "priceFetchLastFailureAt"
    | "priceFetchAutoDisabledAt"
  >
>;

/**
 * Fold one attempt outcome into the fetch state, returning only the fields that
 * changed (or null when nothing did, so the caller can skip the write).
 *
 * - success: reset the streak and clear any auto-disable; an auto-disabled
 *   security whose re-probe succeeds returns to `active`. A no-op for an already
 *   clean `active` row.
 * - absent (a provider "no such symbol" answer): bump the streak and stamp the
 *   failure instant. An `active` security that reaches the threshold flips to
 *   `auto_disabled`; an already-auto-disabled one just resets its re-probe
 *   clock. A `disabled` security is never fetched, so it never reaches here.
 */
export function computeFetchOutcomeUpdate(
  s: PriceFetchStateInput,
  outcome: PriceFetchAttemptOutcome,
  now: Date,
): PriceFetchStateUpdate | null {
  if (s.priceFetchStatus === "disabled") return null;

  if (outcome === "success") {
    const alreadyClean =
      isActiveStatus(s.priceFetchStatus) &&
      s.priceFetchFailureCount === 0 &&
      s.priceFetchLastFailureAt === null &&
      s.priceFetchAutoDisabledAt === null;
    if (alreadyClean) return null;
    return {
      priceFetchStatus: "active",
      priceFetchFailureCount: 0,
      priceFetchLastFailureAt: null,
      priceFetchAutoDisabledAt: null,
    };
  }

  // outcome === "absent"
  const nextCount = s.priceFetchFailureCount + 1;
  const base: PriceFetchStateUpdate = {
    priceFetchFailureCount: nextCount,
    priceFetchLastFailureAt: now,
  };
  if (
    isActiveStatus(s.priceFetchStatus) &&
    nextCount >= PRICE_FETCH_ABSENT_THRESHOLD
  ) {
    return {
      ...base,
      priceFetchStatus: "auto_disabled",
      priceFetchAutoDisabledAt: now,
    };
  }
  return base;
}
