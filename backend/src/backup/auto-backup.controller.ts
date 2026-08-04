import {
  Controller,
  Get,
  Patch,
  Post,
  Body,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
} from "@nestjs/swagger";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { AutoBackupService } from "./auto-backup.service";
import {
  UpdateAutoBackupSettingsDto,
  ValidateFolderDto,
} from "./dto/update-auto-backup-settings.dto";
import { DemoRestricted } from "../common/decorators/demo-restricted.decorator";

/**
 * Automatic backup configuration -- administrators only.
 *
 * The settings decide where files are written on the server's filesystem and
 * how much disk they take, which is an operator's decision rather than an
 * account preference; every non-admin user is enrolled on the deployment
 * defaults by `AutoBackupService.enrollManagedUsers` instead, and never sees
 * this section. The guards are on the class rather than on each handler so an
 * endpoint added here is admin-only by default.
 *
 * Manual export/restore, which touches only the caller's own data, stays open
 * to everyone on `BackupController`.
 */
@ApiTags("Backup")
@Controller("backup")
@UseGuards(AuthGuard("jwt"), RolesGuard)
@Roles("admin")
@ApiBearerAuth()
export class AutoBackupController {
  constructor(private readonly autoBackupService: AutoBackupService) {}

  @Get("auto-backup-settings")
  @ApiOperation({ summary: "Get automatic backup settings (admin only)" })
  @ApiResponse({ status: 200, description: "Auto-backup settings returned" })
  async getAutoBackupSettings(@Request() req) {
    return this.autoBackupService.getSettings(req.user.id);
  }

  @Patch("auto-backup-settings")
  @DemoRestricted()
  @ApiOperation({ summary: "Update automatic backup settings (admin only)" })
  @ApiResponse({ status: 200, description: "Settings updated" })
  async updateAutoBackupSettings(
    @Request() req,
    @Body() dto: UpdateAutoBackupSettingsDto,
  ) {
    return this.autoBackupService.updateSettings(req.user.id, dto);
  }

  @Post("validate-folder")
  @DemoRestricted()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Validate a folder path is writable (admin only)" })
  @ApiResponse({ status: 200, description: "Validation result" })
  async validateFolder(@Body() dto: ValidateFolderDto) {
    return this.autoBackupService.validateFolder(dto.folderPath);
  }

  @Post("browse-folders")
  @DemoRestricted()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "List subdirectories in a folder (admin only)" })
  @ApiResponse({ status: 200, description: "Directory listing" })
  async browseFolders(@Body() dto: ValidateFolderDto) {
    return this.autoBackupService.browseFolders(dto.folderPath);
  }

  @Post("run-auto-backup")
  @DemoRestricted()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Trigger an immediate automatic backup (admin only)",
  })
  @ApiResponse({ status: 200, description: "Backup completed" })
  async runAutoBackup(@Request() req) {
    return this.autoBackupService.runManualBackup(req.user.id);
  }
}
