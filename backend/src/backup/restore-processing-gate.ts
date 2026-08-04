import { deriveDefaultLimitBytes, PEAK_MULTIPLE } from "./backup-limits";

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
 * Concurrent restores whose combined processing peak fits `memoryLimitBytes`.
 *
 * `deriveDefaultLimitBytes` is the expanded/buffered share (a quarter of the
 * container), and a restore's processing peak is about `PEAK_MULTIPLE` times that.
 * The number of restores whose peaks sum below the container is therefore
 * `floor(container / (PEAK_MULTIPLE * expandedShare))`, never less than one -- one
 * restore always runs, because refusing every restore is not a memory policy.
 *
 * Returns 1 for an unknown limit: the conservative reading of "cannot tell how big
 * the pod is" is "run them one at a time".
 */
export function computeRestoreProcessingSlots(
  memoryLimitBytes: number | null,
): number {
  if (memoryLimitBytes === null) return 1;
  const perRestorePeak =
    PEAK_MULTIPLE * deriveDefaultLimitBytes(memoryLimitBytes);
  if (perRestorePeak <= 0) return 1;
  return Math.max(1, Math.floor(memoryLimitBytes / perRestorePeak));
}

/** The process-wide gate. Configured once at bootstrap; defaults to serial. */
export const restoreProcessingGate = new RestoreProcessingGate(1);
