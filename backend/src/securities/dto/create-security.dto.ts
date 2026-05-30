import { ApiProperty } from "@nestjs/swagger";
import {
  IsString,
  IsOptional,
  MaxLength,
  IsBoolean,
  IsIn,
} from "class-validator";
import { SanitizeHtml } from "../../common/decorators/sanitize-html.decorator";
import { IsCurrencyCode } from "../../common/validators/is-currency-code.validator";

export class CreateSecurityDto {
  @ApiProperty({ example: "AAPL", description: "Stock symbol or ticker" })
  @IsString()
  @MaxLength(20)
  @SanitizeHtml()
  symbol: string;

  @ApiProperty({
    example: "Apple Inc.",
    description: "Full name of the security",
  })
  @IsString()
  @MaxLength(255)
  @SanitizeHtml()
  name: string;

  @ApiProperty({
    example: "STOCK",
    description: "Type of security",
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  @SanitizeHtml()
  securityType?: string;

  @ApiProperty({
    example: "NASDAQ",
    description: "Stock exchange",
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  @SanitizeHtml()
  exchange?: string;

  @ApiProperty({ example: "USD", description: "Currency code" })
  @IsCurrencyCode()
  currencyCode: string;

  @ApiProperty({ example: true, required: false })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiProperty({
    example: false,
    description: "Pin to the dashboard Favourite Securities widget",
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  isFavourite?: boolean;

  @ApiProperty({
    example: "msn",
    description:
      "Per-security provider override; omit or null to use the user default",
    required: false,
    enum: ["yahoo", "msn"],
  })
  @IsOptional()
  @IsIn(["yahoo", "msn"])
  quoteProvider?: "yahoo" | "msn";

  @ApiProperty({
    example: "a1u3p2",
    description: "MSN Financial Instrument ID (advanced override)",
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  @SanitizeHtml()
  msnInstrumentId?: string;
}
