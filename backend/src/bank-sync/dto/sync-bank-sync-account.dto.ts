import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, Matches, ValidateIf } from "class-validator";

/** A SHA-256 hex digest: what `planFingerprint` returns. */
export const PLAN_FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;

/**
 * `POST /bank-sync/accounts/:id/sync`. The body is optional. `planFingerprint`
 * is the one a preview returned: with it the write refuses (409), before it
 * writes anything, when the plan it is about to write is not the one shown
 * (spec section 7a).
 */
export class SyncBankSyncAccountDto {
  @ApiPropertyOptional({
    description: "The planFingerprint of the preview the user confirmed.",
    example: "0f".repeat(32),
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_o, value) => value !== null && value !== "")
  @IsString()
  @Matches(PLAN_FINGERPRINT_PATTERN, {
    message: "planFingerprint must be a lowercase SHA-256 hex digest",
  })
  planFingerprint?: string | null;
}
