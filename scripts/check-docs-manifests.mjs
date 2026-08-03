#!/usr/bin/env node
// Verify the setup and deployment documentation describes files that exist and
// defaults that match the manifests.
//
// The root README told readers to run `docker-compose up -d` against a
// `docker-compose.yml` this repository has never contained, and `helm/README.md`
// installed `./helm/monize` when the chart root is `helm/` -- so the documented
// happy path failed before the application started, in both cases. The Helm
// default-value tables had drifted too: registry, repository, pull policy and
// the backend memory limit all disagreed with `helm/values.yaml`, while the
// templates render the real values.
//
// Prose cannot be type-checked, so this is the check. Three rules:
//
//   1. every repository path a documented command names must exist;
//   2. no documented `docker compose` command may omit `-f`, because there is no
//      default Compose file to fall back on;
//   3. every Helm parameter documented with a default must have that default in
//      helm/values.yaml.
//
// Exits non-zero with the offending lines. Requires nothing but Node.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

const REPO_ROOT = new URL('..', import.meta.url).pathname;

/** Documents whose commands and tables are treated as canonical instructions. */
const DOCS = [
  'README.md',
  'CONTRIBUTING.md',
  'CLAUDE.md',
  'helm/README.md',
  'database/CLAUDE.md',
  'backend/CLAUDE.md',
  'frontend/CLAUDE.md',
  'CONTAINER_BUILD.md',
];

const failures = [];

function fail(file, line, message) {
  failures.push(`${file}${line ? `:${line}` : ''}  ${message}`);
}

function readDoc(relative) {
  const full = join(REPO_ROOT, relative);
  return existsSync(full) ? readFileSync(full, 'utf8').split('\n') : null;
}

// ---------------------------------------------------------------------------
// Rule 1 + 2: paths and Compose invocations in documented commands
// ---------------------------------------------------------------------------

// A `-f <file>` on a docker compose command.
const COMPOSE_WITH_FILE = /docker[- ]compose\s+(?:[^\n]*?\s)?-f\s+([\w./-]+)/g;
// A docker compose command with no -f anywhere before the subcommand.
const COMPOSE_WITHOUT_FILE = /docker[- ]compose\s+(?!.*-f\s)(up|down|build|exec|run|logs|ps|config)\b/;
// A compose filename mentioned anywhere, including inside a directory tree.
const COMPOSE_FILENAME = /\bdocker-compose[\w.-]*\.ya?ml\b/g;
// `helm <verb> ... ./path` -- the chart directory.
const HELM_CHART = /helm\s+(?:install|upgrade|template|lint)\s+[^\n]*?(\.\/[\w./-]+)/g;

