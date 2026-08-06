import { Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { tr } from "../../i18n/translate";
import { AttachmentStorageProvider } from "./attachment-storage.interface";

/**
 * The longest a single S3 operation may run, end to end, before it is aborted.
 *
 * This is a *correctness* bound, not a tuning knob. The orphan sweeper quarantines
 * a swept upload intent for `LATE_WRITE_QUARANTINE_MS` (6 hours) and re-deletes the
 * key on each pass, on the assumption that a `PutObject` cannot land after the
 * quarantine retires the row. That assumption only holds if the put cannot still be
 * in flight six hours later (audit V4R3-003, DR-V4R3-03).
 *
 * The mechanism is an `AbortController` armed around the whole operation --
 * `withDeadline` below -- not the socket timers. Socket-level timeouts
 * (`connectionTimeout`/`requestTimeout`) are inactivity timers per attempt: an
 * endpoint that trickles one byte at a time keeps the socket busy forever without
 * ever tripping them, and the SDK retries on top, multiplying whatever bound they
 * did give. The abort signal spans connect, send, retries and body consumption, so
 * it is the number this comment can honestly promise. The socket timers are still
 * set, as hygiene, so an outright-dead peer fails fast instead of waiting for the
 * deadline.
 *
 * `ATTACHMENT_S3_REQUEST_TIMEOUT_MS` may shorten the deadline (tests point it at a
 * deliberately stalled endpoint; operators may prefer failing faster). It can never
 * lengthen it: the quarantine math depends on this ceiling, so a configured value
 * above it is clamped down.
 */
export const S3_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Attempts per operation (the SDK default, made explicit because the quarantine
 * reasoning references it). Retries do not extend the deadline -- the abort signal
 * spans all of them -- so this only bounds how much work fits inside it.
 */
export const S3_MAX_ATTEMPTS = 3;

/**
 * Stores attachment bytes in S3-compatible object storage. Chosen by
 * ATTACHMENT_STORAGE_PROVIDER=s3.
 *
 * Works with AWS S3 and any S3-compatible service (MinIO, Cloudflare R2,
 * Backblaze B2, ...) via ATTACHMENT_S3_ENDPOINT / ATTACHMENT_S3_FORCE_PATH_STYLE.
 * Credentials come from ATTACHMENT_S3_ACCESS_KEY_ID / _SECRET_ACCESS_KEY when
 * set, otherwise from the default AWS credential chain (instance role, env, ...).
 *
 * The client is built lazily on first use so a deployment that never selects s3
 * pays nothing and never needs the bucket configured. As with the local
 * provider, bytes live outside the database and are not embedded in the
 * application backup -- the bucket must be backed up alongside it.
 */
@Injectable()
export class S3StorageProvider implements AttachmentStorageProvider {
  readonly name = "s3";

  private clientInstance?: S3Client;
  private readonly bucket: string;
  private readonly prefix: string;
  private readonly deadlineMs: number;

  constructor(private readonly config: ConfigService) {
    this.bucket = this.config.get<string>("ATTACHMENT_S3_BUCKET") ?? "";
    const prefix = this.config.get<string>("ATTACHMENT_S3_PREFIX") ?? "";
    // Normalise to at most one trailing slash so object keys join cleanly.
    this.prefix = prefix ? `${prefix.replace(/\/+$/, "")}/` : "";
    const configured = Number(
      this.config.get<string>("ATTACHMENT_S3_REQUEST_TIMEOUT_MS") ?? "",
    );
    // Shorten-only: the ceiling is what the sweeper's quarantine window relies on.
    this.deadlineMs =
      Number.isFinite(configured) && configured > 0
        ? Math.min(configured, S3_REQUEST_TIMEOUT_MS)
        : S3_REQUEST_TIMEOUT_MS;
  }

  private client(): S3Client {
    if (this.clientInstance) return this.clientInstance;
    if (!this.bucket) {
      throw new Error(
        "ATTACHMENT_S3_BUCKET must be set when ATTACHMENT_STORAGE_PROVIDER=s3",
      );
    }
    const endpoint = this.config.get<string>("ATTACHMENT_S3_ENDPOINT");
    const accessKeyId = this.config.get<string>("ATTACHMENT_S3_ACCESS_KEY_ID");
    const secretAccessKey = this.config.get<string>(
      "ATTACHMENT_S3_SECRET_ACCESS_KEY",
    );
    const forcePathStyle =
      (this.config.get<string>("ATTACHMENT_S3_FORCE_PATH_STYLE") ?? "")
        .toLowerCase()
        .trim() === "true";

    this.clientInstance = new S3Client({
      region: this.config.get<string>("ATTACHMENT_S3_REGION") ?? "us-east-1",
      ...(endpoint ? { endpoint } : {}),
      forcePathStyle,
      ...(accessKeyId && secretAccessKey
        ? { credentials: { accessKeyId, secretAccessKey } }
        : {}),
      maxAttempts: S3_MAX_ATTEMPTS,
      // Inactivity hygiene only; the enforced bound is withDeadline's abort.
      requestHandler: new NodeHttpHandler({
        connectionTimeout: this.deadlineMs,
        requestTimeout: this.deadlineMs,
      }),
    });
    return this.clientInstance;
  }

  private objectKey(key: string): string {
    return `${this.prefix}${key}`;
  }

  /**
   * Run one storage operation under an aborting total deadline.
   *
   * The signal is passed into `send` and stays armed until the callback settles,
   * so it covers connection, request body, every SDK retry, and -- for reads --
   * consuming the response body after `send` resolved, which no handler option
   * bounds. On abort the in-flight socket is destroyed, so a stalled `PutObject`
   * is dead, not merely disowned.
   */
  private async withDeadline<T>(
    operation: string,
    op: (options: { abortSignal: AbortSignal }) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    let deadlineFired = false;
    const timer = setTimeout(() => {
      deadlineFired = true;
      controller.abort();
    }, this.deadlineMs);
    timer.unref();
    try {
      return await op({ abortSignal: controller.signal });
    } catch (error) {
      if (deadlineFired) {
        throw new Error(
          `S3 ${operation} exceeded its ${this.deadlineMs} ms deadline and was aborted`,
        );
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async save(key: string, data: Buffer): Promise<void> {
    await this.withDeadline("PutObject", (options) =>
      this.client().send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: this.objectKey(key),
          Body: data,
        }),
        options,
      ),
    );
  }

  async load(key: string): Promise<Buffer> {
    try {
      return await this.withDeadline("GetObject", async (options) => {
        const result = await this.client().send(
          new GetObjectCommand({
            Bucket: this.bucket,
            Key: this.objectKey(key),
          }),
          options,
        );
        const body = result.Body;
        if (!body) {
          throw new NotFoundException(
            tr("errors.attachments.notFound", "Attachment not found"),
          );
        }
        const bytes = await body.transformToByteArray();
        return Buffer.from(bytes);
      });
    } catch (error) {
      if (this.isNotFound(error)) {
        throw new NotFoundException(
          tr("errors.attachments.notFound", "Attachment not found"),
        );
      }
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    // S3 DeleteObject is already idempotent -- deleting a missing key succeeds.
    await this.withDeadline("DeleteObject", (options) =>
      this.client().send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: this.objectKey(key),
        }),
        options,
      ),
    );
  }

  private isNotFound(error: unknown): boolean {
    const e = error as {
      name?: string;
      $metadata?: { httpStatusCode?: number };
    };
    return (
      e?.name === "NoSuchKey" ||
      e?.name === "NotFound" ||
      e?.$metadata?.httpStatusCode === 404
    );
  }
}
