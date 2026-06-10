import { ApiProperty } from "@nestjs/swagger";
import { IsString, MaxLength } from "class-validator";

// Broker order-history dumps pasted as HTML can be large (many orders, verbose
// markup). Keep the cap generous but bounded so a single request cannot exhaust
// memory or the provider's context window.
const MAX_HTML_LENGTH = 1_000_000;

export class ParseBrokerImportDto {
  @ApiProperty({
    description:
      "Raw HTML of the brokerage account's order history, as pasted by the user.",
  })
  @IsString()
  @MaxLength(MAX_HTML_LENGTH)
  html: string;
}
