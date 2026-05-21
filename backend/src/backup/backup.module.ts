import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ConfigModule } from "@nestjs/config";
import { BackupController } from "./backup.controller";
import { BackupService } from "./backup.service";
import { AutoBackupService } from "./auto-backup.service";
import { BackupEncryptionService } from "./backup-encryption.service";
import { User } from "../users/entities/user.entity";
import { AutoBackupSettings } from "./entities/auto-backup-settings.entity";
import { AuthModule } from "../auth/auth.module";
import { AiEncryptionService } from "../ai/ai-encryption.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([User, AutoBackupSettings]),
    AuthModule,
    ConfigModule,
  ],
  controllers: [BackupController],
  providers: [
    BackupService,
    AutoBackupService,
    BackupEncryptionService,
    AiEncryptionService,
  ],
  exports: [BackupEncryptionService],
})
export class BackupModule {}
