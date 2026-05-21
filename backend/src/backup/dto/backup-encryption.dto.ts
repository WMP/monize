import { ApiProperty } from "@nestjs/swagger";
import { IsString, MinLength, MaxLength } from "class-validator";

export class EnableLocalEncryptionDto {
  @ApiProperty({ description: "Current login password" })
  @IsString()
  @MinLength(1)
  @MaxLength(1024)
  password: string;
}

export class SetBackupPasswordDto {
  @ApiProperty({ description: "Backup password (used to encrypt backups)" })
  @IsString()
  @MinLength(12)
  @MaxLength(1024)
  backupPassword: string;
}

export class ExportBackupDto {
  @ApiProperty({
    description:
      "Password used to encrypt the export. For local users this is normally their login password; for OIDC users it's the dedicated backup password set in Security. Required when backup_encryption_enabled is true on this user.",
    required: false,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(1024)
  password?: string;
}
