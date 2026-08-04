import { IsOptional, IsString, MaxLength } from "class-validator";
import { ApiPropertyOptional } from "@nestjs/swagger";

export class ApplyScheduledPaymentDto {
  @ApiPropertyOptional({
    description:
      "SHA-256 hex hash returned by the create endpoint alongside the preview. When supplied, the confirmation is rejected if the freshly computed preview hash differs, preventing a stale preview from being applied without the user's knowledge.",
    example:
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  expectedPreviewHash?: string;
}
