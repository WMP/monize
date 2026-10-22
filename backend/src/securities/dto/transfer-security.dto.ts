import { ApiProperty } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  IsString,
  IsOptional,
  IsNumber,
  IsUUID,
  ValidateIf,
  IsDateString,
  Min,
  MaxLength,
} from "class-validator";
import { SanitizeHtml } from "../../common/decorators/sanitize-html.decorator";
import { TRANSACTION_NOTE_MAX_LENGTH } from "../../common/transaction-note";

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

  @ApiProperty({ required: false, description: "Description of the transfer" })
  @IsOptional()
  @IsString()
  @MaxLength(TRANSACTION_NOTE_MAX_LENGTH)
  @SanitizeHtml()
  description?: string;

  @ApiProperty({
    required: false,
    nullable: true,
    format: "uuid",
    description:
      "The bond series (bond instrument id) a security transfer moves (both legs carry it). " +
      "An acquisition without one takes the program's series on sale on the transaction date; " +
      "a removal without one leaves first-in first-out across the account's series. " +
      "Refused for a security that is not linked to a bond program.",
  })
  // One canonical spelling (lower case) before anything compares or stores it.
  @Transform(({ value }) =>
    typeof value === "string" ? value.toLowerCase() : value,
  )
  @IsOptional()
  @ValidateIf((_o, value) => value !== null && value !== undefined)
  @IsUUID()
  bondInstrumentId?: string | null;
}
