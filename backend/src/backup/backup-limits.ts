import { readFileSync } from "fs";

/**
 * Size ceilings for the backup paths that hold a whole payload in memory.
 *
 * Three of them, for three different failure modes.
 *
 * **The compressed upload** (`BACKUP_RESTORE_LIMIT`, `resolveRestoreUploadLimitBytes`).
 * `express.raw` buffers the whole body onto the heap *before* the controller, the
 * guards, the authentication lookup and every service-level ceiling, so this is
 * the only limit that can refuse a request none of those layers ever sees. It
 * defaulted to the literal `"500mb"` in `main.ts` on a pod the chart limits to
 * 400 MiB.
 *
 * **Restore decompression** (`BACKUP_RESTORE_EXPANDED_LIMIT`). Capping the
 * compressed upload bounds nothing about what comes out of gzip: a few hundred
 * kilobytes of repeated text expands to gigabytes, and `gunzipSync` with no
 * `maxOutputLength` allocated all of it -- before the version check, before the
 * format check, before anything that could refuse the request. On a single replica
 * that is every user's backend.
 *
 * **Buffered export** (`BACKUP_EXPORT_BUFFER_LIMIT`). The encrypted, automatic and
 * support export paths cannot stream: GCM needs the whole plaintext to compute its
 * auth tag, and the support export has to hold every table at once to reconcile
 * scaled balances. They accumulate rows, base64 attachment bytes, JSON strings and
 * a gzip buffer.
 *
 * ## A ceiling above the process limit is not a ceiling
 *
 * These defaults were fixed numbers -- 512 MiB of export JSON, 1 GiB of expanded
 * restore -- while the Helm chart's default backend limit is 400 MiB. So neither
 * one could ever fire: the pod was OOM-killed first, which is the outcome the
 * ceilings existed to prevent. The comment here even named the 400 MiB figure
 * while the constant below it said 512.
 *
 * Two things follow, and both are needed:
 *
 *  1. **Derive the default from the process's real memory limit**, read from the
 *     cgroup, rather than guessing a number that happens to suit one deployment.
 *     A ceiling has to be smaller than the thing it protects, and only the
 *     container knows how big that is.
 *  2. **Budget for the peak, not the payload.** A JSON payload of N bytes does
 *     not cost N. At the worst moment the per-table strings, the concatenated
 *     buffer, the gzip output and the parsed object graph are all live, so the
 *     limit is a fraction of available memory rather than most of it.
 *
 * All three environment variables still override everything: an operator who has
 * measured their own deployment knows better than a ratio. The Helm chart sets
 * them explicitly beside `resources.limits.memory` so the two cannot drift apart
 * silently, and an override the container cannot absorb gets a startup warning
 * (`warnIfLimitExceedsMemory`) against the same share its default was derived
 * from -- a quarter for the two buffered limits, a half for the upload.
 */

/** Bytes in a mebibyte, spelled out where the defaults are set. */
const MIB = 1024 * 1024;

/**
 * Share of the container's memory limit a single buffered backup may account for.
 *
 * One quarter, because at the peak of a buffered export the same data is resident
 * several times over -- per-table JSON strings, the concatenated buffer, the gzip
 * output -- on top of the baseline the process needs to serve everything else
 * (the chart *requests* 140 MiB of its 400 MiB limit for exactly that). A ratio
 * rather than a measured multiplier because the multiplier depends on the dataset
 * shape; being conservative here costs a refused oversized export, and being
 * generous costs the process.
 */
const MEMORY_SHARE_PER_BACKUP = 0.25;

/**
 * Share of the container a compressed restore upload may occupy.
 *
 * The same figure `resolveRestoreUploadLimitBytes` derives its default from, so
 * the derived default can never warn about itself -- exported for the startup
 * check, which has to compare an operator's override against the same threshold
 * the derivation used rather than against the buffered-export quarter. Checking a
 * half-share limit against a quarter-share threshold would have warned on every
 * deployment, which is why this check was missing rather than merely unwired.
 */
export const MEMORY_SHARE_PER_RESTORE_UPLOAD = 0.5;

