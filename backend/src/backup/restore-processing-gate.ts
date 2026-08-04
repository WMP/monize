import {
  PEAK_MULTIPLE,
  resolveRestoreExpandedLimitBytes,
  restoreProcessBaselineBytes,
} from "./backup-limits";

/**
 * How many restores may be *processing* -- decrypting, decompressing, parsing,
 * staging -- at the same time.
 *
 * The upload admission gate (`restore-upload-admission.ts`) bounds concurrent
 * compressed bodies. It cannot bound what those bodies cost once they decompress,
 * because a small gzip expands to a large payload: expansion is capped by
 * `BACKUP_RESTORE_EXPANDED_LIMIT`, not by the compressed length. So four 1 MiB
 * uploads, each expanding to the ~100 MiB expanded ceiling, pass upload admission
 * on their 3 MiB claims and then hold ~400 MiB of decompressed data between them
 * on a 400 MiB pod. The wire budget never saw it.
 *
 * A restore's processing peak is dominated by the *expanded* payload and the
 * strings and object graph derived from it -- roughly `PEAK_MULTIPLE` times the
 * expanded limit -- and that figure is independent of how compressible the upload
 * was. This gate caps how many of those can be in flight at once, so the sum stays
 * inside the container. On the default pod the arithmetic yields one: restore
 * processing is serialised, and a second concurrent restore waits for the first to
 * finish rather than being admitted beside it. A restore is a rare, deliberate,
 * destructive operation, so serialising it costs a wait, not a feature.
 *
 * The cap is *robust to the unmeasured multiple*: whatever `PEAK_MULTIPLE`'s true
 * value, running one restore at a time is safe as long as one restore fits the
 * pod, and one restore fitting is what the upload/expanded limits already have to
 * guarantee. The gate does not itself depend on the multiple being exact.
 *
 * A module singleton rather than an injectable so the service can reach it without
 * threading it through a constructor that a hundred specs build. `configure(...)`
 * is called once at bootstrap with the real capacity; unconfigured it defaults to
 * one, which is also the safe default a test inherits.
 */
export class RestoreProcessingGate {
  private capacity: number;
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(capacity = 1) {
    this.capacity = Math.max(1, Math.floor(capacity));
  }

  /** Set the concurrent-processing capacity (min 1) and wake any waiters it frees. */
  configure(capacity: number): void {
    this.capacity = Math.max(1, Math.floor(capacity));
    this.drain();
  }

  /** Runs `fn` while holding a processing slot; releases it however `fn` settles. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  /** In-flight count, for diagnostics and tests. */
  get activeCount(): number {
    return this.active;
  }

  /** Number waiting for a slot, for diagnostics and tests. */
  get waitingCount(): number {
    return this.waiters.length;
  }

  private acquire(): Promise<void> {
    if (this.active < this.capacity) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  private release(): void {
    this.active -= 1;
    this.drain();
  }

  private drain(): void {
    while (this.active < this.capacity && this.waiters.length > 0) {
      this.active += 1;
      // The waiter's `acquire` promise resolves; it did not increment `active`
      // when it queued, so this increment is its slot.
      const next = this.waiters.shift() as () => void;
      next();
    }
  }
}

/**
 * How many restores whose combined processing peak fits the container, budgeting
 * against the memory that actually costs and reserving what the process needs.
 *
 * Two things the earlier version got wrong (F3R7-002):
 *
 *  - **The peak is `PEAK_MULTIPLE` times the *resolved* expanded limit**, the one
 *    `gunzip` enforces, not the separately derived default. An operator who raised
 *    `BACKUP_RESTORE_EXPANDED_LIMIT` raised every restore's peak, and the slot
 *    count has to see that or it admits restores that cannot fit.
 *  - **The process baseline is subtracted first.** Dividing the whole container by
 *    the per-restore peak double-counts the memory the ordinary process is already
 *    using.
 *
 * Returns the **honest** count, which can be `0`: a configuration where one modeled
 * restore does not fit is a real condition the caller must surface, not paper over
 * by forcing a slot. `1` for an unknown limit -- "cannot tell how big the pod is"
 * reads as "one at a time". The gate itself floors capacity at 1 (a running
 * process must be able to attempt a restore), so a `0` here means "run one, and
 * warn that even one may not fit".
 */
export function computeRestoreProcessingSlots(
  memoryLimitBytes: number | null,
  expandedLimitBytes: number = resolveRestoreExpandedLimitBytes(
    undefined,
    memoryLimitBytes,
  ),
  baselineBytes: number = memoryLimitBytes === null
    ? 0
    : restoreProcessBaselineBytes(memoryLimitBytes),
): number {
  if (memoryLimitBytes === null) return 1;
  const perRestorePeak = PEAK_MULTIPLE * expandedLimitBytes;
  if (perRestorePeak <= 0) return 1;
  const available = memoryLimitBytes - baselineBytes;
  return Math.max(0, Math.floor(available / perRestorePeak));
}

/** The process-wide gate. Configured once at bootstrap; defaults to serial. */
export const restoreProcessingGate = new RestoreProcessingGate(1);
