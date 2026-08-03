import { readFileSync } from "node:fs";
import { join } from "node:path";
import { globSync } from "glob";

/**
 * Source-scanning guards for the two mistakes the Phase 4 concurrency audit found
 * over and over, in different files, each time looking locally reasonable.
 *
 * A rule in prose gets read, agreed with, and violated anyway -- so these are
 * tests. They scan the source rather than exercising behaviour, because both
 * mistakes are mechanical: not "this calculation is wrong" but "this shape is the
 * wrong shape", and the next instance will be in a file nobody thought to check.
 *
 * Both lists below are allowlists of *reviewed* exceptions. An entry needs a
 * reason, and the list may only shrink.
 */
const SRC = join(__dirname, "..", "..");

function sourceFiles(): string[] {
  return globSync("**/*.ts", {
    cwd: SRC,
    absolute: true,
    ignore: ["**/*.spec.ts", "**/*.d.ts", "**/node_modules/**"],
  });
}

function read(file: string): string {
  return readFileSync(file, "utf8");
}

function relative(file: string): string {
  return file.slice(SRC.length + 1).replace(/\\/g, "/");
}

describe("derived financial state has one set of writers", () => {
  /**
   * `accounts.current_balance` is written by exactly two protocols -- an atomic
   * delta and an absolute recomputation -- and they only compose because every
   * writer takes the account lock before reading the inputs it writes back.
   *
   * A new site that assembles its own `UPDATE accounts SET current_balance`
   * bypasses that agreement, which is how a recomputation silently overwrote a
   * committed delta (audit P4-005). Route it through `AccountsService`.
   */
  it("writes current_balance only from the sanctioned services", () => {
    const ALLOWED = new Set([
      // The two protocols themselves, and the lock that makes them compose.
      "accounts/accounts.service.ts",
      // Post-import recomputation: bulk, and locked through the shared helper.
      "import/import-post-processing.service.ts",
      // Demo-mode seeding writes balances alongside the rows it invents.
      "database/demo-seed.service.ts",
      "database/seed.service.ts",
      // A restore replaces whole rows, balances included, under preserved
      // timestamps -- it is restoring a snapshot, not maintaining a balance.
      "backup/backup.service.ts",
      // The `.mny` importer writes balances inside its one import transaction.
      "import/mny/writers/write-transactions.ts",
      // Undo/redo recomputes the accounts its replay touched, under the shared
      // account lock.
      "action-history/action-history.service.ts",
      // Delete-my-data resets every account to its opening balance; there is no
      // ledger left to recompute from.
      "users/users.service.ts",
      // Demo mode's daily reset owns the whole dataset it invents.
      "database/demo-reset.service.ts",
      // The protocol note itself quotes the statement it is describing.
      "common/db/locks.ts",
    ]);

    const offenders = sourceFiles()
      .filter((file) => /current_balance\s*=/.test(read(file)))
      .map(relative)
      .filter((file) => !ALLOWED.has(file));

    expect(offenders).toEqual([]);
  });

  /**
   * A balance delta must be derived from the ledger version the write replaces.
   *
   * The shape that breaks it is a read *before* the transaction whose values are
   * then used to adjust a balance *inside* it -- two concurrent requests each
   * held that snapshot and the second reversed an amount the first had already
   * replaced (audit P4-003). The locked readers in `common/db/locks.ts` are how a
   * service reads those values instead.
   */
  it("derives balance deltas from locked reads, not entity snapshots", () => {
    const ALLOWED = new Set([
      // The helper that performs the locked read.
      "common/db/locks.ts",
    ]);

    const offenders = sourceFiles()
      .filter((file) => {
        const source = read(file);
        // A service that adjusts balances at all must have a locked reader, or a
        // documented reason not to.
        const adjustsBalances = /accountsService\.updateBalance\(/.test(source);
        if (!adjustsBalances) return false;
        return !/lockTransactionRow|lockTransactionRows|lockAccountsForBalanceWrite/.test(
          source,
        );
      })
      .map(relative)
      .filter((file) => !ALLOWED.has(file));

    // Every remaining balance-adjusting service reads its old values under a
    // lock. A new one that does not is the P4-003 shape again.
    expect(offenders).toEqual([]);
  });

  /**
   * Every backend replica fires every cron (`docs/cron-jobs.md`), so a guard held
   * in process memory is not a guard: each replica has its own.
   *
   * A `Set` or `Map` of user ids beside an `@Cron` handler is the shape that
   * produced duplicate AI provider calls and duplicate emails (P4-013, P4-018).
   * Use `JobClaimService`.
   */
  it("does not guard cron work with process-local state", () => {
    const ALLOWED = new Map([
      [
        "ai/insights/ai-insights.service.ts",
        "generatingUsers is a cheap local short-circuit ONLY; the exclusion is a durable lease",
      ],
      [
        "net-worth/net-worth.service.ts",
        "recalcTimers is a debounce registry, not a guard: it coordinates nothing " +
          "and duplicate work is harmless (the recalc is an absolute recomputation " +
          "under the account lock). Losing a timer is made recoverable by " +
          "sweepStaleSnapshots, which derives the staleness from accounts.updated_at " +
          "rather than from anything held in memory",
      ],
    ]);

    const offenders = sourceFiles()
      .filter((file) => {
        const source = read(file);
        if (!/@Cron\(/.test(source)) return false;
        // A field holding a Set/Map of ids at class scope, beside a cron.
        return /^\s*private\s+(?:readonly\s+)?\w+\s*[:=]\s*(?:new\s+)?(?:Set|Map)\b/m.test(
          source,
        );
      })
      .map(relative)
      .filter((file) => !ALLOWED.has(file));

    expect(offenders).toEqual([]);
  });
});
