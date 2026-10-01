// Oracle note (skill: reliable-tests; risk HIGH: shared test tooling, an agent guard rail).
// Rule source: the hook specification: its decision table (rows 1-8), its "test-related"
// definition (four rules plus the Markdown exception), its "skill was loaded" definition (two
// markers, subagent rules), its exit codes and its message contract. Every expected value is a
// literal read off it; none is computed with the hook or copied from its source (which was not
// opened while this file was written). Run: node --test .claude/hooks/require-reliable-tests.test.mjs
// The hook runs as a real child process (stdin JSON in; exit code, stderr out). Group -> wrong
// hook caught:
//  G1  row 1   stdin not a JSON object -> 1: a crash (also exit 1, but no "skipped" notice), a
//              silent allow (0) or a block (2) on unreadable input.
//  G2  row 2   other tools -> 0: judging Bash/Read, or matching tool names loosely.
//  G3  row 3   no path -> 0: the wrong field (file_path for NotebookEdit and back); blocking.
//  G4  row 4   outside the project -> 0: prefix containment (<root>-evil), ".." not resolved.
//  G5  row 5   test-related: each rule and spec example, the Markdown exception, near misses a
//              loose substring match would block (latest.ts, __mocks__x/, docs/e2e/).
//  G6  row 6   skill loaded: both markers; escaped quoted form, "reliable-tests-old", a bare
//              mention, marker text in the edit itself must NOT count; whole file, read as text.
//  G7  row 7   main transcript unreadable -> 1, never 2 (never block on the hook's own failure).
//  G8  row 8   block (2) and the message: path, "reliable-tests", how to proceed; four tools.
//  G9          subagents: own and parent transcripts count, a sibling's never, a missing file is
//              empty, a hostile agent_id never becomes a path.
//  G10         project root = CLAUDE_PROJECT_DIR else cwd; relative paths resolve against cwd.
//  G11         row order: rows 2-5 decide before the transcript is read (row 7 must not win).
//  G12         constraints: nothing written, stdin read to the end, an internal error is exit 1
//              (never 2; injected through a preload), the spec's source limits.

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK = fileURLToPath(new URL('./require-reliable-tests.mjs', import.meta.url));

