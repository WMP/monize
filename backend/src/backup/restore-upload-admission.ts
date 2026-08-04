import type { IncomingMessage, ServerResponse } from "http";

/**
 * Aggregate admission for restore uploads, in front of the body parser.
 *
 * `resolveRestoreUploadLimitBytes` bounds **one** request. It cannot bound two.
 * `express.raw` buffers the whole body onto the heap before the controller, the
 * JWT guard and the global `ThrottlerGuard` -- those are Nest guards, and they
 * run after parsing -- so two unauthenticated clients each streaming just under
 * the per-request ceiling allocate twice the ceiling on a container sized for
 * one, and the only replica is OOM-killed. Nothing further down the path can
 * refuse an allocation that has already happened.
 *
 * So the process keeps a running total of bytes it has promised to buffer, and a
 * request is admitted only if its own claim still fits. The reservation is
 * released when the response finishes, whatever the outcome.
 *
 * Three decisions worth stating, because each is a trade:
 *
 * - **The budget equals the per-request ceiling**, not a multiple of it. On the
 *   chart's 400 MiB backend that is ~200 MiB: one large restore proceeds, a
 *   second concurrent one is refused rather than sharing a budget neither can fit
 *   in. A restore is a rare, deliberate, destructive operation -- serialising it
 *   costs a retry, and the alternative costs every user the replica serves.
 * - **A request with no `Content-Length` reserves the whole ceiling.** Chunked
 *   encoding does not say how much is coming, and the safe assumption on an
 *   unauthenticated path is the most it is allowed to send. The browser client
 *   uploads a `Blob`, so it always sends a length; a chunked uploader is
 *   admitted, just not concurrently with another.
 * - **An over-large `Content-Length` is refused here**, before any reservation.
 *   `express.raw` would also refuse it, but only after this has promised memory
 *   on its behalf.
 * - **Only requests the parser will buffer are budgeted at all.** A CORS
 *   preflight carries no `Content-Length`, so budgeting it would claim the whole
 *   ceiling for a request that allocates nothing -- the protection becoming a way
 *   to deny the upload it protects.
 *
 * This closes the concurrency half of the defect. It does **not** authenticate
 * before reading the body -- an unauthenticated client can still occupy the
 * budget and get a 503 for the next one, which is a refused request rather than a
 * dead process. The remaining work (a smaller ingress limit ahead of the process,
 * a two-step restore session with an upload token, or streaming to a bounded
 * temporary file) is recorded in `docs/backup-restore-contract.md`.
 */
export interface RestoreUploadAdmission {
  /** Express middleware: admits, or answers 503/413 itself. */
  middleware: (
    req: IncomingMessage,
    res: ServerResponse,
    next: (error?: unknown) => void,
  ) => void;
  /** Bytes currently promised. Exposed for tests and diagnostics. */
  reservedBytes: () => number;
}

/**
 * The content types `express.raw` is configured to buffer on the restore route.
 *
 * The gate budgets exactly what the parser allocates, and nothing else. A CORS
 * preflight carries no `Content-Length`, so without this it would claim the whole
 * ceiling for a request that buffers nothing -- turning the protection into a way
 * to deny the upload it protects.
 */
const PARSED_CONTENT_TYPES = ["application/gzip", "application/octet-stream"];

/** Whether the parser downstream will actually buffer this request's body. */
function willBuffer(req: IncomingMessage): boolean {
  const method = (req.method ?? "").toUpperCase();
  if (method !== "POST" && method !== "PUT" && method !== "PATCH") return false;
  const contentType = req.headers["content-type"];
  if (typeof contentType !== "string") return false;
  // "application/gzip; charset=..." is the same type; compare the media type only.
  const mediaType = contentType.split(";")[0].trim().toLowerCase();
  return PARSED_CONTENT_TYPES.includes(mediaType);
}

/** Parses `Content-Length`, returning null when absent or unusable. */
function contentLengthOf(req: IncomingMessage): number | null {
  const raw = req.headers["content-length"];
  if (typeof raw !== "string") return null;
  // A repeated header arrives as "10,10"; anything but a single integer is not a
  // length this can budget from, so it falls back to the conservative claim.
  if (!/^\d+$/.test(raw.trim())) return null;
  const parsed = Number(raw.trim());
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function createRestoreUploadAdmission(
  perRequestLimitBytes: number,
  budgetBytes: number = perRequestLimitBytes,
  onRefusal?: (message: string) => void,
): RestoreUploadAdmission {
  let reserved = 0;

  const refuse = (
    res: ServerResponse,
    status: number,
    message: string,
    retryAfterSeconds?: number,
  ) => {
    onRefusal?.(message);
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json");
    if (retryAfterSeconds !== undefined) {
      res.setHeader("Retry-After", String(retryAfterSeconds));
    }
    res.end(JSON.stringify({ statusCode: status, message }));
  };

  return {
    reservedBytes: () => reserved,
    middleware: (req, res, next) => {
      // Nothing to budget for a request the parser will not buffer.
      if (!willBuffer(req)) {
        next();
        return;
      }

      const declared = contentLengthOf(req);

      if (declared !== null && declared > perRequestLimitBytes) {
        // Refused before reserving: promising memory for a body that is already
        // over the ceiling would let a rejected request occupy the budget.
        refuse(
          res,
          413,
          "Backup upload exceeds the restore size limit for this deployment.",
        );
        return;
      }

      // No length means no promise from the client, so budget for the most it
      // could send.
      const claim = declared ?? perRequestLimitBytes;

      if (reserved + claim > budgetBytes) {
        refuse(
          res,
          503,
          "Another restore upload is in progress. Retry in a moment.",
          30,
        );
        return;
      }

      reserved += claim;
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        reserved -= claim;
      };
      // Both events, because a client that disconnects mid-upload emits `close`
      // without `finish` -- and a reservation nothing releases is a budget that
      // shrinks to zero over the process's lifetime.
      res.once("finish", release);
      res.once("close", release);

      next();
    },
  };
}
