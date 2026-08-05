import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Documentation that names a number is making a claim about the configuration.
 *
 * The audit found `frontend/CLAUDE.md` promising an 85% branch threshold while
 * `vitest.config.ts` enforced 84%. A contributor following the document runs a
 * weaker gate than CI and reasonably believes the change is ready. That is the
 * cheap end of this failure mode; the expensive end is the Helm README, which
 * told operators to install `./helm/monize` when the chart root is `helm/`, so
 * every documented command failed.
 *
 * Prose gets read, agreed with, and drifts anyway -- the root `CLAUDE.md` says
 * to prefer the rule a machine can check, so these are checks rather than a
 * corrected paragraph. Each one parses the executable configuration and asserts
 * the document agrees, which means the next change to a threshold or a chart
 * path fails here instead of misleading someone months later.
 */

const repoRoot = join(__dirname, '..', '..', '..');
const read = (relativePath: string) =>
  readFileSync(join(repoRoot, relativePath), 'utf-8');

/** Coverage thresholds as the Vitest config actually declares them. */
function frontendThresholds(): Record<string, number> {
  const config = read('frontend/vitest.config.ts');
  const block = /thresholds:\s*\{([\s\S]*?)\}/.exec(config);
  expect(block, 'vitest.config.ts no longer declares a thresholds block').toBeTruthy();
  const thresholds: Record<string, number> = {};
  for (const [, key, value] of block![1].matchAll(/(\w+):\s*(\d+)/g)) {
    thresholds[key] = Number(value);
  }
  return thresholds;
}

/** Coverage thresholds as the backend's Jest config declares them. */
function backendThresholds(): Record<string, number> {
  const pkg = JSON.parse(read('backend/package.json'));
  return pkg.jest.coverageThreshold.global;
}

describe('frontend coverage thresholds are documented accurately', () => {
  const thresholds = frontendThresholds();

  it('declares all four thresholds', () => {
    expect(Object.keys(thresholds).sort()).toEqual([
      'branches',
      'functions',
      'lines',
      'statements',
    ]);
  });

  it.each([
    ['lines', 'lines'],
    ['statements', 'stmts'],
    ['functions', 'funcs'],
    ['branches', 'branches'],
  ])('frontend/CLAUDE.md states the enforced %s threshold', (key, label) => {
    const doc = read('frontend/CLAUDE.md');
    const expected = `${thresholds[key]}% ${label}`;
    expect(
      doc.includes(expected),
      `frontend/CLAUDE.md should say "${expected}" (vitest.config.ts enforces ` +
        `${thresholds[key]}% ${key}). Update the document, not this test, unless ` +
        `the threshold itself changed.`,
    ).toBe(true);
  });

  it('frontend/CLAUDE.md does not name a threshold the config does not enforce', () => {
    // The original defect: the document said 85% branches while the config
    // said 84%, so both numbers appeared in the repository and only one was real.
    const doc = read('frontend/CLAUDE.md');
    const claimed = [...doc.matchAll(/(\d+)% (lines|stmts|statements|funcs|functions|branches)/g)];
    expect(claimed.length).toBeGreaterThan(0);
    const alias: Record<string, string> = {
      lines: 'lines',
      stmts: 'statements',
      statements: 'statements',
      funcs: 'functions',
      functions: 'functions',
      branches: 'branches',
    };
    for (const [match, value, label] of claimed) {
      const key = alias[label];
      expect(
        Number(value),
        `frontend/CLAUDE.md claims "${match}" but vitest.config.ts enforces ` +
          `${thresholds[key]}% ${key}.`,
      ).toBe(thresholds[key]);
    }
  });
});

describe('backend coverage thresholds are documented accurately', () => {
  const thresholds = backendThresholds();

  it.each([
    ['lines', 'lines'],
    ['statements', 'stmts'],
    ['functions', 'funcs'],
    ['branches', 'branches'],
  ])('backend/CLAUDE.md states the enforced %s threshold', (key, label) => {
    const doc = read('backend/CLAUDE.md');
    const expected = `${thresholds[key]}% ${label}`;
    expect(
      doc.includes(expected),
      `backend/CLAUDE.md should say "${expected}" (package.json enforces ` +
        `${thresholds[key]}% ${key}).`,
    ).toBe(true);
  });
});

describe('Playwright browser projects are documented accurately', () => {
  const config = read('e2e/playwright.config.ts');
  const projects = [...config.matchAll(/name:\s*'([^']+)'/g)].map((m) => m[1]);

  it('runs the browsers the config declares', () => {
    // Recorded so a document (or a reviewer) claiming "Chromium only" is
    // contradicted by something executable.
    expect(projects).toContain('chromium');
    expect(projects.length).toBeGreaterThan(0);
  });

  it('CLAUDE.md does not claim a browser matrix the config contradicts', () => {
    const doc = read('CLAUDE.md');
    if (/chromium[- ]only/i.test(doc)) {
      expect(
        projects.length,
        'CLAUDE.md says Chromium-only but playwright.config.ts declares ' +
          `${projects.join(', ')}.`,
      ).toBe(1);
    }
  });
});

describe('the Helm README points at the real chart root', () => {
  // `helm install monize ./helm/monize` failed for every operator who copied it:
  // Chart.yaml lives at helm/Chart.yaml, so the chart root is `helm`.
  const chartRoot = 'helm';

  it('Chart.yaml is where the commands must point', () => {
    const chart = read(`${chartRoot}/Chart.yaml`);
    expect(chart).toMatch(/^name:\s*monize$/m);
  });

  it('every helm command in the README uses a path that exists', () => {
    const doc = read('helm/README.md');
    const paths = [...doc.matchAll(/helm\s+(?:install|upgrade|template|lint)[^\n]*?(\.\/\S+)/g)]
      .map((m) => m[1])
      .filter((p) => p.startsWith('./helm'));
    expect(paths.length, 'no helm commands found in helm/README.md').toBeGreaterThan(0);
    for (const path of new Set(paths)) {
      expect(
        path,
        `helm/README.md documents "${path}", but the chart root is "./${chartRoot}" ` +
          `(that is where Chart.yaml lives). A copied command fails outright.`,
      ).toBe(`./${chartRoot}`);
    }
  });
});