// ---------------------------------------------------------------------------------------
// Fixture tree: one temporary directory for this file, removed afterwards.
// ---------------------------------------------------------------------------------------
const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rt-hook-')));
// A space and regex metacharacters in the root on purpose: roots like "My Code (old)" exist.
const ROOT = `${TMP}/proj (a+b) [x]`;
const OUTSIDE = `${TMP}/outside`; // beside the project, not inside it
const EVIL = `${ROOT}-evil`; // sibling whose name starts with the root's whole name
const TRANSCRIPTS = `${TMP}/transcripts dir (1)`; // like ~/.claude/projects: outside the project
const SPAWN_CWD = `${TMP}/spawn-cwd`; // process cwd of the hook; never the stdin cwd
const CHILD_TMP = `${TMP}/child-tmp`; // TMPDIR of the hook; must stay empty
for (const sub of ['backend/src', 'backend/test', 'e2e/tests', 'frontend/src']) {
  fs.mkdirSync(`${ROOT}/${sub}`, { recursive: true });
}
for (const d of [OUTSIDE, EVIL, TRANSCRIPTS, SPAWN_CWD, CHILD_TMP]) fs.mkdirSync(d, { recursive: true });
const cleanup = () => {
  try {
    fs.rmSync(TMP, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
};
process.on('exit', cleanup);

const at = (rel) => `${ROOT}/${rel}`;
const TEST_FILE = 'backend/test/helpers/db.ts'; // test-related by rule 2 only
const PROD_FILE = 'backend/src/payees/payees.service.ts';
const MISSING = Symbol('omit the key');

// ---------------------------------------------------------------------------------------
// Transcript builders. Lines look like Claude Code's JSON Lines transcripts.
// ---------------------------------------------------------------------------------------
const jl = (obj) => `${JSON.stringify(obj)}\n`;
const raw = (text) => `${text}\n`;
const userText = (text) => jl({ type: 'user', message: { role: 'user', content: text } });
const assistantText = (text) =>
  jl({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });
const skillCall = (skill, extra = {}) => {
  const block = { type: 'tool_use', id: 'toolu_01SkillCall', name: 'Skill', input: { skill, ...extra } };
  return jl({ type: 'assistant', message: { role: 'assistant', content: [block] } });
};
const slashCommand = (name, args) =>
  userText(
    `<command-message>${name}</command-message>\n<command-name>/${name}</command-name>` +
      (args ? `\n<command-args>${args}</command-args>` : ''),
  );

const BASE = [userText('Please fix the failing payees test.'), assistantText('Looking at it now.')];
let seq = 0;
function transcript(label, ...lines) {
  const file = `${TRANSCRIPTS}/${label}-${++seq}.jsonl`;
  fs.writeFileSync(file, lines.join(''));
  return file;
}
const NO_SKILL = transcript('no-skill', ...BASE);
const WITH_SKILL = transcript('with-skill', ...BASE, skillCall('reliable-tests'));
// Where the spec puts a subagent transcript: <transcript_path minus .jsonl>/subagents/
const agentDir = (main) => `${main.slice(0, -'.jsonl'.length)}/subagents`;
function agentTranscript(main, id, ...lines) {
  fs.mkdirSync(agentDir(main), { recursive: true });
  fs.writeFileSync(`${agentDir(main)}/agent-${id}.jsonl`, lines.join(''));
}

// ---------------------------------------------------------------------------------------
// Running the hook and judging the outcome.
// ---------------------------------------------------------------------------------------
const TOOL_BODY = {
  Edit: { old_string: 'a', new_string: 'b' },
  Write: { content: 'export {};\n' },
  MultiEdit: { edits: [{ old_string: 'a', new_string: 'b' }] },
  NotebookEdit: { new_source: 'x = 1', edit_mode: 'replace' },
};

/** A PreToolUse payload. `extra` is spread last: a key set to undefined is left out. */
function request(file, { tool = 'Edit', transcript: tp = NO_SKILL, cwd = ROOT, ...extra } = {}) {
  const key = tool === 'NotebookEdit' ? 'notebook_path' : 'file_path';
  return {
    session_id: '85b0a5c1-01ce-5517-bb9a-26d7f9f5e552',
    transcript_path: tp === MISSING ? undefined : tp,
    cwd,
    permission_mode: 'default',
    hook_event_name: 'PreToolUse',
    tool_name: tool,
    tool_input: { [key]: file, ...(TOOL_BODY[tool] ?? {}) },
    tool_use_id: 'toolu_01TestUse',
    ...extra,
  };
}

// A crash prints a stack trace and exits 1, the same code as "check skipped": never let it
// pass for a handled outcome.
const CRASH = /^\s+at .+(:\d+:\d+|<anonymous>)\)?\s*$|^Node\.js v\d|node:internal/m;

/** projectDir: a path sets CLAUDE_PROJECT_DIR, null leaves it unset. `env` adds variables. */
function run(stdin, { projectDir = ROOT, spawnCwd = SPAWN_CWD, env: more = {} } = {}) {
  assert.ok(fs.existsSync(HOOK), `the hook under test does not exist: ${HOOK}`);
  const env = { ...process.env, TMPDIR: CHILD_TMP, ...more };
  delete env.NODE_TEST_CONTEXT;
  delete env.CLAUDE_PROJECT_DIR;
  if (projectDir !== null) env.CLAUDE_PROJECT_DIR = projectDir;
  const r = spawnSync(process.execPath, [HOOK], {
    input: typeof stdin === 'string' ? stdin : JSON.stringify(stdin),
    env,
    cwd: spawnCwd,
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  assert.equal(r.error, undefined, `could not run the hook: ${r.error?.message}`);
  assert.equal(r.signal, null, `the hook was killed by ${r.signal}`);
  assert.doesNotMatch(r.stderr, CRASH, `stderr looks like a crash, not an outcome:\n${r.stderr}`);
  return r;
}

const fmt = (r) =>
  `exit=${r.status} stdout=${JSON.stringify(r.stdout)} stderr=${JSON.stringify(r.stderr)}`;

function expectAllowed(r, label = '') {
  assert.equal(r.status, 0, `${label} expected exit 0 (allow); got ${fmt(r)}`);
  assert.equal(r.stdout, '', `${label} exit 0 must print nothing; got ${fmt(r)}`);
  assert.equal(r.stderr, '', `${label} exit 0 must print nothing; got ${fmt(r)}`);
}

function expectBlocked(r, relPath, label = '') {
  assert.equal(r.status, 2, `${label} expected exit 2 (block); got ${fmt(r)}`);
  assert.ok(r.stderr.includes(relPath), `${label} message must name ${relPath}; got ${fmt(r)}`);
  assert.ok(r.stderr.includes('reliable-tests'), `${label} message must name reliable-tests`);
}

function expectSkipped(r, why, label = '') {
  assert.equal(r.status, 1, `${label} expected exit 1 (skipped, never 2); got ${fmt(r)}`);
  assert.match(r.stderr, /skip/i, `${label} stderr must say the check was skipped; ${fmt(r)}`);
  assert.match(r.stderr, why, `${label} stderr must say why; got ${fmt(r)}`);
}

// =======================================================================================
describe('require-reliable-tests hook', () => {
  after(cleanup);

  describe('G1 row 1: stdin is not a JSON object -> exit 1, check skipped', () => {
    const cases = [
      ['plain text', 'not json'],
      ['empty stdin', ''],
      ['whitespace only', '  \n\t '],
      ['truncated JSON', '{"tool_name":"Edit","tool_input":{"file_path":'],
      ['two JSON documents', '{}{}'],
      ['JSON null', 'null'],
      ['JSON number', '42'],
      ['JSON string', '"Edit"'],
      ['JSON true', 'true'],
      // A JSON array is not a JSON object (a JS array is typeof "object", hence these cases).
      ['JSON empty array', '[]'],
      ['JSON array holding a valid request', JSON.stringify([request(at(TEST_FILE))])],
    ];
    for (const [name, stdin] of cases) {
      it(name, () => {
        expectSkipped(run(stdin), /json|stdin|input/i, name);
      });
    }
  });

  describe('G2 row 2: tool_name is not Edit, Write, MultiEdit or NotebookEdit -> exit 0', () => {
    const body = {
      file_path: at('backend/test/a.spec.ts'),
      notebook_path: at('e2e/a.ipynb'),
      command: 'echo x > backend/test/a.spec.ts',
    };
    const tools = [
      'Bash', 'Read', 'Grep', 'Glob', 'Task', 'Agent', 'WebFetch', 'NotebookRead', 'Skill',
      'edit', 'EDIT', 'write', 'WriteFile', 'MultiEditing', 'mcp__fs__Edit', 'Edit ', '',
    ];
    for (const tool of tools) {
      it(`allows tool ${JSON.stringify(tool)} aimed at a test path`, () => {
        expectAllowed(run(request(at('backend/test/a.spec.ts'), { tool, tool_input: body })), tool);
      });
    }
    for (const [name, extra] of [['missing', { tool_name: undefined }], ['a number', { tool_name: 42 }]]) {
      it(`allows a request whose tool_name is ${name}`, () => {
        expectAllowed(run(request(at(TEST_FILE), extra)));
      });
    }
  });

  describe('G3 row 3: no file path in tool_input -> exit 0', () => {
    const testFile = at('backend/test/a.spec.ts');
    const cases = [
      ['Edit, tool_input is {}', { tool: 'Edit', tool_input: {} }],
      ['Write, tool_input missing', { tool: 'Write', tool_input: undefined }],
      ['MultiEdit, tool_input is null', { tool: 'MultiEdit', tool_input: null }],
      ['Edit, tool_input is a string', { tool: 'Edit', tool_input: testFile }],
      ['Edit, tool_input is an array', { tool: 'Edit', tool_input: [testFile] }],
      // cwd is a test directory: an empty path must not be read as "the cwd".
      ['Edit, file_path is empty', { tool: 'Edit', cwd: `${ROOT}/e2e/tests`, tool_input: { file_path: '' } }],
      ['Edit, file_path is null', { tool: 'Edit', tool_input: { file_path: null } }],
      ['NotebookEdit, tool_input is {}', { tool: 'NotebookEdit', tool_input: {} }],
      ['NotebookEdit, notebook_path is empty', { tool: 'NotebookEdit', cwd: `${ROOT}/e2e/tests`, tool_input: { notebook_path: '' } }],
    ];
    for (const [name, opts] of cases) {
      it(name, () => {
        expectAllowed(run(request(testFile, opts)), name);
      });
    }

    // Each tool reads its own field and no other (spec: file_path for the first three,
    // notebook_path for NotebookEdit). A block needs the right field to be a test path.
    const NB = 'backend/test/analysis.ipynb';
    const prod = { file_path: at('docs/x.ts'), notebook_path: at('docs/x.ipynb') };
    const fieldCases = [
      ['NotebookEdit ignores file_path', 'NotebookEdit', { ...prod, file_path: at(TEST_FILE) }, null],
      ['NotebookEdit judges notebook_path', 'NotebookEdit', { ...prod, notebook_path: at(NB) }, NB],
      ['NotebookEdit with only file_path has no path', 'NotebookEdit', { file_path: at(TEST_FILE) }, null],
      ...['Edit', 'Write', 'MultiEdit'].flatMap((t) => [
        [`${t} ignores notebook_path`, t, { ...prod, notebook_path: at(NB) }, null],
        [`${t} judges file_path`, t, { ...prod, file_path: at(TEST_FILE) }, TEST_FILE],
        [`${t} with only notebook_path has no path`, t, { notebook_path: at(NB) }, null],
      ]),
    ];
    for (const [name, tool, input, blockedPath] of fieldCases) {
      it(name, () => {
        const r = run(request(at(TEST_FILE), { tool, tool_input: input }));
        if (blockedPath === null) expectAllowed(r, name);
        else expectBlocked(r, blockedPath, name);
      });
    }
  });

  describe('G4 row 4: resolved path outside the project root -> exit 0', () => {
    // Every case would be blocked if it were inside (a test path, no marker in the transcript).
    const outside = [
      ['absolute path in an unrelated directory', `${OUTSIDE}/backend/test/a.spec.ts`, ROOT],
      ['absolute path at the filesystem root', '/e2e/a.spec.ts', ROOT],
      ['one ../ out of the root', `${ROOT}/../outside/backend/test/a.spec.ts`, ROOT],
      ['several ../ out of a subdirectory', `${ROOT}/backend/src/../../../outside/e2e/a.spec.ts`, ROOT],
      ['sibling directory named <root>-evil', `${EVIL}/backend/test/a.spec.ts`, ROOT],
      ['relative ../ out of the root', '../outside/e2e/a.spec.ts', ROOT],
      ['relative path, cwd outside the project', 'backend/test/a.spec.ts', OUTSIDE],
      ['relative ../../ out of a subdirectory', '../../outside/e2e/a.spec.ts', `${ROOT}/backend`],
    ];
    for (const [name, file, cwd] of outside) {
      it(name, () => {
        expectAllowed(run(request(file, { cwd })), name);
      });
    }

    // Paths are normalised before they are judged, in both directions.
    const normalised = [
      ['"./" and "//" segments', `${ROOT}/./backend//test/a.ts`, 'backend/test/a.ts'],
      ['../ from production code into backend/test', `${ROOT}/backend/src/../test/a.ts`, 'backend/test/a.ts'],
      ['../ between two top-level directories', `${ROOT}/frontend/../backend/test/a.ts`, 'backend/test/a.ts'],
      ['out of the root and back in', `${ROOT}/../${path.basename(ROOT)}/backend/test/a.ts`, 'backend/test/a.ts'],
      ['../ out of backend/test into production code', `${ROOT}/backend/test/../src/payees/payees.service.ts`, null],
      ['../ out of e2e into docs', `${ROOT}/e2e/../docs/testing.md`, null],
      ['../ inside e2e onto a Markdown file', `${ROOT}/e2e/tests/../CLAUDE.md`, null],
      ['the project root itself', ROOT, null],
      ['the project root with a trailing slash', `${ROOT}/`, null],
    ];
    for (const [name, file, blockedPath] of normalised) {
      it(`normalises: ${name}`, () => {
        const r = run(request(file));
        if (blockedPath === null) expectAllowed(r, name);
        else expectBlocked(r, blockedPath, name);
      });
    }
  });

  // G5: the definition of "test-related", from the spec's four rules and its examples.
  const BLOCKED = [
    ['rule 1, spec examples at the repo root', [
      'a.spec.ts', 'A.test.tsx', 'x.test.mjs', 'payees.e2e-spec.ts', 'y.spec.js',
    ]],
    ['rule 1, spec examples in a plain directory', [
      'backend/src/payees/a.spec.ts', 'backend/src/payees/A.test.tsx',
      'backend/src/payees/x.test.mjs', 'backend/src/payees/payees.e2e-spec.ts',
      'backend/src/payees/y.spec.js',
    ]],
    ['rule 1, other names and extensions', [
      'spec.ts', 'test.js', 'a-test.ts', 'a.b.c.spec.ts',
      'backend/src/payees/a.test.jsx', 'backend/src/payees/a.spec.cjs',
      'backend/src/payees/a.spec.mts', 'backend/src/payees/a.test.cts',
      'backend/src/payees/a.test.mjs', 'backend/src/payees/a.spec.tsx',
      'backend/src/payees/payees.service.spec.ts', 'frontend/src/components/Foo.test.tsx',
      '.claude/hooks/require-reliable-tests.test.mjs',
    ]],
    ['rule 2, prefixes (any file type except Markdown)', [
      'backend/test/jest-e2e.json', 'backend/test/setup/db.ts', 'backend/test/a/b/c/d.ts',
      'backend/test/integration/seed.sql', 'backend/src/test-helpers/factory.ts',
      'frontend/src/test/setup.ts', 'frontend/src/test/utils/render.tsx',
      'e2e/helpers/auth.ts', 'e2e/package.json', 'e2e/tests/a.spec.ts',
      'e2e/docker/Dockerfile', 'e2e/brand-new-dir/new-file.ts', 'e2e/playwright.push.config.ts',
    ]],
    ['rule 3, directory segment or .snap', [
      'backend/src/accounts/__mocks__/accounts.service.ts',
      'frontend/src/components/__fixtures__/data.json',
      'frontend/src/components/__snapshots__/notes.txt',
      'frontend/src/components/__snapshots__/Foo.test.tsx.snap',
      '__mocks__/a.ts', 'backend/src/a/__fixtures__/deep/er/file.csv',
      'backend/src/Foo.snap', 'frontend/src/components/Foo.test.tsx.snap', 'x.snap',
    ]],
    ['rule 4, runner configuration', [
      'vitest.config.ts', 'playwright.push.config.ts', 'jest.config.js',
      'backend/jest.config.js', 'frontend/vitest.config.ts', 'frontend/vitest.config.mts',
      'backend/jest.config.cjs', 'frontend/playwright.config.ts',
      'tools/playwright.push.config.ts', 'frontend/vitest-ui.config.ts',
      'backend/jest.e2e.config.js',
    ]],
  ];
  const ALLOWED = [
    ['the spec "must be allowed" list', [
      'backend/src/accounts/accounts.service.ts', 'frontend/src/lib/format.ts',
      'docs/backend/testing.md', 'AGENTS.md', 'CLAUDE.md', 'e2e/CLAUDE.md', 'e2e/ROADMAP.md',
      '.claude/skills/reliable-tests/SKILL.md', 'backend/package.json',
      'database/migrations/20260101000000_x.sql', 'frontend/src/lib/latest.ts',
      'frontend/src/lib/contest.ts',
    ]],
    ['other production code, config and tooling', [
      PROD_FILE, 'frontend/src/components/Foo.tsx', 'database/schema.sql',
      'scripts/check-env-docs.mjs', '.github/workflows/ci.yml', 'backend/eslint.config.mjs',
      'frontend/next.config.ts', 'frontend/postcss.config.mjs', '.claude/settings.json',
      '.claude/hooks/require-reliable-tests.mjs',
      '.claude/skills/reliable-tests/scripts/mutation-probe.mjs',
    ]],
    ['Markdown is never test-related', [
      'backend/test/README.md', 'frontend/src/test/NOTES.md', 'backend/src/test-helpers/README.md',
      'backend/src/__mocks__/README.md', 'frontend/src/__fixtures__/notes.md',
      'e2e/tests/notes.md', 'e2e/README.md',
    ]],
    ['near misses of the file-name rules (rules 1, 3, 4)', [
      'backend/src/payees/a.tests.ts', 'backend/src/payees/a.test.json',
      'backend/src/payees/a.spec.ts.bak', 'backend/src/payees/test-utils.ts',
      'backend/src/payees/a.Spec.ts', // the spec's regex has no i flag
      'frontend/src/lib/a.snapshot.ts', 'frontend/my-vitest.config.ts',
      'frontend/vitest.config.ts.bak',
    ]],
    ['near misses of the directory rules (rules 2, 3)', [
      'backend/tests/a.ts', 'backend/src/test/a.ts', 'frontend/test/a.ts',
      'frontend/src/test-utils/a.ts', 'e2e-extras/a.ts', 'docs/e2e/a.ts',
      'backend/src/test-helpers.ts', 'backend/src/test-helpers-extra/a.ts',
      'backend/src/__mocks__x/a.ts', 'backend/src/my__fixtures__/a.ts',
      'backend/src/__snapshot__/a.ts', 'backend/src/mocks/a.ts', 'backend/src/fixtures/a.ts',
    ]],
  ];

  describe('G5 row 5: what is test-related (no marker in the transcript)', () => {
    for (const [label, paths] of BLOCKED) {
      describe(`blocked: ${label}`, () => {
        for (const rel of paths) {
          it(`blocks ${rel}`, () => {
            expectBlocked(run(request(at(rel))), rel);
          });
        }
      });
    }
    for (const [label, paths] of ALLOWED) {
      describe(`allowed: ${label}`, () => {
        for (const rel of paths) {
          it(`allows ${rel}`, () => {
            expectAllowed(run(request(at(rel))), rel);
          });
        }
      });
    }
    it('the Markdown exception cuts both ways: e2e/CLAUDE.md allowed, e2e/tests/a.spec.ts blocked', () => {
      expectAllowed(run(request(at('e2e/CLAUDE.md'))));
      expectBlocked(run(request(at('e2e/tests/a.spec.ts'))), 'e2e/tests/a.spec.ts');
    });
    it('an existing test file is judged like a new one', () => {
      fs.writeFileSync(at('backend/test/existing.spec.ts'), 'export {};\n');
      expectBlocked(run(request(at('backend/test/existing.spec.ts'))), 'backend/test/existing.spec.ts');
    });
  });

  describe('G6 row 6: the skill was loaded in this session', () => {
    const attempt = (file, extra) => run(request(at(file), extra));
    const FILE = 'backend/test/payees.helper.ts'; // rule 2 only
    const BIG_LINE = userText('x'.repeat(1000));
    const FILLER = BIG_LINE.repeat(2500); // about 2.5 MB

    it('control: the same edit is blocked while the transcript holds no marker', () => {
      expectBlocked(attempt(FILE, { transcript: NO_SKILL }), FILE);
    });
    it('control: the shared with-skill transcript unlocks it', () => {
      expectAllowed(attempt(FILE, { transcript: WITH_SKILL }));
    });

    const counts = [
      ['Skill tool call', [...BASE, skillCall('reliable-tests')]],
      ['Skill tool call with args', [...BASE, skillCall('reliable-tests', { args: 'review my change' })]],
      ['Skill tool call as the only line', [skillCall('reliable-tests')]],
      ['Skill tool call on the first line', [skillCall('reliable-tests'), ...BASE]],
      ['Skill tool call on the last line, no trailing newline', [...BASE, skillCall('reliable-tests').trimEnd()]],
      ['Skill tool call after an unrelated Skill call', [skillCall('audit'), ...BASE, skillCall('reliable-tests')]],
      ['space after the colon', [raw('{"input":{"skill": "reliable-tests"}}')]],
      ['spaces around the colon', [raw('{"input":{"skill" : "reliable-tests"}}')]],
      ['tabs around the colon', [raw('{"input":{"skill"\t:\t"reliable-tests"}}')]],
      ['pretty-printed JSON', [JSON.stringify({ input: { skill: 'reliable-tests' } }, null, 2)]],
      ['slash command', [...BASE, slashCommand('reliable-tests')]],
      ['slash command with args', [...BASE, slashCommand('reliable-tests', 'fix the payees spec')]],
      ['both markers', [slashCommand('reliable-tests'), skillCall('reliable-tests')]],
      ['marker among non-JSON lines (the file is read as text)', ['garbage\n', skillCall('reliable-tests'), '{"cut": \n']],
      ['a file that is not JSON Lines at all', ['garbage {"skill":"reliable-tests"} garbage']],
    ];
    for (const [name, lines] of counts) {
      it(`counts: ${name}`, () => {
        expectAllowed(attempt(FILE, { transcript: transcript('counts', ...lines) }), name);
      });
    }

    const escapedInString = userText('Earlier the agent called {"skill":"reliable-tests"} first.');
    const doesNotCount = [
      ['empty transcript', ['']],
      ['whitespace-only transcript', ['\n\n  \n']],
      ['a transcript that is not JSON and holds no marker', ['garbage\nmore garbage\n{"broken":']],
      // JSON.stringify quotes the inner marker as \"skill\":\"reliable-tests\": not a Skill call.
      ['the escaped form inside a quoted string', [escapedInString]],
      ['the escaped form with a space after the colon', [userText('call {"skill": "reliable-tests"}')]],
      ['"skill":"reliable-tests-old"', [skillCall('reliable-tests-old')]],
      ['"skill":"reliable-test" (shorter name)', [skillCall('reliable-test')]],
      ['"skill":"reliable-testsX"', [skillCall('reliable-testsX')]],
      ['"skill":"my-reliable-tests" (longer name)', [skillCall('my-reliable-tests')]],
      ['another skill whose args name reliable-tests', [skillCall('audit', { args: 'reliable-tests' })]],
      ['key "skills" holding the name', [raw('{"skills":"reliable-tests"}')]],
      ['key "name" holding the name', [raw('{"type":"tool_use","name":"reliable-tests"}')]],
      ['key "skill_name" holding the name', [raw('{"skill_name":"reliable-tests"}')]],
      ['a bare mention in a user message', [userText('Use the reliable-tests skill before you edit tests.')]],
      ['a bare mention in an assistant message', [assistantText('I should load reliable-tests first.')]],
      ['the skill listing line', [jl({ type: 'attachment', attachment: { type: 'skill_listing', content: '- reliable-tests: Test discipline for Monize.' } })]],
      ['typed /reliable-tests without the command tags', [userText('/reliable-tests')]],
      ['command tag naming reliable-tests-old', [slashCommand('reliable-tests-old')]],
      ['command tag without the slash', [userText('<command-name>reliable-tests</command-name>')]],
      ['another command whose args name reliable-tests', [slashCommand('audit', 'reliable-tests')]],
    ];
    for (const [name, lines] of doesNotCount) {
      it(`does not count: ${name}`, () => {
        expectBlocked(attempt(FILE, { transcript: transcript('nope', ...lines) }), FILE, name);
      });
    }

    it('does not count: marker text inside the edit being made (stdin, not transcript)', () => {
      const content =
        'const a = {"skill":"reliable-tests"};\n// <command-name>/reliable-tests</command-name>\n';
      const r = attempt(FILE, {
        tool: 'Write',
        tool_input: { file_path: at(FILE), content },
      });
      expectBlocked(r, FILE);
    });

    it('reads the whole transcript: marker on the first line of 2.5 MB', () => {
      expectAllowed(attempt(FILE, { transcript: transcript('big', skillCall('reliable-tests'), FILLER) }));
    });
    it('reads the whole transcript: marker on the last line of 2.5 MB', () => {
      expectAllowed(attempt(FILE, { transcript: transcript('big', FILLER, skillCall('reliable-tests')) }));
    });
    it('reads the whole transcript: marker in the middle of 2.5 MB', () => {
      const half = BIG_LINE.repeat(1250);
      expectAllowed(attempt(FILE, { transcript: transcript('big', half, skillCall('reliable-tests'), half) }));
    });
    it('a 2.5 MB transcript without a marker still blocks', () => {
      expectBlocked(attempt(FILE, { transcript: transcript('big', FILLER) }), FILE);
    });
  });

  describe('G7 row 7: the main transcript cannot be read -> exit 1, never 2', () => {
    const cases = [
      ['transcript_path missing', MISSING],
      ['transcript_path null', null],
      ['transcript_path a number', 123],
      ['transcript_path an object', {}],
      ['transcript_path an array', [NO_SKILL]],
      ['transcript_path true', true],
      ['transcript_path an empty string', ''],
      ['file does not exist', `${TRANSCRIPTS}/does-not-exist.jsonl`],
      ['parent directory does not exist', `${TRANSCRIPTS}/no/such/dir/x.jsonl`],
      ['path is a directory', TRANSCRIPTS],
    ];
    for (const [name, tp] of cases) {
      it(name, () => {
        expectSkipped(run(request(at(TEST_FILE), { transcript: tp })), /transcript/i, name);
      });
    }
    it('a malformed but readable transcript is not "cannot be read": it blocks', () => {
      expectBlocked(run(request(at(TEST_FILE), { transcript: transcript('junk', '\u0000garbage{{{\n') })), TEST_FILE);
    });
  });

  describe('G8 row 8: block (exit 2) and the message', () => {
    const msg = (extra) => run(request(at(TEST_FILE), extra));

    it('exits 2 for a test file when the skill is not loaded, naming the repo-relative path', () => {
      expectBlocked(msg(), TEST_FILE);
    });
    it('names the resolved repo-relative path when the input was relative with ../', () => {
      const r = run(request('../test/helpers/db.ts', { cwd: `${ROOT}/backend/src` }));
      expectBlocked(r, 'backend/test/helpers/db.ts');
    });
    it('names reliable-tests and tells the agent to load it with the Skill tool or /reliable-tests', () => {
      const s = msg().stderr;
      assert.ok(s.includes('reliable-tests'), s);
      assert.ok(/\bSkill\b/.test(s) || s.includes('/reliable-tests'), s);
    });
    it('tells the agent to retry the edit afterwards', () => {
      assert.match(msg().stderr, /retry/i);
    });
    it('says that production code and documentation are not blocked', () => {
      assert.match(msg().stderr, /production code/i);
      assert.match(msg().stderr, /documentation/i);
    });
    it('is one short paragraph', () => {
      const s = msg().stderr.trim();
      assert.doesNotMatch(s, /\n\s*\n/, 'a blank line splits it into several paragraphs');
      assert.ok(s.length > 0 && s.length <= 1000, `length ${s.length}: ${s}`);
    });

    const tools = [
      ['Edit', TEST_FILE, PROD_FILE],
      ['Write', TEST_FILE, PROD_FILE],
      ['MultiEdit', TEST_FILE, PROD_FILE],
      ['NotebookEdit', 'backend/test/helpers/analysis.ipynb', 'docs/analysis.ipynb'],
    ];
    for (const [tool, testRel, prodRel] of tools) {
      it(`${tool}: blocked on a test path without the skill`, () => {
        expectBlocked(run(request(at(testRel), { tool })), testRel);
      });
      it(`${tool}: allowed on a test path once the skill is loaded`, () => {
        expectAllowed(run(request(at(testRel), { tool, transcript: WITH_SKILL })));
      });
      it(`${tool}: allowed on a production path`, () => {
        expectAllowed(run(request(at(prodRel), { tool })));
      });
      it(`${tool}: allowed outside the project`, () => {
        expectAllowed(run(request(`${OUTSIDE}/${testRel}`, { tool })));
      });
    }
  });

  describe('G9 subagents', () => {
    const ID = 'a7e3f1c9d2b84650a';
    const call = (main, id = ID, extra = {}) =>
      run(request(at(TEST_FILE), { transcript: main, agent_id: id, agent_type: 'general-purpose', ...extra }));
    const mainWith = (...extra) => transcript('main', ...BASE, ...extra);

    it('control: marker nowhere -> blocked', () => {
      const main = mainWith();
      agentTranscript(main, ID, ...BASE);
      expectBlocked(call(main), TEST_FILE);
    });
    it('marker only in the subagent own transcript -> allowed', () => {
      const main = mainWith();
      agentTranscript(main, ID, ...BASE, skillCall('reliable-tests'));
      expectAllowed(call(main));
    });
    it('slash-command marker only in the subagent own transcript -> allowed', () => {
      const main = mainWith();
      agentTranscript(main, ID, ...BASE, slashCommand('reliable-tests'));
      expectAllowed(call(main));
    });
    it('non-markers in the subagent own transcript do not count', () => {
      const main = mainWith();
      agentTranscript(main, ID, ...BASE, skillCall('reliable-tests-old'), userText('{"skill":"reliable-tests"}'));
      expectBlocked(call(main), TEST_FILE);
    });
    it('marker only in the main transcript (the parent loaded it) -> allowed', () => {
      const main = mainWith(skillCall('reliable-tests'));
      agentTranscript(main, ID, ...BASE);
      expectAllowed(call(main));
    });
    it('marker only in a sibling subagent transcript -> blocked', () => {
      const main = mainWith();
      agentTranscript(main, 'sibling1', ...BASE, skillCall('reliable-tests'));
      agentTranscript(main, ID, ...BASE);
      expectBlocked(call(main), TEST_FILE);
    });
    it('the sibling itself, with the same setup, is allowed (positive control)', () => {
      const main = mainWith();
      agentTranscript(main, 'sibling1', ...BASE, skillCall('reliable-tests'));
      agentTranscript(main, ID, ...BASE);
      expectAllowed(call(main, 'sibling1'));
    });
    it('marker only in a sibling and the own file missing -> blocked (2, not 1)', () => {
      const main = mainWith();
      agentTranscript(main, 'sibling1', ...BASE, skillCall('reliable-tests'));
      expectBlocked(call(main), TEST_FILE);
    });
    it('a main-thread call (no agent_id) never reads a subagent transcript', () => {
      const main = mainWith();
      agentTranscript(main, ID, ...BASE, skillCall('reliable-tests'));
      expectBlocked(run(request(at(TEST_FILE), { transcript: main })), TEST_FILE);
    });
    it('own file missing: the main transcript decides (a missing file is empty, not an error)', () => {
      expectAllowed(call(mainWith(skillCall('reliable-tests'))));
      expectBlocked(call(mainWith()), TEST_FILE);
    });
    it('own file is a directory (unreadable): treated as empty, not as exit 1', () => {
      const blocked = mainWith();
      const unlocked = mainWith(skillCall('reliable-tests'));
      for (const m of [blocked, unlocked]) {
        fs.mkdirSync(`${agentDir(m)}/agent-${ID}.jsonl`, { recursive: true });
      }
      expectBlocked(call(blocked), TEST_FILE);
      expectAllowed(call(unlocked));
    });
    it('a subagent call with transcript_path missing -> exit 1', () => {
      expectSkipped(run(request(at(TEST_FILE), { transcript: MISSING, agent_id: ID })), /transcript/i);
    });

    for (const id of [ID, 'Zz_9-x', 'A', '0', 'a-b_C9']) {
      it(`valid agent_id ${JSON.stringify(id)}: own marker unlocks, own file without marker does not`, () => {
        const main = mainWith();
        agentTranscript(main, id, ...BASE);
        expectBlocked(call(main, id), TEST_FILE);
        agentTranscript(main, id, ...BASE, skillCall('reliable-tests'));
        expectAllowed(call(main, id));
      });
    }

    // A hostile or malformed agent_id is ignored: no path is built from it. The decoy holds a
    // marker at the location a hook that trusted the id would read.
    const badIds = ['../../x', '../x', '../../../x', 'a/b', '/abs', 'a.b', 'a b', 'abc\n', '', '*', 'x;y', 'a%2e'];
    for (const id of badIds) {
      it(`ignores agent_id ${JSON.stringify(id)}: a decoy at the path it would build is not read`, () => {
        const main = mainWith();
        const dir = agentDir(main);
        fs.mkdirSync(`${dir}/agent-..`, { recursive: true }); // lets a literal "agent-../" resolve
        const naive = path.join(dir, `agent-${id}.jsonl`);
        fs.mkdirSync(path.dirname(naive), { recursive: true });
        fs.writeFileSync(naive, skillCall('reliable-tests'));
        expectBlocked(call(main, id), TEST_FILE);
      });
      it(`ignores agent_id ${JSON.stringify(id)}: the main transcript still decides`, () => {
        expectAllowed(call(mainWith(skillCall('reliable-tests')), id));
      });
    }
  });

  describe('G10 project root and cwd', () => {
    it('a relative path resolves against the stdin cwd, not against the project root', () => {
      expectBlocked(run(request('test/helpers/db.ts', { cwd: `${ROOT}/backend` })), TEST_FILE);
    });
    it('a relative ../ path resolves from cwd', () => {
      expectBlocked(run(request('../test/db.ts', { cwd: `${ROOT}/backend/src` })), 'backend/test/db.ts');
    });
    it('a relative ../ path can leave a test directory for production code', () => {
      expectAllowed(run(request('../src/payees/payees.service.ts', { cwd: `${ROOT}/backend/test` })));
    });
    it('relative names inside e2e: Markdown allowed, a spec blocked', () => {
      expectAllowed(run(request('CLAUDE.md', { cwd: `${ROOT}/e2e` })));
      expectBlocked(run(request('tests/a.spec.ts', { cwd: `${ROOT}/e2e` })), 'e2e/tests/a.spec.ts');
    });
    it('the hook process cwd is not used to resolve a relative path', () => {
      // Process cwd <root>/backend/test, stdin cwd <root>: the file is <root>/payees.service.ts.
      expectAllowed(run(request('payees.service.ts', { cwd: ROOT }), { spawnCwd: `${ROOT}/backend/test` }));
    });
    it('the project root is CLAUDE_PROJECT_DIR even when cwd is elsewhere', () => {
      expectBlocked(run(request(at(TEST_FILE), { cwd: OUTSIDE })), TEST_FILE);
    });
    it('a CLAUDE_PROJECT_DIR with a trailing slash names the same root', () => {
      expectBlocked(run(request(at(TEST_FILE)), { projectDir: `${ROOT}/` }), TEST_FILE);
    });
    it('without CLAUDE_PROJECT_DIR the project root is cwd', () => {
      expectBlocked(run(request(at(TEST_FILE), { cwd: ROOT }), { projectDir: null }), TEST_FILE);
      expectAllowed(run(request(`${OUTSIDE}/${TEST_FILE}`, { cwd: ROOT }), { projectDir: null }));
    });
    it('without CLAUDE_PROJECT_DIR a subdirectory cwd is the root: prefixes are judged from it', () => {
      const cwd = `${ROOT}/backend`;
      // Root is <root>/backend: e2e/x.ts starts with e2e/; test/x.ts does not start with backend/test/.
      expectBlocked(run(request(`${cwd}/e2e/x.ts`, { cwd }), { projectDir: null }), 'e2e/x.ts');
      expectAllowed(run(request(`${cwd}/test/x.ts`, { cwd }), { projectDir: null }));
      // A file in a sibling directory is outside that root.
      expectAllowed(run(request(`${ROOT}/frontend/src/test/setup.ts`, { cwd }), { projectDir: null }));
    });
  });

  describe('G11 row order: rows 2-5 decide before the transcript is touched', () => {
    const dead = [
      ['transcript_path missing', MISSING],
      ['transcript_path a directory', TRANSCRIPTS],
      ['a transcript file that does not exist', `${TRANSCRIPTS}/gone.jsonl`],
      ['transcript_path not a string', 123],
    ];
    const rows = [
      ['row 2 (Bash on a test path)', (t) => request(at(TEST_FILE), { tool: 'Bash', transcript: t, tool_input: { command: 'touch x' } })],
      ['row 3 (Edit without a path)', (t) => request(at(TEST_FILE), { transcript: t, tool_input: {} })],
      ['row 4 (test path outside the project)', (t) => request(`${OUTSIDE}/${TEST_FILE}`, { transcript: t })],
      ['row 5 (production path)', (t) => request(at(PROD_FILE), { transcript: t })],
    ];
    for (const [rowName, make] of rows) {
      for (const [deadName, t] of dead) {
        it(`${rowName} with ${deadName} -> 0`, () => {
          expectAllowed(run(make(t)), rowName);
        });
      }
    }
  });

  describe('G12 constraints', () => {
    const tree = (dir, out = {}) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        out[p] = e.isDirectory() ? 'dir' : `${fs.lstatSync(p).size}:${fs.lstatSync(p).mtimeMs}`;
        if (e.isDirectory()) tree(p, out);
      }
      return out;
    };

    it('writes no file anywhere in the fixture tree (project, transcripts, cwd, TMPDIR)', () => {
      const main = transcript('main', ...BASE);
      const scenarios = [
        [request(at(TEST_FILE), { transcript: main }), 2],
        [request(at(PROD_FILE), { transcript: main }), 0],
        [request(at(TEST_FILE), { transcript: `${TRANSCRIPTS}/missing.jsonl` }), 1],
        [request(at(TEST_FILE), { transcript: WITH_SKILL }), 0],
        [request(at(TEST_FILE), { transcript: main, agent_id: 'abc' }), 2],
        ['not json', 1],
      ];
      const before = tree(TMP);
      const codes = scenarios.map(([stdin]) => run(stdin).status);
      assert.deepEqual(codes, scenarios.map(([, code]) => code));
      assert.deepEqual(tree(TMP), before);
    });

    // A Write of a large file: stdin is far bigger than a pipe buffer and must be read to EOF.
    const bigWrite = (rel) =>
      run(request(at(rel), { tool: 'Write', tool_input: { file_path: at(rel), content: 'x'.repeat(400_000) } }));
    it('reads a 400 KB stdin to the end before deciding (blocks a test file)', () => {
      expectBlocked(bigWrite(TEST_FILE), TEST_FILE);
    });
    it('reads a 400 KB stdin to the end before deciding (allows production code)', () => {
      expectAllowed(bigWrite(PROD_FILE));
    });
    it('an unexpected internal error exits 1 and says the check was skipped, never 2', () => {
      // Fault injection: a preload makes every node:path call on this request's path throw.
      const preload = `${TMP}/fault.cjs`;
      const hit = `${TMP}/fault.hit`;
      fs.writeFileSync(
        preload,
        [
          "const p = require('node:path'), fs = require('node:fs');",
          "for (const k of ['resolve', 'relative', 'normalize', 'join', 'isAbsolute', 'dirname', 'basename']) {",
          '  const orig = p[k];',
          "  p[k] = (...a) => { if (a.some((x) => String(x).includes('__FAULT__'))) { fs.writeFileSync(process.env.RT_FAULT_HIT, '1'); throw new Error('injected'); } return orig(...a); };",
          '}',
        ].join('\n'),
      );
      const NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ''} --require "${preload}"`;
      const r = run(request(at('backend/test/__FAULT__.ts')), { env: { NODE_OPTIONS, RT_FAULT_HIT: hit } });
      assert.ok(fs.existsSync(hit), 'the fault never fired: the hook did not call node:path on the path');
      expectSkipped(r, /injected|error/i);
    });

    it('source constraints from the spec: ASCII only, under 120 lines, built-in imports only', () => {
      const src = fs.readFileSync(HOOK, 'utf8');
      assert.doesNotMatch(src, /[^\x00-\x7f]/, 'the spec requires ASCII only');
      assert.ok(src.trimEnd().split('\n').length < 120, 'the spec requires under 120 lines');
      for (const [, mod] of src.matchAll(/(?:from|import\()\s*['"]([^'"]+)['"]/g)) {
        assert.ok(['node:fs', 'node:path', 'node:process'].includes(mod), `not a permitted import: ${mod}`);
      }
    });
  });
});
