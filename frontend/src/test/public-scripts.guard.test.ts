import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';

/**
 * The ZAP baseline scan flags keywords ("user", "from", "where", "query") in
 * the comments of any script it fetches (rule 10027, INFO risk), and
 * `.github/zap/rules.tsv` silences that rule on a single claim: the only
 * script served with its comments intact is `public/sw.js`, the hand-written
 * service worker of an open-source app, whose comments document behaviour
 * that is already public. Everything the Next build emits is minified, so it
 * carries no comments for the rule to read.
 *
 * That claim is about the source, so it is checked here rather than left in a
 * comment. A new verbatim-served script, or a work-in-progress note left in
 * the worker, would otherwise ship under a rule silenced for something else.
 */

const PUBLIC_DIR = path.join(process.cwd(), 'public');

// Every file under public/ that a browser executes or renders as markup, and
// why it is allowed to ship unminified. A new entry is the moment to ask
// whether its comments say anything a visitor should not read.
const VERBATIM_SCRIPTS: Record<string, string> = {
  'sw.js':
    'the service worker: must be served at the origin root under a stable URL, so it is not a build artifact. Its comments describe behaviour, never a credential, host or unfinished work.',
};

const SCRIPT_OR_MARKUP_RE = /\.(?:m?js|cjs|html?)$/i;

// Developer notes that mark unfinished or known-broken work: the part of rule
// 10027 that is a real disclosure rather than a keyword match on prose.
const WORK_IN_PROGRESS_RE = /\b(?:TODO|FIXME|XXX|HACK|BUGS?)\b/;

function listFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full) : [full];
  });
}

describe('scripts served verbatim from public/ (ZAP 10027)', () => {
  it('ships no unminified script or page beyond the reviewed list', () => {
    const served = listFiles(PUBLIC_DIR)
      .map((file) => path.relative(PUBLIC_DIR, file).split(path.sep).join('/'))
      .filter((file) => SCRIPT_OR_MARKUP_RE.test(file))
      .sort();

    expect(served).toEqual(Object.keys(VERBATIM_SCRIPTS).sort());
  });

  it.each(Object.keys(VERBATIM_SCRIPTS))(
    '%s carries no work-in-progress marker',
    (file) => {
      const offending = fs
        .readFileSync(path.join(PUBLIC_DIR, file), 'utf8')
        .split('\n')
        .map((line, index) => ({ line: line.trim(), number: index + 1 }))
        .filter(({ line }) => WORK_IN_PROGRESS_RE.test(line))
        .map(({ line, number }) => `${file}:${number}: ${line}`);

      expect(offending).toEqual([]);
    },
  );
});
