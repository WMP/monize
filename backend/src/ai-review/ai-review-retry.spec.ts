import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AI_REVIEW_CLOSE_REASONS } from "./ai-review-request.entity";
import {
  AI_PROVIDER_UNAVAILABLE_NOTE,
  AI_REVIEW_AUTO_MAX_ATTEMPTS_SPEC,
  AI_REVIEW_RETRY_BACKOFF_MINUTES,
  resolveAiReviewAutoMaxAttempts,
  retryBackoffMinutes,
} from "./ai-review-retry";

const REPO = join(__dirname, "..", "..", "..");
const logger = () => ({ warn: jest.fn() });

describe("the retry schedule", () => {
  it("is 5 min, 30 min, 2 h, 12 h after attempt 1, 2, 3, 4", () => {
    expect([...AI_REVIEW_RETRY_BACKOFF_MINUTES]).toEqual([5, 30, 120, 720]);
    expect([1, 2, 3, 4].map(retryBackoffMinutes)).toEqual([5, 30, 120, 720]);
  });

  it("waits nothing before the first attempt, and as long as the last entry beyond the table", () => {
    expect(retryBackoffMinutes(0)).toBe(0);
    expect(retryBackoffMinutes(-1)).toBe(0);
    expect(retryBackoffMinutes(1.5)).toBe(0);
    expect(retryBackoffMinutes(5)).toBe(720);
    expect(retryBackoffMinutes(19)).toBe(720);
  });
});

describe("AI_REVIEW_AUTO_MAX_ATTEMPTS", () => {
  const name = AI_REVIEW_AUTO_MAX_ATTEMPTS_SPEC.envVar;

  it("defaults to 5 when unset, without a warning", () => {
    const log = logger();
    expect(resolveAiReviewAutoMaxAttempts({}, log)).toBe(5);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it.each(["1", "5", "20", 7])("honors %s", (raw) => {
    expect(resolveAiReviewAutoMaxAttempts({ [name]: raw }, logger())).toBe(
      Number(raw),
    );
  });

  it.each(["0", "-1", "21", "1.5", "many", true])(
    "falls back to 5 and warns for %s",
    (raw) => {
      const log = logger();
      expect(resolveAiReviewAutoMaxAttempts({ [name]: raw }, log)).toBe(5);
      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining(name));
    },
  );

  it("is documented in .env.example with its default", () => {
    const text = readFileSync(join(REPO, ".env.example"), "utf8");
    expect(text).toMatch(new RegExp(`^# ${name}=5$`, "m"));
  });
});

describe("the provider-timeout note", () => {
  it("is the text the data migration selects on", () => {
    const migration = readFileSync(
      join(
        REPO,
        "database/migrations/20261018200000_ai_review_request_retry.sql",
      ),
      "utf8",
    );
    expect(migration).toContain(`'${AI_PROVIDER_UNAVAILABLE_NOTE}'`);
  });
});

describe("close reasons", () => {
  const listed = (sql: string): string[] => {
    const match =
      /ck_ai_review_requests_close_reason\s+CHECK \(close_reason IS NULL OR close_reason IN \(([^)]*)\)\)/.exec(
        sql,
      );
    expect(match).not.toBeNull();
    return [...(match as RegExpExecArray)[1].matchAll(/'([a-z_]+)'/g)].map(
      (m) => m[1],
    );
  };

  it.each([
    ["database/schema.sql"],
    ["database/migrations/20261018200000_ai_review_request_retry.sql"],
  ])("%s lists exactly the reasons the code knows", (file) => {
    const sql = readFileSync(join(REPO, file), "utf8");
    expect([...listed(sql)].sort()).toEqual(
      [...AI_REVIEW_CLOSE_REASONS].sort(),
    );
  });

  it("is written by every closer in the source as a listed reason", () => {
    // A literal `close_reason = '...'` anywhere in src must be a known reason.
    const sources = [
      "ai-review/ai-review-requests.service.ts",
      "email-receipts/mailbox/email-receipt-mailbox.service.ts",
    ].map((f) => readFileSync(join(__dirname, "..", f), "utf8"));
    const written = sources.flatMap((s) =>
      [...s.matchAll(/close_reason = '([a-z_]+)'/g)].map((m) => m[1]),
    );
    expect(written.length).toBeGreaterThan(0);
    for (const reason of written) {
      expect(AI_REVIEW_CLOSE_REASONS).toContain(reason);
    }
  });
});
