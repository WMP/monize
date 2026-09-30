import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from "class-validator";
import {
  EMAIL_RECEIPT_STATUSES,
  EmailReceiptStatus,
} from "../../entities/email-receipt.entity";

export const EMAIL_RECEIPTS_DEFAULT_LIST_LIMIT = 50;
export const EMAIL_RECEIPTS_MAX_LIST_LIMIT = 200;

/** Query of `GET /email-receipts`. */
export class ListEmailReceiptsDto {
  @ApiPropertyOptional({ enum: EMAIL_RECEIPT_STATUSES })
  @IsOptional()
  @IsIn(EMAIL_RECEIPT_STATUSES)
  status?: EmailReceiptStatus;

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

/** Body of `POST /email-receipts/:id/link`. */
export class LinkEmailReceiptDto {
  @ApiProperty({ description: "The transaction this email paid for." })
  @IsUUID()
  transactionId: string;
}
