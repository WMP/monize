import { IsOptional, IsString, MaxLength } from "class-validator";
import { SanitizeHtml } from "../../common/decorators/sanitize-html.decorator";

export class UpdateMessageDto {
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  @SanitizeHtml()
  message?: string | null;
}
