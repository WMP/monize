#!/usr/bin/env node
/**
 * Integration-suite discovery guard: a CI gate that runs before Jest.
 *
 * `npm run test:integration` used to pass `--passWithNoTests`, which means a
 * green "Backend Integration Tests" check proved nothing about whether any
 * integration test ran. Anything that breaks discovery -- a directory rename, a
 * `--testPathPatterns` escaping change, a suite accidentally moved out of the
 * tree -- produced a successful job that exercised zero real-PostgreSQL,
 * cross-user-isolation or RLS behaviour. That layer exists precisely to cover
 * what the unit suites mock away, so a silent zero there is the most expensive
 * false green in the pipeline.
 *
 * This script asserts the inventory is intact *before* Jest is invoked:
 *
 *  1. every suite in MANDATORY_SUITES is present;
 *  2. the total count is at least MINIMUM_SUITES;
 *  3. the discovered list is printed, so a job log shows what was covered
 *     rather than leaving the reader to infer it.
 *
 * MANDATORY_SUITES is not "every file" on purpose -- pinning the whole list
 * would make the guard fail on every legitimate addition and get deleted. It
 * names the suites whose disappearance would mean losing a class of coverage
 * that nothing else replaces. Adding to it is a reviewed decision; removing
 * from it should be too.
 *
 * Usage:
 *   node scripts/integration-inventory.mjs
 *   node scripts/integration-inventory.mjs --dir some/other/dir
 */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_DIR = "test/integration";
const SUITE_SUFFIX = ".integration.spec.ts";

/**
 * Suites that must exist. Each protects an invariant no other layer covers:
 * real transaction/balance behaviour, cross-user isolation at the service
 * boundary, database-enforced RLS under the unprivileged runtime role, the MNY
 * import's concurrent job claim, paired transfers, and backup/restore.
 */
const MANDATORY_SUITES = [
  "transactions.integration.spec.ts",
  "transfers.integration.spec.ts",
  "security-cross-user-isolation.integration.spec.ts",
  "rls-enforcement.integration.spec.ts",
  "rls-harness.integration.spec.ts",
  "mny-import-job.integration.spec.ts",
  "security-transfer.integration.spec.ts",
  "backup-restore.integration.spec.ts",
  "support-backup.integration.spec.ts",
  // The P7-008 concurrency set. Each drives a specific interleaving that the
  // rest of the suite cannot reach, and the harness self-test is what proves the
  // others are not quietly passing because their gate stopped gating -- so if
  // that one goes, the whole set loses its meaning rather than one case.
  //
  // The import-start race is deliberately *not* here: `mny-import-job` covers
  // that invariant more thoroughly, and two suites racing the same insert is
  // duplication rather than depth.
  "race-harness.integration.spec.ts",
  "race-emergency-claim.integration.spec.ts",
  "race-refresh-token-revocation.integration.spec.ts",
  "race-account-balance.integration.spec.ts",
  "race-holdings-rebuild.integration.spec.ts",
  "race-security-transfer.integration.spec.ts",
];

/**
 * A floor, not a target. Set below the current count so ordinary churn does not
 * trip it, but far enough above zero that a discovery regression cannot slip
 * through as "well, some tests ran". It also has to sit *above* the length of
 * MANDATORY_SUITES, or that list growing quietly retires the floor -- which is
 * what happened when the concurrency suites were added and 15 mandatory files
 * were suddenly enough to clear a floor of 15.
 */
const MINIMUM_SUITES = 20;

function parseArgs(argv) {
  const dirFlag = argv.indexOf("--dir");
  return { dir: dirFlag === -1 ? DEFAULT_DIR : argv[dirFlag + 1] };
}

function discover(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch (error) {
    return { error: `cannot read ${dir}: ${error.message}`, suites: [] };
  }
  const suites = entries
    .filter((name) => name.endsWith(SUITE_SUFFIX))
    .filter((name) => statSync(join(dir, name)).isFile())
    .sort();
  return { error: null, suites };
}

function main() {
  const { dir } = parseArgs(process.argv.slice(2));
  const { error, suites } = discover(dir);

  if (error) {
    console.error(`Integration inventory: ${error}`);
    console.error(
      "The integration suites could not be listed at all, so the job would " +
        "otherwise have run zero tests and reported success.",
    );
    process.exit(1);
  }

  console.log(`Integration inventory: ${suites.length} suite(s) in ${dir}`);
  for (const suite of suites) console.log(`  - ${suite}`);

  const problems = [];

  const missing = MANDATORY_SUITES.filter((name) => !suites.includes(name));
  if (missing.length > 0) {
    problems.push(
      `missing mandatory suite(s): ${missing.join(", ")}. If one was ` +
        `deliberately renamed or removed, update MANDATORY_SUITES in this ` +
        `script in the same change, so the decision is visible in review.`,
    );
  }

  if (suites.length < MINIMUM_SUITES) {
    problems.push(
      `found ${suites.length} suite(s), expected at least ${MINIMUM_SUITES}. ` +
        `A sharp drop usually means discovery broke rather than that tests ` +
        `were deleted.`,
    );
  }

  if (problems.length > 0) {
    console.error("\nIntegration inventory check failed:");
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }

  console.log("Integration inventory check passed.");
}

main();
