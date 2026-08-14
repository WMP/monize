import type { Page, Route, Request } from '@playwright/test';

// Machine-checked read-only guarantee.
//
// The browser talks to the backend same-origin under `/api/v1/` with
// credentials (frontend/src/lib/api.ts: baseURL '/api/v1', withCredentials).
// Every user-data mutation is therefore a POST/PUT/PATCH/DELETE to that path.
// This guard intercepts exactly those requests and BLOCKS every mutating verb
// except the tiny allowlist required to authenticate and keep the session
// alive. A blocked request is recorded so the capture can fail loudly: if a
// "read-only" navigation ever tries to write, that is a finding, not noise.

export interface Violation {
  method: string;
  url: string;
  when: string;
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// The ONLY writes allowed: logging in, satisfying CSRF, refreshing the token,
// verifying 2FA, and logging out. Matched against the URL path. Anything else
// that mutates is a violation. Keep this list minimal and explicit -- widening
// it is a reviewed decision, mirroring the codebase's allowlist convention.
const AUTH_WRITE_ALLOWLIST: RegExp[] = [
  /\/api\/v1\/auth\/login$/,
  /\/api\/v1\/auth\/2fa\/verify$/,
  /\/api\/v1\/auth\/refresh$/,
  /\/api\/v1\/auth\/csrf-refresh$/,
  /\/api\/v1\/auth\/logout$/,
];

function isAllowedAuthWrite(url: string): boolean {
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    /* keep raw url */
  }
  return AUTH_WRITE_ALLOWLIST.some((re) => re.test(path));
}

/**
 * Install the guard on a page. Returns a live array of violations; assert it
 * is empty after each capture. `label` is recorded on each violation so a
 * failure names which screen tried to write.
 */
export function installReadonlyGuard(
  page: Page,
  getLabel: () => string = () => 'capture',
): Violation[] {
  const violations: Violation[] = [];

  const handler = async (route: Route, request: Request): Promise<void> => {
    const method = request.method().toUpperCase();
    const url = request.url();

    if (!MUTATING_METHODS.has(method) || isAllowedAuthWrite(url)) {
      await route.continue();
      return;
    }

    // A mutating request that is not an allowed auth write. Record and block.
    violations.push({ method, url, when: getLabel() });
    await route.abort('failed');
  };

  // Intercept only the API surface; navigations and assets are untouched.
  void page.route('**/api/v1/**', handler);

  return violations;
}

/** Throw a loud, specific error if any write was attempted. */
export function assertNoWrites(violations: Violation[]): void {
  if (violations.length === 0) return;
  const lines = violations
    .map((v) => `  - [${v.when}] ${v.method} ${v.url}`)
    .join('\n');
  throw new Error(
    `Read-only guarantee VIOLATED: the app attempted ${violations.length} ` +
      `data-mutating request(s) during a read-only capture:\n${lines}\n` +
      `This harness must never write user data. If one of these is genuinely ` +
      `safe, add it to AUTH_WRITE_ALLOWLIST in src/readonly-guard.ts as a ` +
      `reviewed decision -- do not loosen the guard blindly.`,
  );
}
