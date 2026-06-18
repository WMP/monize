import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Response } from "express";
import { AttachmentsService } from "./attachments.service";
import { AttachmentSigningService } from "./attachment-signing.service";
import { SkipCsrf } from "../common/decorators/skip-csrf.decorator";

/**
 * Public, signature-gated attachment download. This is how a user's MCP agent
 * fetches a chat attachment: the relay hands it a short-lived signed URL
 * (?u=<owner>&token=<hmac>) instead of a bearer-authenticated endpoint. No JWT
 * guard -- the HMAC over (id, owner, expiry) is the authorization, re-checked
 * on every request. Kept on its own controller so the class-level JWT guard on
 * the upload controller does not apply here.
 */
@ApiTags("AI")
@Controller("ai/attachments")
export class AttachmentDownloadController {
  constructor(
    private readonly attachmentsService: AttachmentsService,
    private readonly signingService: AttachmentSigningService,
  ) {}

  @Get(":id/raw")
  @SkipCsrf()
  @ApiOperation({ summary: "Download an attachment via a signed URL" })
  @Throttle({ default: { ttl: 60000, limit: 60 } })
  async download(
    @Param("id", ParseUUIDPipe) id: string,
    @Query("u", ParseUUIDPipe) userId: string,
    @Query("token") token: string,
    @Res() res: Response,
  ): Promise<void> {
    if (!token || !this.signingService.verify(id, userId, token)) {
      throw new UnauthorizedException("Invalid or expired attachment link");
    }
    const { fileName, mimeType, data } = await this.attachmentsService.getRaw(
      userId,
      id,
    );
    // Defend against stored XSS: attachments are served from the app origin, so
    // an SVG or HTML upload (including a rich paste) must not execute script.
    // Only known raster images render inline; everything else downloads as an
    // attachment. Belt and braces: nosniff stops content-type guessing and a
    // locked-down CSP neutralises any active content if a type slips through.
    const lower = mimeType.toLowerCase();
    const disposition = SAFE_INLINE_TYPES.has(lower) ? "inline" : "attachment";
    res.set({
      "Content-Type": mimeType,
      "Content-Length": String(data.length),
      "Content-Disposition": `${disposition}; filename="${fileName}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    });
    res.end(data);
  }
}

/** Raster image types safe to render inline (no active/scriptable content). */
const SAFE_INLINE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);
