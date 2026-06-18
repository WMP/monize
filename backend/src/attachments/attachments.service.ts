import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Attachment } from "./entities/attachment.entity";
import {
  ATTACHMENT_STORAGE,
  AttachmentStorageProvider,
} from "./storage/attachment-storage";

/** Default cap on a single attachment's decoded size (10 MB). */
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;

/**
 * MIME types accepted for chat/receipt uploads. Kept conservative: images and
 * documents a user would attach to a transaction or ask the assistant about.
 */
const DEFAULT_ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/heic",
  "application/pdf",
  "text/plain",
  "text/csv",
  "text/html",
]);

export interface CreateAttachmentInput {
  fileName: string;
  mimeType: string;
  data: Buffer;
  entityType: string;
  entityId?: string | null;
}

/** Public metadata shape (never includes the raw bytes). */
export interface AttachmentMetadata {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: Date;
}

@Injectable()
export class AttachmentsService {
  private readonly maxBytes: number;

  constructor(
    @InjectRepository(Attachment)
    private readonly attachmentsRepository: Repository<Attachment>,
    @Inject(ATTACHMENT_STORAGE)
    private readonly storage: AttachmentStorageProvider,
    private readonly configService: ConfigService,
  ) {
    this.maxBytes =
      this.configService.get<number>("ATTACHMENT_MAX_BYTES") ??
      DEFAULT_MAX_BYTES;
  }

  /** Validate and persist a new attachment, returning its public metadata. */
  async create(
    userId: string,
    input: CreateAttachmentInput,
  ): Promise<AttachmentMetadata> {
    const mimeType = input.mimeType.trim().toLowerCase();
    if (!this.isAllowedMime(mimeType)) {
      throw new BadRequestException(`Unsupported file type: ${mimeType}`);
    }
    if (input.data.length === 0) {
      throw new BadRequestException("File is empty");
    }
    if (input.data.length > this.maxBytes) {
      throw new BadRequestException(
        `File exceeds the maximum size of ${this.maxBytes} bytes`,
      );
    }

    const attachment = this.attachmentsRepository.create({
      userId,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      fileName: this.sanitizeFileName(input.fileName),
      mimeType,
      sizeBytes: input.data.length,
      storageDriver: this.storage.driver,
    });

    const stored = await this.storage.save(attachment.id, input.data);
    attachment.data = stored.inlineData;
    attachment.storageKey = stored.storageKey;

    const saved = await this.attachmentsRepository.save(attachment);
    return this.toMetadata(saved);
  }

  /** Fetch public metadata for a set of attachment ids owned by the user. */
  async getMetadataByIds(
    userId: string,
    ids: string[],
  ): Promise<AttachmentMetadata[]> {
    if (ids.length === 0) {
      return [];
    }
    const rows = await this.attachmentsRepository.find({
      where: ids.map((id) => ({ id, userId })),
    });
    return rows.map((row) => this.toMetadata(row));
  }

  /** Load the raw bytes for download, scoped to the owner. */
  async getRaw(
    userId: string,
    id: string,
  ): Promise<{ fileName: string; mimeType: string; data: Buffer }> {
    const attachment = await this.attachmentsRepository
      .createQueryBuilder("attachment")
      .addSelect("attachment.data")
      .where("attachment.id = :id", { id })
      .andWhere("attachment.user_id = :userId", { userId })
      .getOne();

    if (!attachment) {
      throw new NotFoundException("Attachment not found");
    }
    const data = await this.storage.load(attachment);
    return {
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      data,
    };
  }

  private isAllowedMime(mimeType: string): boolean {
    return mimeType.startsWith("image/") || DEFAULT_ALLOWED_MIME.has(mimeType);
  }

  /** Strip path separators and control characters from a client file name. */
  private sanitizeFileName(name: string): string {
    const base = (name || "file")
      .replace(/[/\\]/g, "_")
      .replace(/[\r\n"]/g, "");
    const trimmed = base.trim().slice(0, 255);
    return trimmed.length > 0 ? trimmed : "file";
  }

  private toMetadata(attachment: Attachment): AttachmentMetadata {
    return {
      id: attachment.id,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      createdAt: attachment.createdAt,
    };
  }
}
