import { ApiProperty } from "@nestjs/swagger";
import { IsBoolean } from "class-validator";

/** `PATCH /bank-sync/connections/:id`. */
export class UpdateBankSyncConnectionDto {
  @ApiProperty({ description: "Whether the daily sync reads this connection." })
  @IsBoolean()
  autoSync: boolean;
}