/**
 * How many times its wire size a restore may occupy at peak.
 *
 * A restore does not cost what it uploads. An encrypted upload holds the envelope,
 * `decipher.update`'s output, `Buffer.concat`'s new buffer, the decompressed
 * payload, the UTF-8 string and the parsed object graph, and several of those are
 * live at the same moment. So the compressed upload ceiling and the aggregate
 * admission budget are two different numbers with this ratio between them: the
 * *peak* gets `MEMORY_SHARE_PER_RESTORE_UPLOAD` of the container, and the wire
 * gets that divided by this.
 *
 * The first version of the admission gate skipped this and budgeted wire bytes
 * directly, which counted the smallest of those buffers -- three 60 MiB uploads
 * declared 180 MiB, fitted a 200 MiB budget, and could pass 540 MiB in flight. The
 * per-request ceiling had the same hole one level up: half a 400 MiB container to
 * the wire meant 600 MiB at peak for a single legal request.
 *
 * Three is a floor rather than a measurement -- the true multiple depends on
 * Node's version, the payload's entropy and the object graph's shape, so this is
 * chosen to be defensible without one. Raising it refuses legitimate restores;
 * treating it as 1 is the defect it replaced. The measurement wants the
 * cgroup-constrained peak-RSS test that this environment cannot run.
 */
export const PEAK_MULTIPLE = 3;

/**
 * The share the upload limit's startup warning is measured against.
 *
 * `warnIfLimitExceedsMemory` compares the number the operator *set* -- wire bytes
 * -- so the threshold has to be in wire bytes too: the peak share divided by the
 * multiple, which is exactly what the default derives to. So the derived default
 * never warns about itself, and the figure the warning suggests is one the operator
 * can paste into `BACKUP_RESTORE_LIMIT`. Suggesting the peak share instead would
 * hand them a number that OOM-kills the pod.
 */
export const UPLOAD_WARNING_SHARE =
  MEMORY_SHARE_PER_RESTORE_UPLOAD / PEAK_MULTIPLE;

/**
 * Floor and cap on a derived default.
 *
 * The floor keeps a small container (a 256 MiB dev pod) from deriving a ceiling
 * so low that ordinary datasets are refused -- below this, an operator should be
 * setting the limit deliberately rather than inheriting one. The cap keeps a
 * large container from deriving a number so high that the ceiling stops being a
 * meaningful guard against a hostile payload.
 */
const MIN_DERIVED_LIMIT_BYTES = 64 * MIB;
const MAX_DERIVED_LIMIT_BYTES = 1024 * MIB;

/**
 * Fallback when the process memory limit cannot be read -- bare metal, a
 * development machine, an unlimited container. Deliberately modest: this is the
 * case where nothing is known, and a ceiling that only fires on a genuinely
 * enormous payload is still better than none.
 */
const UNKNOWN_MEMORY_FALLBACK_BYTES = 256 * MIB;

/**
 * The container's memory limit in bytes, or null when there is no limit to read.
 *
 * cgroup v2 first (`memory.max`), then v1 (`memory.limit_in_bytes`). Both report
 * an absent limit as a sentinel -- the literal string `max` on v2, a number close
 * to 2^63 on v1 -- and both are treated as "unknown" rather than as a very large
 * limit, because deriving a ceiling from 8 exbibytes is the same as having none.
 */
export function detectProcessMemoryLimitBytes(): number | null {
  const candidates: Array<{
    path: string;
    unlimited: (raw: string) => boolean;
  }> = [
    { path: "/sys/fs/cgroup/memory.max", unlimited: (raw) => raw === "max" },
    {
      path: "/sys/fs/cgroup/memory/memory.limit_in_bytes",
      // v1 writes a rounded PAGE_SIZE multiple of 2^63 when unconstrained.
      unlimited: (raw) => Number(raw) > Number.MAX_SAFE_INTEGER,
    },
  ];

  for (const { path, unlimited } of candidates) {
    let raw: string;
    try {
      raw = readFileSync(path, "utf-8").trim();
    } catch {
      continue;
    }
    if (raw === "" || unlimited(raw)) continue;
    const bytes = Number(raw);
    if (Number.isFinite(bytes) && bytes > 0) return bytes;
  }
  return null;
}

/**
 * The default ceiling for one buffered backup payload on this container.
 *
 * Exported as a function rather than a constant because it reads the environment
 * the process is actually running in, and because a test needs to be able to ask
 * the question for a hypothetical container.
 */
export function deriveDefaultLimitBytes(
  memoryLimitBytes: number | null = detectProcessMemoryLimitBytes(),
): number {
  if (memoryLimitBytes === null) return UNKNOWN_MEMORY_FALLBACK_BYTES;
  const share = Math.floor(memoryLimitBytes * MEMORY_SHARE_PER_BACKUP);
  return Math.min(
    MAX_DERIVED_LIMIT_BYTES,
    Math.max(MIN_DERIVED_LIMIT_BYTES, share),
  );
}

