import { IsString, MaxLength, MinLength } from "class-validator";

export class ClaimPreviewDto {
  @IsString()
  @MinLength(16)
  @MaxLength(128)
  token: string;
}

export class ClaimCompleteDto {
  @IsString()
  @MinLength(16)
  @MaxLength(128)
  token: string;

  // Mirrors the password rules used by the rest of the auth surface.
  // The backend additionally checks against the breached-password service.
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  newPassword: string;
}
