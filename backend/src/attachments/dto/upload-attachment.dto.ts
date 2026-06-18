import { ApiProperty } from "@nestjs/swagger";
import { IsString, MaxLength, MinLength } from "class-validator";
import { SanitizeHtml } from "../../common/decorators/sanitize-html.decorator";

/**
 * Chat attachment upload. The file is sent base64-encoded inside JSON (no
 * multipart dependency); the global 10 MB body limit caps the effective file
 * size. The server decodes, validates the MIME type and decoded size, and
 * stores the bytes via the configured storage provider.
 */
export class UploadAttachmentDto {
  @ApiProperty({ description: "Original file name", example: "receipt.pdf" })
  @IsString()
  @MaxLength(255)
  @SanitizeHtml()
  fileName: string;

  @ApiProperty({ description: "File MIME type", example: "application/pdf" })
  @IsString()
  @MaxLength(150)
  mimeType: string;

  @ApiProperty({ description: "Base64-encoded file contents" })
  @IsString()
  @MinLength(1)
  // ~13.4 MB of base64 ≈ 10 MB of bytes; the body limit is the real ceiling.
  @MaxLength(14_000_000)
  dataBase64: string;
}
