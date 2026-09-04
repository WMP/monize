import { ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import { GOOGLE_PLACES_CAP } from "../google-places/google-places-cap";

/**
 * What the Payee lookup settings card may change.
 *
 * Every field is optional and absence means "leave it alone", which is what
 * lets the card save the on/off switch without resending a key it cannot read
 * back. `apiKey: ""` is the one meaningful empty string: it clears the stored
 * key. There is no `@ValidateIf` needed for it because it carries no format
 * validator -- an API key's shape is Google's business, and the only honest
 * test of one is the Test button, which asks Google.
 *
 * The cap bounds come from `GOOGLE_PLACES_CAP`, the same constant the CHECK
 * constraint in migration 188 and the settings form derive from.
 */
export class UpdatePayeeLookupSettingsDto {
  @ApiPropertyOptional({
    description: "Whether Google Places answers payee contact lookups",
  })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({
    description:
      "Google Places API key. Empty string removes the stored key; omit to keep it. Never returned.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  apiKey?: string;

  @ApiPropertyOptional({ description: "Whether the monthly cap is enforced" })
  @IsOptional()
  @IsBoolean()
  capEnabled?: boolean;

  @ApiPropertyOptional({
    description: "Requests allowed per calendar month",
    minimum: GOOGLE_PLACES_CAP.min,
    maximum: GOOGLE_PLACES_CAP.max,
    default: GOOGLE_PLACES_CAP.default,
  })
  @IsOptional()
  @IsInt()
  @Min(GOOGLE_PLACES_CAP.min)
  @Max(GOOGLE_PLACES_CAP.max)
  monthlyCap?: number;
}

/** The draft key the Test button checks, when the user has typed a new one. */
export class TestPayeeLookupKeyDto {
  @ApiPropertyOptional({
    description:
      "Key to test. Omit to test the key already stored (or the operator's).",
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  apiKey?: string;
}
