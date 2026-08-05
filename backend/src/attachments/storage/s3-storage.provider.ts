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
 * The longest a single S3 request may run before the SDK aborts it.
 *
 * This is a *correctness* bound, not a tuning knob. The orphan sweeper quarantines
 * a swept upload intent for `LATE_WRITE_QUARANTINE_MS` (6 hours) and re-deletes the
 * key on each pass, on the assumption that a `PutObject` cannot land after the
 * quarantine retires the row. That assumption only holds if the put cannot still be
 * in flight six hours later -- so the request deadline has to be comfortably shorter
 * than the window (audit V4R3-003, DR-V4R3-03). Five minutes is far below six hours
 * and far above any healthy upload of a <=10 MB attachment.
 */
export const S3_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

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

  constructor(private readonly config: ConfigService) {
    this.bucket = this.config.get<string>("ATTACHMENT_S3_BUCKET") ?? "";
    const prefix = this.config.get<string>("ATTACHMENT_S3_PREFIX") ?? "";
    // Normalise to at most one trailing slash so object keys join cleanly.
    this.prefix = prefix ? `${prefix.replace(/\/+$/, "")}/` : "";
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
      // Bound every request so a stalled PutObject cannot outlive the orphan
      // sweeper's quarantine window and land after the tombstone is retired.
      requestHandler: new NodeHttpHandler({
        connectionTimeout: S3_REQUEST_TIMEOUT_MS,
        requestTimeout: S3_REQUEST_TIMEOUT_MS,
      }),
    });
    return this.clientInstance;
  }

  private objectKey(key: string): string {
    return `${this.prefix}${key}`;
  }

  async save(key: string, data: Buffer): Promise<void> {
    await this.client().send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.objectKey(key),
        Body: data,
      }),
    );
  }

  async load(key: string): Promise<Buffer> {
    try {
      const result = await this.client().send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: this.objectKey(key),
        }),
      );
      const body = result.Body;
      if (!body) {
        throw new NotFoundException(
          tr("errors.attachments.notFound", "Attachment not found"),
        );
      }
      const bytes = await body.transformToByteArray();
      return Buffer.from(bytes);
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
    await this.client().send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: this.objectKey(key),
      }),
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