function checkCommands(relative, lines) {
  lines.forEach((text, index) => {
    const lineNumber = index + 1;

    for (const [, file] of text.matchAll(COMPOSE_WITH_FILE)) {
      if (!existsSync(join(REPO_ROOT, file))) {
        fail(relative, lineNumber, `compose file does not exist: ${file}`);
      }
    }

    if (COMPOSE_WITHOUT_FILE.test(text)) {
      fail(
        relative,
        lineNumber,
        'docker compose without -f: this repository has no default docker-compose.yml',
      );
    }

    for (const [name] of text.matchAll(COMPOSE_FILENAME)) {
      if (!existsSync(join(REPO_ROOT, name))) {
        fail(relative, lineNumber, `compose file does not exist: ${name}`);
      }
    }

    for (const [, chart] of text.matchAll(HELM_CHART)) {
      const path = join(REPO_ROOT, chart);
      if (!existsSync(join(path, 'Chart.yaml'))) {
        fail(
          relative,
          lineNumber,
          `not a Helm chart root (no Chart.yaml): ${chart}`,
        );
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Rule 3: documented Helm defaults against helm/values.yaml
// ---------------------------------------------------------------------------

/**
 * Minimal reader for the subset of YAML `helm/values.yaml` uses: nested plain
 * mappings, scalar values, `{}`, and comments. Deliberately not a YAML parser --
 * pulling one in would mean a dependency for a check that must run anywhere, and
 * the file is committed in this shape. Returns a flat map of dotted path to raw
 * scalar text; a key whose value is a nested mapping, a list or `{}` is absent,
 * so a documented row pointing at one is skipped rather than misjudged.
 */
function flattenValues(source) {
  const flat = new Map();
  /** @type {Array<{ indent: number, key: string }>} */
  const stack = [];

  for (const raw of source.split('\n')) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    if (raw.trim().startsWith('- ')) continue; // list item: not addressable here

    const match = /^(\s*)([\w.-]+):\s*(.*?)\s*(?:#.*)?$/.exec(raw);
    if (!match) continue;

    const [, indentText, key, value] = match;
    const indent = indentText.length;

    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    stack.push({ indent, key });

    if (value !== '' && value !== '{}' && value !== '[]' && value !== '|') {
      flat.set(
        stack.map((entry) => entry.key).join('.'),
        value.replace(/^["']|["']$/g, ''),
      );
    }
  }

  return flat;
}

// `| `backend.image.tag` | Image tag | `latest` |`
const DEFAULTS_ROW = /^\|\s*`([\w.*-]+)`\s*\|[^|]*\|\s*`([^`|]+)`\s*\|/;

function checkHelmDefaults(relative, lines, values) {
  lines.forEach((text, index) => {
    const match = DEFAULTS_ROW.exec(text);
    if (!match) return;

    const [, path, documented] = match;
    // Rows documenting a whole subtree ("See values.yaml") or a wildcard
    // (`backend.env.*`) address no single scalar.
    if (path.includes('*')) return;
    if (!values.has(path)) return;

    const actual = values.get(path);
    // An empty value in values.yaml means the effective default is derived in a
    // template (`global.hostname: ""` becomes `monize.<domain>`), and the table
    // documents that derivation rather than the literal. Comparing them would
    // fail on correct documentation.
    if (actual === '') return;
    if (actual !== documented) {
      fail(
        relative,
        index + 1,
        `${path} documented as \`${documented}\` but helm/values.yaml has \`${actual}\``,
      );
    }
  });
}

// ---------------------------------------------------------------------------
// Rule 4: every Compose stack in the tree is listed in the README's tree
// ---------------------------------------------------------------------------

function checkComposeInventory() {
  const onDisk = readdirSync(REPO_ROOT)
    .filter((name) => /^docker-compose[\w.-]*\.ya?ml$/.test(name))
    .sort();
  const readme = readFileSync(join(REPO_ROOT, 'README.md'), 'utf8');
  const missing = onDisk.filter((name) => !readme.includes(name));
  if (missing.length) {
    fail(
      'README.md',
      null,
      `Compose stacks present but undocumented: ${missing.join(', ')}`,
    );
  }
}

// ---------------------------------------------------------------------------

const valuesPath = join(REPO_ROOT, 'helm/values.yaml');
const values = existsSync(valuesPath)
  ? flattenValues(readFileSync(valuesPath, 'utf8'))
  : new Map();

if (values.size === 0) {
  fail('helm/values.yaml', null, 'no values parsed -- the defaults check would be vacuous');
}

for (const relative of DOCS) {
  const lines = readDoc(relative);
  if (!lines) continue;
  checkCommands(relative, lines);
  if (dirname(relative) === 'helm') checkHelmDefaults(relative, lines, values);
}

checkComposeInventory();

if (failures.length) {
  console.error('Documentation/manifest drift:\n');
  for (const failure of failures) console.error(`  ${failure}`);
  console.error(
    '\nEvery documented path must exist and every documented Helm default must' +
      '\nmatch helm/values.yaml. See scripts/check-docs-manifests.mjs.',
  );
  process.exit(1);
}

console.log(
  `Documentation/manifest check: OK (${values.size} Helm values, ${DOCS.length} documents)`,
);
