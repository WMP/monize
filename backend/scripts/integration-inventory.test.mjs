/**
 * Self-test for the integration inventory guard, in the shape of
 * `migration-lint.test.mjs`: build a temporary directory, run the script
 * against it, and assert on the exit code.
 *
 * A guard that cannot fail is not a guard, so the cases that matter are the
 * negative ones -- an empty directory, a missing directory, and a missing
 * mandatory suite must each exit non-zero.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(here, "integration-inventory.mjs");

const MANDATORY = [
  "transactions.integration.spec.ts",
  "transfers.integration.spec.ts",
  "security-cross-user-isolation.integration.spec.ts",
  "rls-enforcement.integration.spec.ts",
  "rls-harness.integration.spec.ts",
  "mny-import-job.integration.spec.ts",
  "security-transfer.integration.spec.ts",
  "backup-restore.integration.spec.ts",
  "support-backup.integration.spec.ts",
  "race-harness.integration.spec.ts",
  "race-emergency-claim.integration.spec.ts",
  "race-refresh-token-revocation.integration.spec.ts",
  "race-account-balance.integration.spec.ts",
  "race-holdings-rebuild.integration.spec.ts",
  "race-security-transfer.integration.spec.ts",
];

function run(dir) {
  return spawnSync(process.execPath, [SCRIPT, "--dir", dir], {
    encoding: "utf8",
  });
}

function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "integration-inventory-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Write the mandatory suites plus enough filler to clear the floor. */
function seedComplete(dir, extra = 10) {
  for (const name of MANDATORY) writeFileSync(join(dir, name), "");
  for (let i = 0; i < extra; i++) {
    writeFileSync(join(dir, `filler-${i}.integration.spec.ts`), "");
  }
}

test("passes on a complete inventory", () => {
  withDir((dir) => {
    seedComplete(dir);
    const result = run(dir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Integration inventory check passed/);
  });
});

test("prints the discovered suite list", () => {
  withDir((dir) => {
    seedComplete(dir);
    const result = run(dir);
    // The log is the point: a reader should see what was covered.
    assert.match(result.stdout, /transactions\.integration\.spec\.ts/);
    assert.match(result.stdout, /suite\(s\) in/);
  });
});

test("fails on an empty directory", () => {
  withDir((dir) => {
    const result = run(dir);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /expected at least/);
  });
});

test("fails when the directory does not exist", () => {
  withDir((dir) => {
    const result = run(join(dir, "nope"));
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /cannot read/);
  });
});

test("fails when a mandatory suite is missing", () => {
  withDir((dir) => {
    seedComplete(dir);
    rmSync(join(dir, "rls-enforcement.integration.spec.ts"));
    const result = run(dir);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /missing mandatory suite/);
    assert.match(result.stderr, /rls-enforcement/);
  });
});

test("fails when the count drops below the floor even with all mandatory suites", () => {
  withDir((dir) => {
    // Every mandatory suite and no filler: still below MINIMUM_SUITES, which is
    // the property that keeps the floor meaningful as MANDATORY_SUITES grows.
    for (const name of MANDATORY) writeFileSync(join(dir, name), "");
    const result = run(dir);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /expected at least/);
  });
});

test("ignores directories that look like suites", () => {
  withDir((dir) => {
    seedComplete(dir);
    mkdirSync(join(dir, "decoy.integration.spec.ts"));
    const result = run(dir);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /- decoy\.integration\.spec\.ts/);
  });
});

test("ignores unit specs sitting in the directory", () => {
  withDir((dir) => {
    seedComplete(dir);
    writeFileSync(join(dir, "helper.spec.ts"), "");
    const result = run(dir);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /- helper\.spec\.ts/);
  });
});
