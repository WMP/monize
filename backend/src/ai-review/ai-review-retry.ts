import type { Logger } from "@nestjs/common";
import { resolvePositiveInt } from "../common/env-number.util";

/**
 * Retry of the automatic AI step (docs/future-plans/ai-review-retry.md,
 * decision 1). The numbers live here once: the step's SQL receives the schedule
 * as a parameter, the service stores `needs_agent` from the maximum, and the
 * tests read both from this file.
 */

/**
 * The note the automatic step stores when the provider gave no answer. The
 * one-time data migration and `reopenProviderTimeouts` select on it, so it is
 * written here and nowhere else.
 */
export const AI_PROVIDER_UNAVAILABLE_NOTE = "The AI provider did not answer.";

/**
 * How long the automatic step waits after failed attempt n (n = 1, 2, 3, 4)
 * before it takes the request again: 5 min, 30 min, 2 h, 12 h. An attempt
 * beyond the table (the operator raised the maximum) waits as long as the last.
 */
export const AI_REVIEW_RETRY_BACKOFF_MINUTES = [5, 30, 120, 720] as const;

/** Minutes to wait after `attempts` failed attempts; 0 before the first. */
export function retryBackoffMinutes(attempts: number): number {
  if (!Number.isInteger(attempts) || attempts <= 0) return 0;
  const table = AI_REVIEW_RETRY_BACKOFF_MINUTES;
  return table[Math.min(attempts, table.length) - 1];
}

/** Operator-owned maximum of automatic attempts per request, documented in `.env.example`. */
export const AI_REVIEW_AUTO_MAX_ATTEMPTS_SPEC = {
  envVar: "AI_REVIEW_AUTO_MAX_ATTEMPTS",
  default: 5,
  max: 20,
} as const;

export function resolveAiReviewAutoMaxAttempts(
  env: Record<string, unknown>,
  logger: Pick<Logger, "warn">,
): number {
  const spec = AI_REVIEW_AUTO_MAX_ATTEMPTS_SPEC;
  const resolved = resolvePositiveInt(env[spec.envVar], spec.default);
  if (resolved.invalid || resolved.value > spec.max) {
    logger.warn(
      `${spec.envVar} must be an integer from 1 to ${spec.max}; using ${spec.default}`,
    );
    return spec.default;
  }
  return resolved.value;
}

/** What `reopen` says about one request. */
export const AI_REVIEW_REOPEN_OUTCOMES = [
  "reopened",
  "not_found",
  "not_closed",
  "kind_not_reopenable",
  "open_exists",
  "superseded",
] as const;
export type AiReviewReopenOutcome = (typeof AI_REVIEW_REOPEN_OUTCOMES)[number];

export interface AiReviewReopenResult {
  readonly id: string;
  readonly outcome: AiReviewReopenOutcome;
}

export interface AiReviewReopenSummary {
  readonly results: readonly AiReviewReopenResult[];
  readonly reopened: number;
}

/** The most requests one re-open call takes (REST batch, MCP preset). */
export const AI_REVIEW_REOPEN_MAX = 500;

/** Kinds a closed request of which can be sent again. */
export const AI_REVIEW_REOPENABLE_KINDS = [
  "transaction_review",
  "email_receipt",
] as const;
