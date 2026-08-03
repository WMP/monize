import { describe, it, expect } from 'vitest';

/**
 * Guard test for "a failed lookup is not an empty dataset" (`frontend/CLAUDE.md`,
 * "Asynchronous data carries the request that produced it").
 *
 * A report that catches its own fetch failure and sets the data to `[]` renders
 * the outage as a plausible answer. On the loan surfaces that is not merely an
 * empty table: `deriveLoanPaymentHistory` falls back to an *analytic interest
 * estimate* when it is handed no booked interest, so a timeout or a 500 produces
 * a complete, confident-looking amortization schedule carrying different
 * cumulative interest and a different payoff date, with nothing on screen to say
 * the actual figures never arrived.
 *
 * `LoanAmortizationReport` did exactly this. Removing the swallow from
 * `fetchLoanInterestTransactions` was not enough, because the caller had its own
 * `catch` setting both lists to `[]` with only a `logger.error` -- so the fix had
 * to reach the caller too. A test around that one component would not catch the
 * identical `catch` appearing in the next report, which is why this scans the
 * source instead -- the pattern used by `src/test/ui-conventions.test.ts` and
 * `src/lib/balance-cache.guard.test.ts`.
 *
 * The shared alternative already exists and 44 report components use it:
 * `useReportData` tracks the error, and `ReportError` renders it with a retry.
 * Fold a second loader's `error`/`isLoading`/`reload` into the component's
 * combined values rather than catching locally.
 */
const sources = import.meta.glob('/src/components/reports/*.tsx', {
  query: '?raw',
  eager: true,
  import: 'default',
}) as Record<string, string>;

/**
 * Return the body of every `catch` block in `source`, matched by brace depth.
 *
 * A regex cannot do this: a catch body contains braces of its own (object
 * literals, nested blocks), so any `catch[^}]*}` pattern stops at the first
 * inner one and reads a fraction of the handler.
 */
function catchBodies(source: string): string[] {
  const bodies: string[] = [];
  const catchKeyword = /\bcatch\b[^{]*\{/g;
  let match: RegExpExecArray | null;
  while ((match = catchKeyword.exec(source)) !== null) {
    const open = match.index + match[0].length - 1;
    let depth = 0;
    for (let i = open; i < source.length; i++) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}') {
        depth--;
        if (depth === 0) {
          bodies.push(source.slice(open + 1, i));
          break;
        }
      }
    }
  }
  return bodies;
}

/**
 * Assignments that turn a caught failure into "there is no data".
 *
 * `setX([])` is the state-setter form, `return []` the helper form. Both say
 * "loaded, and empty" about a request that did not load.
 */
const SWALLOW_PATTERNS = [
  { pattern: /\bset[A-Z][A-Za-z0-9_]*\(\s*\[\s*\]\s*\)/, what: 'setState([]) inside a catch' },
  { pattern: /\breturn\s+\[\s*\]\s*[;}\n]/, what: 'return [] inside a catch' },
];

describe('report components do not swallow a fetch failure into an empty dataset', () => {
  it('finds no catch block that sets its data to []', () => {
    const offenders: string[] = [];

    for (const [path, source] of Object.entries(sources)) {
      if (path.includes('.test.')) continue;
      for (const body of catchBodies(source)) {
        for (const { pattern, what } of SWALLOW_PATTERNS) {
          if (pattern.test(body)) {
            offenders.push(`${path}: ${what}`);
          }
        }
      }
    }

    expect(
      offenders,
      'A caught fetch failure must reach the surface, not be rendered as an ' +
        'empty result. Use useReportData + ReportError (44 report components ' +
        'already do) and fold the loader error into the combined error, rather ' +
        'than catching locally and setting the data to [].\n' +
        offenders.join('\n'),
    ).toEqual([]);
  });

  it('scans the report components it is meant to police', () => {
    // A glob that silently matches nothing would make the assertion above
    // vacuous, and it would stay green through any regression.
    const scanned = Object.keys(sources).filter((p) => !p.includes('.test.'));
    expect(scanned.length).toBeGreaterThan(50);
  });
});
