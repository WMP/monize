import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHmac, timingSafeEqual } from "crypto";

/**
 * How long a signed attachment URL stays valid. Short by design: the URL is
 * handed to the agent for a single fetch right after a prompt is enqueued.
 */
export const ATTACHMENT_URL_TTL_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Signs and verifies short-lived attachment download URLs with an HMAC, so the
 * relay can hand a user's MCP agent a fetchable link without exposing a
 * bearer-authenticated endpoint. The token binds the attachment id, the owner,
 * and an expiry; the download endpoint re-checks all three. The key is derived
 * from the JWT secret with a dedicated label (no new env var), mirroring
 * AiActionSigningService.
 */
@Injectable()
export class AttachmentSigningService {
  private readonly key: string;

  constructor(private readonly configService: ConfigService) {
    const base = this.configService.get<string>("JWT_SECRET") ?? "";
    this.key = `${base}:attachment-url-v1`;
  }

  /** Produce a `expiry.signature` token for an attachment owned by userId. */
  sign(attachmentId: string, userId: string, now: number = Date.now()): string {
    const expiresAt = now + ATTACHMENT_URL_TTL_MS;
    const signature = this.compute(attachmentId, userId, expiresAt);
    return `${expiresAt}.${signature}`;
  }

  /**
   * Verify a token for an attachment+user. Returns true only when the signature
   * matches and the token has not expired.
   */
  verify(
    attachmentId: string,
    userId: string,
    token: string,
    now: number = Date.now(),
  ): boolean {
    const dot = token.indexOf(".");
    if (dot <= 0) {
      return false;
    }
    const expiresAt = Number(token.slice(0, dot));
    const signature = token.slice(dot + 1);
    if (!Number.isFinite(expiresAt) || expiresAt < now) {
      return false;
    }
    const expected = this.compute(attachmentId, userId, expiresAt);
    let expectedBuf: Buffer;
    let actualBuf: Buffer;
    try {
      expectedBuf = Buffer.from(expected, "hex");
      actualBuf = Buffer.from(signature, "hex");
    } catch {
      return false;
    }
    if (actualBuf.length === 0 || expectedBuf.length !== actualBuf.length) {
      return false;
    }
    return timingSafeEqual(expectedBuf, actualBuf);
  }

  private compute(
    attachmentId: string,
    userId: string,
    expiresAt: number,
  ): string {
    return createHmac("sha256", this.key)
      .update(`${attachmentId}:${userId}:${expiresAt}`)
      .digest("hex");
  }
}
