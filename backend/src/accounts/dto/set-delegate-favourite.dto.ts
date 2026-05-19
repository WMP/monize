import { ApiProperty } from "@nestjs/swagger";
import { IsBoolean } from "class-validator";

export class SetDelegateFavouriteDto {
  @ApiProperty({
    example: true,
    description: "Whether the acting delegate marks this account a favourite",
  })
  @IsBoolean()
  isFavourite: boolean;
}
