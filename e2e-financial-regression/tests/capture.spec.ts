import { test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { capture } from '../src/capture';

// Captures every targeted financial value for ONE revision and writes it to
// artifacts/<phase>.json. The orchestrator runs this twice -- once per phase
// (before/after) -- against the two revisions in turn, never concurrently.
//
// Driven entirely by environment:
//   REGRESSION_PHASE   'before' | 'after'   (which JSON to write)
//   BASE_URL           the running revision's frontend URL
//   MONIZE_*_REF       recorded into the JSON for the report header
//   MONIZE_USER_*      existing-user credentials (see src/auth.ts)

const here = dirname(fileURLToPath(import.meta.url));
const artifactsDir = resolve(here, '..', 'artifacts');

test('capture financial values (read-only)', async ({ page }) => {
  // 14 screens with per-screen settle waits; well beyond the default 60s.
  test.setTimeout(600_000);

  const phase = (process.env.REGRESSION_PHASE || '').toLowerCase();
  if (phase !== 'before' && phase !== 'after') {
    throw new Error(
      `REGRESSION_PHASE must be "before" or "after" (got "${process.env.REGRESSION_PHASE}"). ` +
        `Run via "npm run compare", which sets it per phase.`,
    );
  }

  const revisionRef =
    phase === 'before' ? process.env.MONIZE_BEFORE_REF : process.env.MONIZE_AFTER_REF;

  const result = await capture(page, {
    phase,
    revisionRef: revisionRef ?? null,
    capturedAt: new Date().toISOString(),
  });

  mkdirSync(artifactsDir, { recursive: true });
  const outFile = resolve(artifactsDir, `${phase}.json`);
  writeFileSync(outFile, JSON.stringify(result, null, 2), 'utf8');

  const known = result.signals.filter((s) => s.status === 'value').length;
  const unknown = result.signals.filter((s) => s.status === 'unknown').length;
  // eslint-disable-next-line no-console -- this is a developer CLI tool, not app code
  console.log(
    `[${phase}] captured ${result.signals.length} signals ` +
      `(${known} known, ${unknown} unknown) -> ${outFile}`,
  );
});
