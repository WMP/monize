import { Body, Controller, Post, Request, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { Throttle } from "@nestjs/throttler";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AttachmentsService } from "./attachments.service";
import { UploadAttachmentDto } from "./dto/upload-attachment.dto";

/** Attachment context for files attached to the AI chat. */
const AI_CHAT_ENTITY = "ai_chat";

@ApiTags("AI")
@ApiBearerAuth()
@Controller("ai/attachments")
@UseGuards(AuthGuard("jwt"))
export class AttachmentsController {
  constructor(private readonly attachmentsService: AttachmentsService) {}

  @Post()
  @ApiOperation({ summary: "Upload a file to attach to an AI chat prompt" })
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  async upload(
    @Request() req: { user: { id: string } },
    @Body() dto: UploadAttachmentDto,
  ) {
    const data = Buffer.from(dto.dataBase64, "base64");
    return this.attachmentsService.create(req.user.id, {
      fileName: dto.fileName,
      mimeType: dto.mimeType,
      data,
      entityType: AI_CHAT_ENTITY,
    });
  }
}
