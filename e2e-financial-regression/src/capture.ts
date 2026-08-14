import type { Page } from '@playwright/test';
import { installReadonlyGuard, assertNoWrites } from './readonly-guard';
import { loginExistingUser, userFromEnv } from './auth';
import { normalize, type ValueKind, type ValueStatus } from './money';
import { API_CAPTURE_MATCHERS, SCREENS, jsonLeaves } from './signals';

export interface CapturedSignal {
  screen: string;
  field: string;
  layer: 'api' | 'dom';
  kind: ValueKind;
  rawText: string | null;
  numeric: number | null;
  status: ValueStatus;
}

export interface CaptureResult {
  phase: string;
  revisionRef: string | null;
  baseURL: string;
  capturedAt: string;
  signals: CapturedSignal[];
}

function pathKey(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

function pathOnly(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/**
 * Log in as the configured existing user and capture every targeted financial
 * value on the affected screens, strictly read-only. Returns a flat list of
 * signals keyed by (screen, field) for the comparison step.
 *
 * `capturedAt` is stamped by the caller from the real clock (Playwright specs
 * may run under faked time elsewhere; here we pass it in to keep this pure).
 */
export async function capture(
  page: Page,
  opts: { phase: string; revisionRef?: string | null; capturedAt: string },
): Promise<CaptureResult> {
  let currentScreen = 'login';
  const violations = installReadonlyGuard(page, () => currentScreen);

  // Passive API snapshotting. Last response per (path+query) wins; bodies are
  // parsed off the wire and awaited before we build signals.
  const apiBodies = new Map<string, unknown>();
  const pending: Promise<void>[] = [];
  page.on('response', (resp) => {
    const req = resp.request();
    if (req.method().toUpperCase() !== 'GET') return;
    const url = resp.url();
    if (!API_CAPTURE_MATCHERS.some((re) => re.test(pathOnly(url)))) return;
    if (resp.status() !== 200) return;
    const ct = resp.headers()['content-type'] || '';
    if (!ct.includes('json')) return;
    pending.push(
      resp
        .json()
        .then((body) => {
          apiBodies.set(pathKey(url), body);
        })
        .catch(() => {
          /* non-JSON or disposed body: ignore, it just won't be captured */
        }),
    );
  });

  await loginExistingUser(page, userFromEnv());

  const domSignals: CapturedSignal[] = [];

  for (const spec of SCREENS) {
    currentScreen = spec.screen;
    await page.goto(spec.path, { waitUntil: 'domcontentloaded' });
    // Prove first render, then let the screen's XHRs settle so the API layer
    // and any client-computed figure are present. networkidle can be flaky on
    // apps that poll, so bound it and continue regardless.
    await spec
      .ready(page)
      .waitFor({ state: 'visible', timeout: 20000 })
      .catch(() => {
        /* header not found: record nothing for DOM; API layer may still fire */
      });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    for (const field of spec.domFields) {
      const locator = field.locate(page).first();
      const count = await locator.count().catch(() => 0);
      const present = count > 0;
      let rawText: string | null = null;
      if (present) {
        rawText = (await locator.innerText().catch(() => null))?.trim() ?? null;
      }
      const norm = normalize(present, rawText, field.kind);
      domSignals.push({
        screen: spec.screen,
        field: field.field,
        layer: 'dom',
        kind: field.kind,
        rawText: norm.rawText,
        numeric: norm.numeric,
        status: norm.status,
      });
    }
  }

  // Ensure every in-flight body parse has resolved before flattening.
  await Promise.allSettled(pending);

  const apiSignals: CapturedSignal[] = [];
  for (const [key, body] of [...apiBodies.entries()].sort()) {
    const endpoint = key.split('?')[0];
    for (const leaf of jsonLeaves(body)) {
      apiSignals.push({
        screen: `api ${endpoint}`,
        field: leaf.path,
        layer: 'api',
        kind: leaf.kind,
        rawText: leaf.rawText,
        numeric: leaf.numeric,
        status: leaf.status,
      });
    }
  }

  // Fail the whole capture loudly if any write slipped through.
  assertNoWrites(violations);

  const signals = [...domSignals, ...apiSignals].sort(
    (a, b) => a.screen.localeCompare(b.screen) || a.field.localeCompare(b.field),
  );

  return {
    phase: opts.phase,
    revisionRef: opts.revisionRef ?? null,
    baseURL: process.env.BASE_URL ?? '',
    capturedAt: opts.capturedAt,
    signals,
  };
}
