import { ServiceUnavailableException } from "@nestjs/common";
import { tr } from "../i18n/translate";
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
 * **What this gate does not do is prove that one restore fits.** It bounds
 * concurrency, and only concurrency. An earlier version of this comment called the
 * cap insensitive to `PEAK_MULTIPLE`'s true value, on the grounds that one restore
 * fitting was already guaranteed by the upload and expanded limits -- circular, since
 * `safeDerivedUploadLimit` *is* `container * share / PEAK_MULTIPLE`. Every ceiling in
 * the chain is derived by dividing by the same unmeasured constant, so none of them
 * can vouch for it. `computeRestoreProcessingSlots` divides by
 * `PEAK_MULTIPLE * expandedLimit` directly.
 *
 * The margin that leaves is thin and worth stating in numbers. On the default
 * 400 MiB pod: expanded limit 100 MiB, modeled peak 300 MiB, baseline 96 MiB, so
 * one slot with 4 MiB spare -- and a *true* multiple above **3.04** puts one
 * admitted restore over the container. On a 512 MiB or 1 GiB pod the break-even is
 * 3.20. `PEAK_MULTIPLE = 3` is documented as a defensible floor rather than a
 * measurement, so the honest reading is that the gate is safe *if that floor holds
 * for the workload*, and nothing here establishes that it does. Measuring it is
 * https://github.com/kenlasko/monize/issues/1073; until then an operator whose
 * restore is OOM-killed at one slot is hitting this, not a bug in the gate, and the
 * lever is a larger pod or a lower `BACKUP_RESTORE_EXPANDED_LIMIT`.
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

  /**
   * Set the concurrent-processing capacity and wake any waiters it frees.
   *
   * Zero is kept as zero (F3RB-005). It used to be floored to one, so a
   * container in which one modeled restore does not fit still admitted one --
   * a warning, then an OOM kill mid-restore during a disaster recovery, which
   * is the worst moment to lose the process. An admission control that runs
   * work its own model says cannot fit is not an admission control; `acquire`
   * now refuses instead, and the operator gets an actionable 503 rather than a
   * restarted pod.
   */
  configure(capacity: number): void {
    this.capacity = Math.max(0, Math.floor(capacity));
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
    if (this.capacity < 1) {
      // Nothing will ever free a slot, so waiting would be a hang, not a queue.
      // 503 rather than 500: the deployment is misconfigured, a retry without
      // changing it cannot help, and the message says which knob to turn.
      throw new ServiceUnavailableException(
        tr(
          "errors.backup.restoreNoMemoryHeadroom",
          "This deployment has no memory headroom for a restore: one restore's " +
            "modeled peak does not fit the container. Raise the container memory " +
            "limit or lower BACKUP_RESTORE_EXPANDED_LIMIT.",
        ),
      );
    }
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
 * reads as "one at a time".
 *
 * A `0` reaches the gate as zero and `acquire` refuses with a 503 (F3RB-005). This
 * comment used to say the gate raised such a zero back to one, so that a `0` here
 * meant "run one anyway and warn" -- describing the floor that F3RB-005 removed two
 * functions above, which it outlived by several commits. Note what the honest zero
 * means for the 128 and 256 MiB pods: both model a 192 MiB
 * peak against a 96 MiB baseline and get zero slots, so they refuse every restore
 * until the operator lowers `BACKUP_RESTORE_EXPANDED_LIMIT` or raises the pod.
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
