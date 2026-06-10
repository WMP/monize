import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  IsDateString,
  Min,
  MaxLength,
  ArrayMaxSize,
  ValidateNested,
} from "class-validator";
import { SanitizeHtml } from "../../../common/decorators/sanitize-html.decorator";

export class NewSecurityDto {
  @ApiProperty({
    description:
      "Ticker/symbol for the new security. Broker history has no ticker, so the user supplies one. Must be unique per user.",
    example: "ACWI",
  })
  @IsString()
  @MaxLength(20)
  @SanitizeHtml()
  symbol: string;

  @ApiProperty({
    description: "Full security name",
    example: "iShares MSCI ACWI UCITS ETF",
  })
  @IsString()
  @MaxLength(255)
  @SanitizeHtml()
  name: string;

  @ApiPropertyOptional({ description: "Exchange/market", example: "Xetra" })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  @SanitizeHtml()
  exchange?: string;

  @ApiProperty({ description: "Currency code", example: "EUR" })
  @IsString()
  @MaxLength(10)
  @SanitizeHtml()
  currency: string;

  @ApiPropertyOptional({ description: "Security type", example: "ETF" })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  @SanitizeHtml()
  type?: string;
}

export class ApplyBrokerImportOrderDto {
  @ApiPropertyOptional({
    description:
      "Existing security to use for this order. Mutually exclusive with newSecurity; one of the two is required.",
  })
  @IsOptional()
  @IsUUID()
  securityId?: string;

  @ApiPropertyOptional({
    description:
      "Definition of a new security to create for this order. Mutually exclusive with securityId.",
    type: NewSecurityDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => NewSecurityDto)
  newSecurity?: NewSecurityDto;

  @ApiProperty({ enum: ["BUY", "SELL"] })
  @IsIn(["BUY", "SELL"])
  side: "BUY" | "SELL";

  @ApiProperty({ description: "Number of shares", example: 3 })
  @IsNumber({ maxDecimalPlaces: 8 })
  @Min(0)
  quantity: number;

  @ApiProperty({ description: "Price per share", example: 104.66 })
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0)
  price: number;

  @ApiProperty({ description: "Commission or fee", example: 0 })
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  commission: number;

  @ApiProperty({ description: "Instrument currency code", example: "EUR" })
  @IsString()
  @MaxLength(10)
  @SanitizeHtml()
  currency: string;

  @ApiProperty({
    description: "Trade date (YYYY-MM-DD)",
    example: "2026-06-05",
  })
  @IsDateString()
  tradeDate: string;
}

export class ApplyBrokerImportDto {
  @ApiProperty({
    description:
      "Investment/brokerage account the orders will be imported into.",
  })
  @IsUUID()
  accountId: string;

  @ApiProperty({ type: [ApplyBrokerImportOrderDto] })
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => ApplyBrokerImportOrderDto)
  orders: ApplyBrokerImportOrderDto[];
}
