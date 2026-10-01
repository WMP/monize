#!/usr/bin/env node
/**
 * mutation-probe.mjs - targeted mutation testing in an isolated git worktree.
 *
 * Applies ONE deliberate defect to a production file in a throwaway copy of the working tree, runs
 * the tests that should catch it and classifies the result, so a test is shown to fail for the
 * right reason.
 *
 * Usage (inside the repository; POSIX, Node >= 20, no dependencies):
 *   node .claude/skills/reliable-tests/scripts/mutation-probe.mjs \
 *     --file <repo-relative file> --find <exact text> --replace <text> \
 *     --cwd <repo-relative dir to run in> --runner <jest|vitest> \
 *     [--keep] [--timeout-ms <n>] -- <test command and arguments...>
 *   --find is a literal (not a regex) and must occur exactly once in --file. The runner's JSON
 *   flags are appended to the command (after a "--" for npm): name the tests, never a reporter.
 *   Example command: npm run test:unit -- src/common/x.spec.ts
 *
 * Guarantees:
 *   - The probe never writes to the main checkout: the mutation goes into a detached worktree under
 *     the OS temp dir, overlaid with your uncommitted work. The target file's hash and `git status`
 *     are compared before and after, and a difference is reported loudly. (A runner cache inside
 *     the symlinked node_modules, such as node_modules/.vite, is the one write it cannot prevent.)
 *   - The unmutated baseline must be green and execute tests, or nothing is mutated.
 *   - A compile or import error, a timeout, a missing report, no executed test or fewer tests than
 *     the baseline is INVALID, never KILLED.
 *   - The worktree is removed on exit and on SIGINT/SIGTERM/SIGHUP unless --keep is given.
 *
 * Limits: only tracked and untracked-but-not-ignored files are mirrored (plus node_modules by
 * symlink), so a .env or build output is absent; a signal during the ~1 s worktree setup is acted
 * on when it ends; SIGKILL of the probe leaves the worktree (its removal command is printed first).
 *
 * Exit codes: 0 KILLED, 1 SURVIVED, 2 usage or setup error, 3 BASELINE-RED, 4 INVALID, 128+n when
 * interrupted by signal n. The last stdout line is always `MUTATION-PROBE RESULT=<...> key=value`
 * (not for --help).
 */
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const OPTIONS = {
  "--file": "file", "--find": "find", "--replace": "replace", "--cwd": "cwd",
  "--runner": "runner", "--timeout-ms": "timeoutMs",
};
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[ -/]*[@-~]`, "g");
const EXCEPTION = /^(TypeError|ReferenceError|SyntaxError|RangeError)\b/;
const out = console.log;
const err = console.error;

/** Shared with the signal handler, which has to clean up from wherever the run is. */
const state = {
  repoRoot: "", file: "", fileAbs: "", cwd: "", before: null,
  keep: false, tmp: "", wt: "", links: [], child: null,
};

class SetupError extends Error {}
function fail(message) {
  throw new SetupError(message);
}
const clean = (text) => String(text ?? "").replace(ANSI, "");
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const removal = (wt) => `git -C ${state.repoRoot} worktree remove --force ${wt}`;
const helpText = () => fs.readFileSync(new URL(import.meta.url), "utf8")
  .match(/\/\*\*([\s\S]*?)\*\//)[1].replace(/^ \* ?/gm, "").trim();

function parseArgs(argv) {
  const o = { keep: false, help: false, timeoutMs: "900000", command: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") {
      o.command = argv.slice(i + 1);
      break;
    }
    if (arg === "--help") o.help = true;
    else if (arg === "--keep") o.keep = true;
    else if (!Object.hasOwn(OPTIONS, arg)) fail(`unknown argument: ${arg}`);
    else if (i + 1 >= argv.length) fail(`${arg} needs a value`);
    else o[OPTIONS[arg]] = argv[++i];
  }
  if (o.help) return o;
  for (const key of ["file", "find", "replace", "cwd", "runner"]) {
    if (o[key] === undefined) fail(`missing --${key} (see --help)`);
  }
  if (o.find === "") fail("--find must not be empty");
  if (o.find === o.replace) fail("--replace must differ from --find");
  if (!["jest", "vitest"].includes(o.runner)) fail("--runner must be jest or vitest");
  o.timeoutMs = Number(o.timeoutMs);
  if (!Number.isInteger(o.timeoutMs) || o.timeoutMs < 1 || o.timeoutMs > 2 ** 31 - 1) {
    fail("--timeout-ms must be an integer from 1 to 2147483647");
  }
  if (o.command.length === 0) fail("missing the test command after --");
  return o;
}

function git(cwd, args) {
  const env = { ...process.env, GIT_OPTIONAL_LOCKS: "0" };
  const r = spawnSync("git", args, { cwd, env, encoding: "utf8", maxBuffer: 1 << 28 });
  // git shares our process group, so a Ctrl-C reaches it too: its death is our interruption.
  if (r.signal) onSignal(r.signal);
  if (r.status !== 0) {
    fail(`git ${args.join(" ")} failed: ${(r.stderr || r.error?.message || "").trim()}`);
  }
  return r.stdout;
}

function inside(base, target) {
  const rel = path.relative(base, target);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

/** The real path of a repo-relative file or directory, which must exist and stay in the repo. */
function resolveInRepo(rel, kind) {
  let real;
  try {
    real = fs.realpathSync(path.resolve(state.repoRoot, rel));
  } catch {
    fail(`--${kind} does not exist: ${rel}`);
  }
  if (!inside(state.repoRoot, real)) fail(`--${kind} resolves outside the repository: ${rel}`);
  const stat = fs.statSync(real);
  if (kind === "file" ? !stat.isFile() : !stat.isDirectory()) fail(`--${kind} has the wrong type: ${rel}`);
  return real;
}

function countHits(buf, needle) {
  let hits = 0;
  for (let at = buf.indexOf(needle); at >= 0; at = buf.indexOf(needle, at + needle.length)) hits++;
  return hits;
}

/** What "the main checkout is unchanged" means: the target file's hash and `git status`. */
function fingerprint() {
  const hash = fs.existsSync(state.fileAbs) ? sha256(fs.readFileSync(state.fileAbs)) : "missing";
  const status = git(state.repoRoot, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  return { hash, status };
}

function mainCheckoutChanged() {
  if (!state.before) return false;
  const now = fingerprint();
  const was = new Set(state.before.status.split("\0"));
  const is = new Set(now.status.split("\0"));
  const diff = [
    ...[...is].filter((e) => !was.has(e)).map((e) => `+ ${e}`),
    ...[...was].filter((e) => !is.has(e)).map((e) => `- ${e}`),
  ];
  const hashChanged = now.hash !== state.before.hash;
  if (!hashChanged && diff.length === 0) return false;
  err("WARNING: the main checkout changed while the probe ran. The probe never writes there, so\n" +
    "something else did (an editor, another agent, a test side effect). Check `git status` before\n" +
    "trusting this result.");
  if (hashChanged) err(`  ${state.file} has a different sha256 now`);
  for (const entry of diff.slice(0, 10)) err(`  git status entry ${entry}`);
  return true;
}

function createWorktree() {
  state.tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "mutation-probe-"));
  const wt = path.join(state.tmp, "wt");
  // No hooks: a post-checkout hook of the user's must not run for a throwaway copy.
  const add = ["-c", "core.hooksPath=/dev/null", "worktree", "add", "--detach", "--quiet", wt, "HEAD"];
  git(state.repoRoot, add);
  state.wt = wt;
  out(`worktree: ${wt}`);
  out(`if this process is killed, remove it with: ${removal(wt)}`);
}

/** Make the worktree match the working tree: changed, deleted and untracked paths. */
function overlay() {
  const list = (args) => git(state.repoRoot, args).split("\0").filter(Boolean);
  const paths = [
    ...list(["diff", "--name-only", "--no-renames", "-z", "HEAD"]),
    ...list(["ls-files", "--others", "--exclude-standard", "-z"]),
  ];
  for (const rel of paths) {
    const src = path.join(state.repoRoot, rel);
    const dst = path.join(state.wt, rel);
    const stat = fs.lstatSync(src, { throwIfNoEntry: false });
    if (stat?.isDirectory()) continue;
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    // A tracked symlink must never carry a write out of the worktree.
    if (!inside(state.wt, fs.realpathSync(path.dirname(dst)))) {
      fail(`refusing to write outside the worktree: ${rel}`);
    }
    fs.rmSync(dst, { recursive: true, force: true });
    if (stat?.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(src), dst);
    else if (stat?.isFile()) fs.copyFileSync(src, dst);
  }
  return paths.length;
}

function linkDeps() {
  for (const rel of new Set([state.cwd, ""])) {
    const src = path.join(state.repoRoot, rel, "node_modules");
    if (!fs.existsSync(src)) {
      if (rel === state.cwd) fail(`${src} is missing: run npm ci in ${state.cwd || "."} first`);
      continue;
    }
    const dst = path.join(state.wt, rel, "node_modules");
    fs.rmSync(dst, { recursive: true, force: true });
    fs.symlinkSync(src, dst, "dir");
    state.links.push(dst);
  }
}

function cleanup() {
  const { repoRoot, tmp, wt, links, keep } = state;
  if (!tmp) return;
  state.tmp = "";
  if (keep && wt) {
    out(`kept: ${wt} (logs and reports are in ${tmp})`);
    out(`remove with: ${removal(wt)} && rm -rf ${tmp} && git -C ${repoRoot} worktree prune`);
    return;
  }
  const steps = [
    // Without `recursive`, rmSync only ever unlinks a symlink: no remover can walk into the shared
    // node_modules, which is why this runs before the real removal.
    () => links.forEach((link) => fs.rmSync(link, { force: true })),
    () => wt && git(repoRoot, ["worktree", "remove", "--force", wt]),
    () => fs.rmSync(tmp, { recursive: true, force: true }),
    () => git(repoRoot, ["worktree", "prune"]),
  ];
  let ok = true;
  for (const step of steps) {
    try {
      step();
    } catch (error) {
      ok = false;
      err(`cleanup problem: ${error.message}`);
    }
  }
  if (ok) out("cleanup: done");
}

function killGroup(child) {
  try {
    if (child?.pid) process.kill(-child.pid, "SIGKILL");
  } catch {
    // The group is already gone.
  }
}

/** No shell, output straight to a log file, own process group so one kill takes the whole tree. */
function spawnLogged(argv, cwd, logFile, timeoutMs) {
  return new Promise((resolve) => {
    const fd = fs.openSync(logFile, "w");
    const env = { ...process.env, TZ: process.env.TZ ?? "UTC" };
    const child = spawn(argv[0], argv.slice(1), { cwd, env, stdio: ["ignore", fd, fd], detached: true });
    fs.closeSync(fd);
    state.child = child;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup(child);
    }, timeoutMs);
    const done = (result) => {
      clearTimeout(timer);
      state.child = null;
      resolve(result);
    };
    child.on("error", (error) => done({ error }));
    child.on("close", (status, signal) => done({ status, signal, timedOut }));
  });
}

function buildCommand(o, jsonFile) {
  const flags = [o.runner === "jest" ? "--json" : "--reporter=json", `--outputFile=${jsonFile}`];
  // npm swallows flags that do not come after a standalone "--".
  const needsSeparator = path.basename(o.command[0]) === "npm" && !o.command.includes("--");
  return [...o.command, ...(needsSeparator ? ["--"] : []), ...flags];
}

/** Jest and Vitest both write Jest-shaped JSON; anything else counts as no report. */
function loadReport(jsonFile) {
  let report;
  try {
    report = JSON.parse(fs.readFileSync(jsonFile, "utf8"));
  } catch {
    return { ok: false, why: "no readable JSON report was written" };
  }
  if (!Number.isInteger(report?.numTotalTests) || !Array.isArray(report.testResults)) {
    return { ok: false, why: "the JSON report has an unexpected shape" };
  }
  const suites = report.testResults;
  const failedIn = (s) => (s.assertionResults ?? []).filter((t) => t.status === "failed");
  const failures = suites.flatMap((s) => failedIn(s).map((t) => ({ ...t, suite: s.name })));
  const broken = suites.filter(
    (s) => s.testExecError || (s.status === "failed" && failedIn(s).length === 0),
  );
  return {
    ok: true,
    total: report.numTotalTests,
    passed: report.numPassedTests ?? 0,
    failed: report.numFailedTests ?? failures.length,
    suiteErrors: Math.max(report.numRuntimeErrorTestSuites ?? 0, broken.length),
    failures,
    broken,
  };
}

async function execute(label, o) {
  const jsonFile = path.join(state.tmp, `${label}.json`);
  const logFile = path.join(state.tmp, `${label}.log`);
  const argv = buildCommand(o, jsonFile);
  out(`[${label}] in ${state.cwd || "."}: ${argv.join(" ")}`);
  const started = Date.now();
  const res = await spawnLogged(argv, path.join(state.wt, state.cwd), logFile, o.timeoutMs);
  if (res.error) fail(`could not start the command: ${res.error.message}`);
  const r = { label, logFile, ...res, ...loadReport(jsonFile) };
  const counts = r.ok ? `${r.total} tests, ${r.failed} failed` : "no usable report";
  out(`[${label}] ${counts}, exit ${r.status ?? r.signal}, ${((Date.now() - started) / 1000).toFixed(1)}s`);
  return r;
}

/** Why a run proves nothing, as [token, text] pairs. `base` is the baseline run (null for itself). */
function problems(r, base) {
  const list = [];
  if (r.timedOut) {
    list.push(["timeout", "exceeded --timeout-ms and was killed (a mutant that never terminates lands here too)"]);
  }
  if (!r.ok) {
    list.push(["no_report", r.why]);
    return list;
  }
  if (r.suiteErrors > 0) {
    const text = `${r.suiteErrors} suite(s) failed to load or run (a compile or import error is not detection)`;
    list.push(["suite_error", text]);
  }
  if (r.total === 0 || r.passed + r.failed === 0) list.push(["no_tests", "no test was executed"]);
  else if (base && r.total < base.total) list.push(["fewer_tests", `${r.total} tests, the baseline had ${base.total}`]);
  if (!base && r.failed > 0) list.push(["failing", `${r.failed} test(s) already fail`]);
  return list;
}

const reasons = (list) => list.map(([token]) => token).join(",");
const suiteName = (name) => path.relative(state.wt, path.resolve(state.wt, String(name ?? "")));
const firstLine = (t) => clean(t.failureMessages?.[0])
  .split("\n").map((l) => l.trim()).find(Boolean) ?? "(no failure message)";

function showFailures(r, limit) {
  for (const t of r.failures.slice(0, limit)) {
    const line = firstLine(t);
    const name = t.fullName ?? [...(t.ancestorTitles ?? []), t.title].join(" ");
    out(`  - ${suiteName(t.suite)} :: ${name}`);
    out(`      ${line.slice(0, 200)}${EXCEPTION.test(line) ? " [exception]" : ""}`);
  }
  if (r.failures.length > limit) out(`  ... and ${r.failures.length - limit} more`);
}

function describeRun(r, list) {
  for (const [token, text] of list) out(`  ${token}: ${text}`);
  if (r.ok) {
    out(`  counts: total=${r.total} passed=${r.passed} failed=${r.failed} suite_errors=${r.suiteErrors}`);
    showFailures(r, 10);
    for (const s of r.broken.slice(0, 3)) {
      out(`  suite error in ${suiteName(s.name)}:`);
      const text = clean(s.message || s.testExecError?.message);
      for (const l of text.split("\n").filter((x) => x.trim()).slice(0, 8)) out(`    ${l.trimEnd()}`);
    }
  }
  // Only the end of the log: a runaway mutant can write gigabytes.
  const size = fs.statSync(r.logFile).size;
  const buf = Buffer.alloc(Math.min(size, 1 << 18));
  const fd = fs.openSync(r.logFile, "r");
  fs.readSync(fd, buf, 0, buf.length, size - buf.length);
  fs.closeSync(fd);
  out(`  --- last 40 lines of ${r.logFile}`);
  for (const l of clean(buf.toString("utf8")).trimEnd().split("\n").slice(-40)) out(`  | ${l}`);
}

function mutate(target, o) {
  // The only write to a source file this script ever makes: it must land inside the worktree.
  if (!inside(state.wt, fs.realpathSync(target))) fail("refusing to mutate a file outside the worktree");
  const source = fs.readFileSync(target);
  const needle = Buffer.from(o.find);
  const at = source.indexOf(needle);
  const mutated = [source.subarray(0, at), Buffer.from(o.replace), source.subarray(at + needle.length)];
  fs.writeFileSync(target, Buffer.concat(mutated));
  if (fs.readFileSync(target).equals(source)) fail("the mutation did not change the file");
  const line = source.subarray(0, at).toString("utf8").split("\n").length;
  out(`mutation: ${state.file}:${line}  ${JSON.stringify(o.find)}  ->  ${JSON.stringify(o.replace)}`);
}

async function probe(o) {
  createWorktree();
  out(`overlay: ${overlay()} uncommitted path(s) mirrored into the worktree`);
  linkDeps();
  const target = path.join(state.wt, state.file);
  if (!fs.existsSync(target) || sha256(fs.readFileSync(target)) !== state.before.hash) {
    fail(`the worktree copy of ${state.file} differs from yours (is it git-ignored?)`);
  }

  const base = await execute("baseline", o);
  const baseProblems = problems(base, null);
  if (baseProblems.length > 0) {
    out("BASELINE-RED: the unmutated code is not green, so no mutation was applied.");
    describeRun(base, baseProblems);
    const fields = { baseline_tests: base.total ?? 0, failed: base.failed ?? 0, reason: reasons(baseProblems) };
    return { code: 3, result: "BASELINE-RED", fields };
  }

  mutate(target, o);
  const mut = await execute("mutant", o);
  const invalid = problems(mut, base);
  const fields = { baseline_tests: base.total, mutant_tests: mut.total ?? 0, failed: mut.failed ?? 0 };
  if (invalid.length > 0) {
    out("INVALID: this run proves nothing (a compile or import error, a timeout or a lost test is not detection).");
    describeRun(mut, invalid);
    return { code: 4, result: "INVALID", fields: { ...fields, reason: reasons(invalid) } };
  }
  if (mut.failed > 0) {
    out(`KILLED: ${mut.failed} of ${mut.total} test(s) failed on the mutant (baseline: ${base.total}, none failing).`);
    showFailures(mut, 50);
    if (mut.failures.some((t) => EXCEPTION.test(firstLine(t)))) {
      out("Killed by an exception rather than an assertion: confirm this is the behaviour the test is meant to catch.");
    }
    return { code: 0, result: "KILLED", fields };
  }
  out("SURVIVED: No test failed. Classify: real gap (add a case), equivalent mutant, outside the contract,");
  out("or tool problem.");
  if (mut.status !== 0) {
    out(`note: the command exited with ${mut.status ?? mut.signal} although no test failed; read ${mut.logFile}`);
  }
  return { code: 1, result: "SURVIVED", fields };
}

function resultLine(verdict, changed) {
  const file = state.file && { file: state.file };
  const fields = { ...file, ...verdict.fields, ...(changed && { main_checkout: "CHANGED" }) };
  const pairs = Object.entries(fields).map(([k, v]) => `${k}=${v}`);
  return ["MUTATION-PROBE", `RESULT=${verdict.result}`, ...pairs].join(" ");
}

function onSignal(sig) {
  killGroup(state.child);
  err(`${sig} received: stopping the run and cleaning up`);
  cleanup();
  const changed = mainCheckoutChanged();
  out(resultLine({ result: "INTERRUPTED", fields: { signal: sig } }, changed));
  process.exit(128 + os.constants.signals[sig]);
}

async function main() {
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => onSignal(sig));
  let verdict = { code: 2, result: "ERROR", fields: {} };
  try {
    const o = parseArgs(process.argv.slice(2));
    if (o.help) {
      out(helpText());
      return 0;
    }
    state.keep = o.keep;
    state.repoRoot = fs.realpathSync(git(process.cwd(), ["rev-parse", "--show-toplevel"]).trim());
    state.fileAbs = resolveInRepo(o.file, "file");
    state.file = path.relative(state.repoRoot, state.fileAbs);
    state.cwd = path.relative(state.repoRoot, resolveInRepo(o.cwd, "cwd"));
    const hits = countHits(fs.readFileSync(state.fileAbs), Buffer.from(o.find));
    if (hits !== 1) {
      const hint = hits === 0 ? "Check the text, including whitespace." : "Include more surrounding text to make it unique.";
      fail(`--find occurs ${hits} time(s) in ${state.file}, not exactly once. ${hint}`);
    }
    state.before = fingerprint();
    verdict = await probe(o);
  } catch (error) {
    err(error instanceof SetupError ? `error: ${error.message}` : `unexpected failure: ${error.stack}`);
  } finally {
    cleanup();
  }
  const changed = mainCheckoutChanged();
  out(resultLine(verdict, changed));
  return verdict.code;
}

process.exitCode = await main();
