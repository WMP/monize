import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Attachment } from "./entities/attachment.entity";
import { AttachmentsService } from "./attachments.service";
import { AttachmentsController } from "./attachments.controller";
import { AttachmentDownloadController } from "./attachment-download.controller";
import { AttachmentSigningService } from "./attachment-signing.service";
import {
  ATTACHMENT_STORAGE,
  attachmentStorageFactory,
} from "./storage/attachment-storage";

@Module({
  imports: [TypeOrmModule.forFeature([Attachment]), ConfigModule],
  providers: [
    AttachmentsService,
    AttachmentSigningService,
    {
      provide: ATTACHMENT_STORAGE,
      useFactory: attachmentStorageFactory,
      inject: [ConfigService],
    },
  ],
  controllers: [AttachmentsController, AttachmentDownloadController],
  exports: [AttachmentsService, AttachmentSigningService],
})
export class AttachmentsModule {}
