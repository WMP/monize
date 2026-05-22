import {
  IsEmail,
  IsOptional,
  IsString,
  IsBoolean,
  IsIn,
  MaxLength,
  MinLength,
  Matches,
} from "class-validator";

export class CreateUserDto {
  @IsEmail()
  @MaxLength(255)
  email: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;

  /**
   * Admin-chosen password for the new account. Mutually exclusive with
   * sendInvite. When neither is given, a temporary password is generated
   * and returned to the admin to share out-of-band.
   */
  @IsOptional()
  @IsString()
  @MinLength(12)
  @MaxLength(100)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d\s])/, {
    message:
      "Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character",
  })
  password?: string;

  /**
   * When true, create the account without a password and email the user an
   * invite link to set one (requires SMTP to be configured).
   */
  @IsOptional()
  @IsBoolean()
  sendInvite?: boolean;

  @IsOptional()
  @IsIn(["admin", "user"])
  role?: "admin" | "user";
}
