#!/usr/bin/env node
// PreToolUse hook for Edit|Write|MultiEdit|NotebookEdit: refuses an edit to a test file, a test
// helper or a test-runner config until this session has loaded the `reliable-tests` skill
// (.claude/skills/reliable-tests/SKILL.md). A guard rail for Claude Code agents, not a boundary.
//
// Input: Claude Code PreToolUse JSON on stdin: tool_name, tool_input.file_path (notebook_path for
//   NotebookEdit), transcript_path (the MAIN session transcript), cwd, and agent_id (only for a
//   call made inside a subagent). Project root: CLAUDE_PROJECT_DIR, else cwd. Writes no file and
//   prints nothing on exit 0.
// Skill loaded: the main transcript, or for a subagent call that subagent's own transcript
//   (<transcript_path minus .jsonl>/subagents/agent-<agent_id>.jsonl), holds a Skill tool call
//   for reliable-tests or a /reliable-tests slash-command marker. Sibling subagents are not read.
// Exit codes: 0 allow. 2 block, stderr explains. 1 the hook could not evaluate (stdin is not a
//   JSON object, or the main transcript cannot be read): the edit is allowed and stderr says the
//   check was skipped. A failure of the hook itself never exits 2.
// Limits: an edit made through Bash is not seen; symlinks are not resolved; transcripts are
//   matched as text, so a quoted slash-command marker passes; other agents run no Claude hooks.
import { readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import process from 'node:process';

const TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const TEST_DIRS = ['backend/test/', 'backend/src/test-helpers/', 'frontend/src/test/', 'e2e/'];
const FIXTURE_SEGMENTS = ['__fixtures__', '__mocks__', '__snapshots__'];
const SKILL_CALL = /"skill"\s*:\s*"reliable-tests"/;
const SLASH_COMMAND = /<command-name>\/reliable-tests<\/command-name>/;

// repoPath uses forward slashes and is relative to the project root.
function isTestRelated(repoPath) {
  const segments = repoPath.split('/');
  const name = segments[segments.length - 1];
  if (/\.md$/i.test(name)) return false;
  return (
    /(^|[.-])(spec|test)\.[cm]?[jt]sx?$/.test(name) ||
    TEST_DIRS.some((dir) => repoPath.startsWith(dir)) ||
    segments.slice(0, -1).some((segment) => FIXTURE_SEGMENTS.includes(segment)) ||
    name.endsWith('.snap') ||
    /^(vitest|jest|playwright)[.\w-]*\.config\.[cm]?[jt]s$/.test(name)
  );
}

// File text, or null when it cannot be read (missing, a directory, no permission).
function readText(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

const skillLoaded = (text) => text !== null && (SKILL_CALL.test(text) || SLASH_COMMAND.test(text));
const skipped = (why) => ({ code: 1, msg: `require-reliable-tests: check skipped, ${why}.` });

function decide(raw) {
  let input = null;
  try {
    input = JSON.parse(raw);
  } catch {
    input = null; // reported below, together with valid JSON that is not an object
  }
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return skipped('stdin is not a JSON object');
  }
  const { tool_name: tool, tool_input: args } = input;
  const { transcript_path: transcript, agent_id: agentId } = input;
  if (!TOOLS.has(tool)) return { code: 0 };
  const key = tool === 'NotebookEdit' ? 'notebook_path' : 'file_path';
  const file = args !== null && typeof args === 'object' ? args[key] : null;
  if (typeof file !== 'string' || file === '') return { code: 0 };

  const cwd = typeof input.cwd === 'string' && input.cwd !== '' ? input.cwd : process.cwd();
  const root = resolve(process.env.CLAUDE_PROJECT_DIR || cwd);
  const rel = relative(root, resolve(cwd, file));
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return { code: 0 };
  const repoPath = rel.split(sep).join('/');
  if (!isTestRelated(repoPath)) return { code: 0 };

  // Row 6 before row 7: a marker found in any readable transcript allows the edit.
  const hasTranscript = typeof transcript === 'string' && transcript !== '';
  const main = hasTranscript ? readText(transcript) : null;
  const validAgent = typeof agentId === 'string' && /^[A-Za-z0-9_-]+$/.test(agentId);
  const sub = hasTranscript && validAgent
    ? readText(join(transcript.replace(/\.jsonl$/, ''), 'subagents', `agent-${agentId}.jsonl`))
    : null;
  if (skillLoaded(main) || skillLoaded(sub)) return { code: 0 };
  if (main === null) {
    const which = hasTranscript ? transcript : 'transcript_path is missing';
    return skipped(`cannot read the session transcript (${which})`);
  }
  return {
    code: 2,
    msg:
      `Blocked by the require-reliable-tests hook: ${repoPath} is a test file, test helper or ` +
      'test-runner config, and the reliable-tests skill has not been loaded in this session. ' +
      'Call the Skill tool with skill "reliable-tests" (or type /reliable-tests), follow it, ' +
      'then retry the edit. Production code and documentation are not blocked.',
  };
}

try {
  process.stdin.setEncoding('utf8');
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  const { code, msg } = decide(raw);
  if (msg) process.stderr.write(`${msg}\n`);
  process.exitCode = code;
} catch (err) {
  const reason = `unexpected error: ${err?.message ?? err}`;
  process.stderr.write(`require-reliable-tests: check skipped, ${reason}\n`);
  process.exitCode = 1;
}
