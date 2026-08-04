import { ApiProperty } from "@nestjs/swagger";
import { IsString, MinLength, MaxLength } from "class-validator";

export class SetBackupPasswordDto {
  @ApiProperty({ description: "Backup password (used to encrypt backups)" })
  @IsString()
  @MinLength(12)
  @MaxLength(1024)
  backupPassword: string;
}
