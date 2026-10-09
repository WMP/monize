import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateIf,
} from "class-validator";
import {
  IsReceiptDomain,
  normalizeReceiptDomain,
} from "../../parsers/dto/receipt-domain.validator";
import {
  EMAIL_RECEIPT_STATUSES,
  EmailReceiptStatus,
} from "../../entities/email-receipt.entity";

export const EMAIL_RECEIPTS_DEFAULT_LIST_LIMIT = 50;
export const EMAIL_RECEIPTS_MAX_LIST_LIMIT = 200;

/**
 * The statuses "process in bulk" can act on again: an email waiting to be read,
 * and every state a new profile (or a new transaction) can change. `review` is
 * not one of them: it stands behind a proposal a person decides.
 */
export const EMAIL_RECEIPT_PROCESSABLE_STATUSES = [
  "pending",
  "no_parser",
  "parse_failed",
  "unmatched",
  "ambiguous",
  "review_conflict",
] as const satisfies readonly EmailReceiptStatus[];
export type EmailReceiptProcessableStatus =
  (typeof EMAIL_RECEIPT_PROCESSABLE_STATUSES)[number];
export const EMAIL_RECEIPTS_DEFAULT_BATCH_LIMIT = 100;
export const EMAIL_RECEIPTS_MAX_BATCH_LIMIT = 200;

/** Query of `GET /email-receipts`. */
export class ListEmailReceiptsDto {
  @ApiPropertyOptional({ enum: EMAIL_RECEIPT_STATUSES })
  @IsOptional()
  @IsIn(EMAIL_RECEIPT_STATUSES)
  status?: EmailReceiptStatus;

  @ApiPropertyOptional({
    description:
      "A sender domain: emails from exactly this domain or one of its sub-domains. Lower-cased and trimmed.",
    example: "shop.example.com",
  })
  @IsOptional()
  @Transform(({ value }) => normalizeReceiptDomain(value))
  @IsReceiptDomain()
  domain?: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: EMAIL_RECEIPTS_MAX_LIST_LIMIT,
    default: EMAIL_RECEIPTS_DEFAULT_LIST_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(EMAIL_RECEIPTS_MAX_LIST_LIMIT)
  limit?: number;
}

/** Query of `GET /email-receipts/domains`. */
export class ListEmailReceiptDomainsDto {
  @ApiPropertyOptional({
    enum: EMAIL_RECEIPT_STATUSES,
    description: "Count only the emails in this state.",
  })
  @IsOptional()
  @IsIn(EMAIL_RECEIPT_STATUSES)
  status?: EmailReceiptStatus;
}

/** Query of `GET /email-receipts/status-counts`. */
export class EmailReceiptStatusCountsDto {
  @ApiPropertyOptional({
    description:
      "Count only emails from exactly this domain or one of its sub-domains. Lower-cased and trimmed.",
    example: "shop.example.com",
  })
  @IsOptional()
  @Transform(({ value }) => normalizeReceiptDomain(value))
  @IsReceiptDomain()
  domain?: string;
}

/** Body of `POST /email-receipts/:id/link`. */
export class LinkEmailReceiptDto {
  @ApiProperty({ description: "The transaction this email paid for." })
  @IsUUID()
  transactionId: string;
}

/**
 * Body of `POST /email-receipts/:id/ask-ai`. The transaction is optional: an
 * email that already has one is asked about as it is. A blank or null value
 * means "none", as in the other forms of this module.
 */
export class AskAiEmailReceiptDto {
  @ApiPropertyOptional({
    nullable: true,
    description:
      "The transaction this email paid for, when the person chose another one.",
  })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null && v !== "")
  @IsUUID()
  transactionId?: string | null;
}

/** Body of `POST /email-receipts/process-batch`. */
export class ProcessBatchEmailReceiptsDto {
  @ApiPropertyOptional({
    description:
      "Only emails from this sender domain or one of its sub-domains. Lower-cased and trimmed.",
    example: "shop.example.com",
  })
  @IsOptional()
  @Transform(({ value }) => normalizeReceiptDomain(value))
  @IsReceiptDomain()
  domain?: string;

  @ApiPropertyOptional({
    enum: EMAIL_RECEIPT_PROCESSABLE_STATUSES,
    isArray: true,
    description: "Only emails in these statuses. Default: every one of them.",
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(EMAIL_RECEIPT_PROCESSABLE_STATUSES.length)
  @ArrayUnique()
  @IsIn(EMAIL_RECEIPT_PROCESSABLE_STATUSES, { each: true })
  statuses?: EmailReceiptProcessableStatus[];

  @ApiPropertyOptional({
    minimum: 1,
    maximum: EMAIL_RECEIPTS_MAX_BATCH_LIMIT,
    default: EMAIL_RECEIPTS_DEFAULT_BATCH_LIMIT,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(EMAIL_RECEIPTS_MAX_BATCH_LIMIT)
  limit?: number;

  @ApiPropertyOptional({
    description:
      "The `since` the previous call of this run answered: only emails not touched since then are taken, so a run that loops until `remaining` is 0 ends even when some emails stay in the same status.",
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  since?: string;
}
