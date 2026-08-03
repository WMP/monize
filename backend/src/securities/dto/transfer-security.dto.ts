import { ApiProperty } from "@nestjs/swagger";
import {
  IsString,
  IsOptional,
  IsNumber,
  IsUUID,
  IsDateString,
  Min,
  MaxLength,
} from "class-validator";
import { SanitizeHtml } from "../../common/decorators/sanitize-html.decorator";

export class TransferSecurityDto {
  @ApiProperty({
    description: "Investment account the shares are moving out of",
  })
  @IsUUID()
  fromAccountId: string;

  @ApiProperty({ description: "Investment account the shares are moving into" })
  @IsUUID()
  toAccountId: string;

  @ApiProperty({ description: "Security being transferred" })
  @IsUUID()
  securityId: string;

  @ApiProperty({ description: "Transfer date (YYYY-MM-DD)" })
  @IsDateString()
  transactionDate: string;

  @ApiProperty({ description: "Number of shares to transfer" })
  @IsNumber({ maxDecimalPlaces: 8 })
  @Min(0.00000001)
  quantity: number;

  @ApiProperty({
    description:
      "Per-share cost basis carried to the destination account. Defaults (client-side) to the source holding's average cost so gain/profit reporting is preserved.",
  })
  @IsNumber({ maxDecimalPlaces: 10 })
  @Min(0)
  costPerShare: number;

  @ApiProperty({
    required: false,
    description:
      "Rate converting the security's currency into the DESTINATION account's settlement currency on the transfer date. Omitted, the stored/market rate for that date is used; the transfer is refused when neither is available, because 1 would claim the two currencies are at par. Ignored when the two currencies match.",
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 10 })
  @Min(0.000001)
  destinationExchangeRate?: number;

  @ApiProperty({ required: false, description: "Description of the transfer" })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @SanitizeHtml()
  description?: string;
}
