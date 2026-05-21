import { IsEmail, IsString, MaxLength } from "class-validator";
import { SanitizeHtml } from "../../common/decorators/sanitize-html.decorator";

export class UpsertContactDto {
  @IsString()
  @MaxLength(100)
  @SanitizeHtml()
  firstName: string;

  @IsEmail()
  @MaxLength(255)
  email: string;
}
