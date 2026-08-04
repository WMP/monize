import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  UseGuards,
  Request,
  Res,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
} from "@nestjs/swagger";
import { Response } from "express";
import { BackupService } from "./backup.service";
import { BackupEncryptionService } from "./backup-encryption.service";
import { SupportBackupService } from "./support-backup/support-backup.service";
import { CreateSupportBackupDto } from "./support-backup/dto/create-support-backup.dto";
import { SetBackupPasswordDto } from "./dto/backup-encryption.dto";
import { DemoRestricted } from "../common/decorators/demo-restricted.decorator";
import { tr } from "../i18n/translate";

// Password header values are base64-encoded by the client so leading/trailing
// whitespace (and non-ASCII characters) survive HTTP header transport, which
// otherwise strips surrounding whitespace per RFC 7230. Decode them back to the
// exact password the user typed before any credential comparison or decryption.
function decodePasswordHeader(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return Buffer.from(value, "base64").toString("utf8");
}

/**
 * Manual export, restore and backup encryption -- everything here acts on the
 * caller's own data and is open to every signed-in user. Automatic backup
 * configuration is an operator concern and lives on the admin-only
 * `AutoBackupController`.
 */
@ApiTags("Backup")
@Controller("backup")
@UseGuards(AuthGuard("jwt"))
@ApiBearerAuth()
export class BackupController {
  constructor(
    private readonly backupService: BackupService,
    private readonly backupEncryption: BackupEncryptionService,
    private readonly supportBackupService: SupportBackupService,
  ) {}

  /** Download headers shared by the plain and support export endpoints, so
   *  the filename/content-type convention lives in one place. */
  private setBackupDownloadHeaders(
    res: Response,
    encrypted: boolean,
    prefix: string,
  ): void {
    const today = new Date().toISOString().slice(0, 10);
    const filename = `${prefix}-${today}.${encrypted ? "mzbe" : "json.gz"}`;
    res.setHeader(
      "Content-Type",
      encrypted ? "application/octet-stream" : "application/gzip",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  }

  @Post("export")
  @DemoRestricted()
  @ApiOperation({ summary: "Export all user data as JSON backup" })
  @ApiResponse({ status: 200, description: "Backup file downloaded" })
  async exportBackup(@Request() req, @Res() res: Response) {
    // Encryption password (when encryption is enabled) comes via header so the
    // browser can issue a plain GET-like POST without a body parser dependency
    // and so it never lands in server access logs as a query string.
    const encryptionPassword = decodePasswordHeader(
      req.headers["x-export-password"] as string | undefined,
    );

    this.setBackupDownloadHeaders(res, !!encryptionPassword, "monize-backup");
    await this.backupService.streamExport(req.user.id, res, encryptionPassword);
  }

  @Post("support-export")
  @DemoRestricted()
  @ApiOperation({
    summary:
      "Export a de-identified backup for sharing with support (masked text, scaled amounts)",
  })
  @ApiResponse({ status: 200, description: "De-identified backup downloaded" })
  async supportExport(
    @Request() req,
    @Body() dto: CreateSupportBackupDto,
    @Res() res: Response,
  ) {
    const { buffer, encrypted } = await this.supportBackupService.generate(
      req.user.id,
      dto,
    );
    this.setBackupDownloadHeaders(res, encrypted, "monize-support-backup");
    res.send(buffer);
  }

  @Post("support-export/preview")
  @DemoRestricted()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Preview the de-identified backup: before/after samples of key tables",
  })
  @ApiResponse({ status: 200, description: "Preview samples returned" })
  async supportExportPreview(
    @Request() req,
    @Body() dto: CreateSupportBackupDto,
  ) {
    return this.supportBackupService.preview(req.user.id, dto);
  }

  @Post("restore")
  @DemoRestricted()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Restore user data from a backup file (gzipped JSON or encrypted Monize backup)",
  })
  @ApiResponse({ status: 200, description: "Data restored successfully" })
  @ApiResponse({ status: 401, description: "Invalid credentials" })
  @ApiResponse({ status: 400, description: "Invalid backup format" })
  async restoreBackup(@Request() req) {
    const body: unknown = req.body;
    // CodeQL js/type-confusion-through-parameter-tampering doesn't model
    // Buffer.isBuffer as a type guard. Explicit typeof / Array.isArray
    // narrowing rejects the string and array forms body-parser can produce.
    if (
      typeof body === "string" ||
      Array.isArray(body) ||
      !Buffer.isBuffer(body) ||
      body.length === 0
    ) {
      throw new BadRequestException(
        tr(
          "errors.backup.restoreBodyMustBeFile",
          "Request body must be a backup file",
        ),
      );
    }

    const password = decodePasswordHeader(
      req.headers["x-restore-password"] as string | undefined,
    );
    const oidcIdToken = req.headers["x-restore-oidc-token"] as
      | string
      | undefined;
    const backupPassword = decodePasswordHeader(
      req.headers["x-backup-password"] as string | undefined,
    );

    const result = await this.backupService.restoreData(req.user.id, {
      compressedData: body,
      password,
      oidcIdToken,
      backupPassword,
    });
    return result;
  }

  @Get("encryption")
  @ApiOperation({ summary: "Get backup encryption status for current user" })
  @ApiResponse({ status: 200, description: "Encryption status returned" })
  async getEncryptionStatus(@Request() req) {
    return this.backupEncryption.getStatus(req.user.id);
  }

  @Post("encryption/backup-password")
  @DemoRestricted()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Set or update the dedicated backup password (OIDC users only; local users' backups are encrypted with their login password automatically)",
  })
  @ApiResponse({ status: 200, description: "Backup password set" })
  async setBackupPassword(@Request() req, @Body() dto: SetBackupPasswordDto) {
    await this.backupEncryption.setBackupPasswordForOidcUser(
      req.user.id,
      dto.backupPassword,
    );
    return { enabled: true };
  }

  @Delete("encryption")
  @DemoRestricted()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Disable encrypted backups (OIDC users only)" })
  @ApiResponse({ status: 200, description: "Encryption disabled" })
  async disableEncryption(@Request() req) {
    await this.backupEncryption.disableForOidcUser(req.user.id);
    return { enabled: false };
  }
}
