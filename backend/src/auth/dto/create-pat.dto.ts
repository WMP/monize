import {
  IsString,
  IsNotEmpty,
  IsOptional,
  MaxLength,
  Matches,
  IsDateString,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsFutureDate } from "../../common/validators/is-future-date.validator";
import { SanitizeHtml } from "../../common/decorators/sanitize-html.decorator";
import { apiScopesList, apiScopesPattern } from "../scopes";

export class CreatePatDto {
  @ApiProperty({ description: "User-assigned label for the token" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @SanitizeHtml()
  name: string;

  // Pattern and message both derived from `API_SCOPES`: a scope named in the
  // schema comment or a feature plan but missing from the regex is exactly how
  // `reports` came to be documented and unissuable.
  @ApiPropertyOptional({
    description: `Comma-separated scopes: ${apiScopesList()}`,
    default: "read",
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Matches(apiScopesPattern(), {
    message: `Scopes must be comma-separated values of: ${apiScopesList()}`,
  })
  scopes?: string;

  @ApiPropertyOptional({ description: "Token expiration date (ISO 8601)" })
  @IsOptional()
  @IsDateString()
  @IsFutureDate({ message: "Expiration date must be in the future" })
  expiresAt?: string;
}