/**
 * The **resolved** decompression ceiling `gunzip` will enforce -- the operator's
 * `BACKUP_RESTORE_EXPANDED_LIMIT` if set, else the derived default.
 *
 * Standalone so the restore-processing slot calculation can budget against the
 * exact limit the parser uses, not a separately derived guess. The slot math read
 * `deriveDefaultLimitBytes` directly and so ignored an operator override entirely:
 * a 2 GiB override on a 16 GiB pod still modeled each restore at the 1 GiB derived
 * cap and admitted five of them (F3R7-002).
 */
export function resolveRestoreExpandedLimitBytes(
  raw: string | undefined = process.env.BACKUP_RESTORE_EXPANDED_LIMIT,
  memoryLimitBytes: number | null = detectProcessMemoryLimitBytes(),
): number {
  return resolveByteLimit(raw, deriveDefaultLimitBytes(memoryLimitBytes));
}

/**
 * Memory the ordinary Node/Nest process needs, reserved before restores get any.
 *
 * `max(96 MiB, a fifth of the container)`: a fixed floor because the V8/Nest
 * baseline does not shrink to nothing on a small pod, and a share because a large
 * pod runs more concurrent non-restore work. This is an **estimate**, not a
 * measurement -- the same open risk as `PEAK_MULTIPLE` (DR-F3R7-003) -- but
 * subtracting a defensible baseline is closer than subtracting nothing, which is
 * what the slot math did before.
 */
export function restoreProcessBaselineBytes(memoryLimitBytes: number): number {
  return Math.max(96 * MIB, Math.floor(memoryLimitBytes * 0.2));
}

const UNITS: Record<string, number> = {
  b: 1,
  kb: 1024,
  mb: MIB,
  gb: 1024 * MIB,
};

/**
 * Parses a `bytes`-style size ("512mb", "2gb", "1048576") into bytes.
 *
 * Written out rather than taken from body-parser's `bytes` dependency: that is a
 * transitive package, and a limit that silently becomes `undefined` because a
 * transitive dep moved is a ceiling that is not there.
 *
 * Returns null for anything it cannot read, so the caller logs and falls back to
 * its default instead of running unbounded on a typo.
 */
export function parseByteSize(value: string | undefined): number | null {
  if (value === undefined) return null;
  const match = /^\s*(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?\s*$/i.exec(value);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const unit = UNITS[(match[2] ?? "b").toLowerCase()];
  return Math.floor(amount * unit);
}

/** Reads a byte-size limit from the environment, falling back on bad input. */
export function resolveByteLimit(
  raw: string | undefined,
  fallback: number,
  onInvalid?: (message: string) => void,
): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = parseByteSize(raw);
  if (parsed === null) {
    onInvalid?.(
      `Could not read "${raw}" as a byte size (expected e.g. "512mb"); using ${fallback} bytes.`,
    );
    return fallback;
  }
  return parsed;
}

/**
 * Ceiling on the *compressed* restore upload, for `express.raw`.
 *
 * This defaulted to the literal string `"500mb"` in `main.ts` while the chart's
 * backend limit is 400 MiB, and `express.raw` buffers the whole body onto the heap
 * **before** the controller, the guards, the authentication lookup, the decryption
 * and every service-level ceiling. So the process could die on a request none of
 * those layers ever saw -- an availability defect that no amount of care further in
 * could reach, because the allocation happened first.
 *
 * **The wire bytes are not the cost.** This used to be half the container on the
 * reasoning that a compressed upload is one buffer -- but the request that
 * uploads it then holds the envelope, the decipher output, the concatenated
 * plaintext, the decompressed payload, the string and the parsed graph, several of
 * them at once. Half of a 400 MiB container to the wire is `PEAK_MULTIPLE` times
 * that at peak, so a single legal request could not fit the pod it was sized for.
 *
 * So the *peak* gets `MEMORY_SHARE_PER_RESTORE_UPLOAD` of the container and the
 * wire gets that divided by `PEAK_MULTIPLE` -- about 66 MiB of compressed upload on
 * the chart's default backend, peaking at the same 200 MiB the aggregate admission
 * budget allows. The two numbers are derived from one share so they cannot disagree.
 *
 * That is a much smaller default than before, and deliberately: a compressed
 * backup near the old figure could not be restored on the default pod at all. An
 * operator whose users have large artifacts -- likelier now that attachment bytes
 * travel inside them -- raises `BACKUP_RESTORE_LIMIT` *and* the pod's memory, and
 * gets a startup warning if they do only the first.
 *
 * Returned as bytes; `express.raw` accepts a number.
 */
