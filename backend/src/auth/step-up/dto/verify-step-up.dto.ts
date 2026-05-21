import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

/**
 * Purposes for which a step-up token can be issued. Adding a new sensitive
 * surface means adding a new value here and decorating its handlers with
 * `@RequireStepUp(purpose)`.
 */
export const STEP_UP_PURPOSES = ["emergency-access"] as const;
export type StepUpPurpose = (typeof STEP_UP_PURPOSES)[number];

export class VerifyStepUpDto {
  @ApiProperty({
    description: "Sensitive surface this step-up token will unlock",
    enum: STEP_UP_PURPOSES,
  })
  @IsString()
  @IsIn(STEP_UP_PURPOSES as unknown as string[])
  purpose: StepUpPurpose;

  @ApiProperty({
    description: "Current account password (local users without 2FA)",
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  password?: string;

  @ApiProperty({
    description: "6-digit TOTP code (users with 2FA enabled)",
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(6)
  @Matches(/^\d{6}$/, { message: "TOTP code must be 6 digits" })
  totpCode?: string;
}