export function resolveRestoreUploadLimitBytes(
  raw: string | undefined = process.env.BACKUP_RESTORE_LIMIT,
  memoryLimitBytes: number | null = detectProcessMemoryLimitBytes(),
): number {
  const derived =
    memoryLimitBytes === null
      ? UNKNOWN_MEMORY_FALLBACK_BYTES
      : safeDerivedUploadLimit(memoryLimitBytes);
  return resolveByteLimit(raw, derived);
}

/**
 * The largest upload whose peak stays inside the container's restore share.
 *
 * **No floor.** The other derived ceilings apply `MIN_DERIVED_LIMIT_BYTES` so a
 * small container does not inherit a limit too low to be usable -- but a usability
 * minimum and a safety maximum are different quantities, and resolving them with
 * `max()` lets the floor win over the safety. On a 128 MiB pod the safe upload is
 * `128 * 0.5 / 3 = 21 MiB`; flooring that to 64 MiB models a 192 MiB peak, which
 * exceeds the whole container. So the safety bound is the only bound here: the
 * result is exactly `container * share / PEAK_MULTIPLE`, capped, never floored
 * above it. `resolvedLimit * PEAK_MULTIPLE <= container * share` holds for every
 * container size.
 *
 * When that leaves a very small limit the deployment can still restore small
 * backups; `warnIfRestoreUploadLimitIsCramped` says so at startup rather than
 * flooring into a number the pod cannot survive. Raising the memory limit, or
 * setting `BACKUP_RESTORE_LIMIT` on a pod whose real headroom this cannot see, is
 * the operator's lever.
 */
export function safeDerivedUploadLimit(memoryLimitBytes: number): number {
  const safe = Math.floor(
    (memoryLimitBytes * MEMORY_SHARE_PER_RESTORE_UPLOAD) / PEAK_MULTIPLE,
  );
  return Math.min(MAX_DERIVED_LIMIT_BYTES, Math.max(1, safe));
}

/**
 * Below this a derived upload limit is safe but cramped: real backups may be
 * refused, so the operator should know rather than discover it on a failed
 * restore. Not a floor on the value -- flooring is exactly the bug above -- only
 * the threshold for a startup warning.
 */
export const CRAMPED_UPLOAD_LIMIT_BYTES = 32 * MIB;

/**
 * Warns when the derived upload limit is safe but small enough to refuse ordinary
 * backups, so the operator raises memory or sets the limit deliberately. Silent
 * when the operator set an explicit value (their choice) or the limit is roomy.
 */
export function warnIfRestoreUploadLimitIsCramped(
  resolvedLimitBytes: number,
  rawOverride: string | undefined,
  onWarn: (message: string) => void,
): void {
  if (rawOverride !== undefined && rawOverride.trim() !== "") return;
  if (resolvedLimitBytes >= CRAMPED_UPLOAD_LIMIT_BYTES) return;
  const mib = (bytes: number) => `${Math.round(bytes / MIB)}MiB`;
  onWarn(
    `Derived restore upload limit is only ${mib(resolvedLimitBytes)} on this ` +
      `container -- backups larger than that will be refused. This is the largest ` +
      `size whose peak memory fits the pod; raise the container memory limit for a ` +
      `larger restore, or set BACKUP_RESTORE_LIMIT deliberately if the pod has more ` +
      `headroom than its cgroup reports.`,
  );
}

/**
 * Warn when a configured ceiling cannot protect the container it runs in.
 *
 * An operator who sets `BACKUP_EXPORT_BUFFER_LIMIT=2gb` on a 400 MiB pod has
 * written down an intention the runtime cannot honour, and the failure mode is a
 * killed process rather than a rejected request -- so it is worth saying at
 * startup rather than leaving them to infer it from a restart. Not fatal: the
 * limit may be deliberate on a container whose real limit this cannot see.
 */
export function warnIfLimitExceedsMemory(
  label: string,
  limitBytes: number,
  onWarn: (message: string) => void,
  memoryLimitBytes: number | null = detectProcessMemoryLimitBytes(),
  safeShare: number = MEMORY_SHARE_PER_BACKUP,
): void {
  if (memoryLimitBytes === null) return;
  const safe = Math.floor(memoryLimitBytes * safeShare);
  if (limitBytes <= safe) return;
  const mib = (bytes: number) => `${Math.round(bytes / MIB)}MiB`;
  onWarn(
    `${label} is ${mib(limitBytes)} but this container's memory limit is ` +
      `${mib(memoryLimitBytes)}. A request near this ceiling will be OOM-killed ` +
      `rather than refused. Consider ${mib(safe)} or less, or raise the memory ` +
      `limit.`,
  );
}
