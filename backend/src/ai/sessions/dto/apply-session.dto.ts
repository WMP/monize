import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
  ArrayMaxSize,
  ArrayMinSize,
} from "class-validator";
import { SanitizeHtml } from "../../../common/decorators/sanitize-html.decorator";

/**
 * A single payee-category assignment the user chose to apply from a draft
 * suggestion session. Exactly one of categoryId / newCategoryName should be
 * supplied; the service enforces that invariant.
 */
export class ApplySessionItemDto {
  @ApiProperty({ description: "Payee to categorize" })
  @IsUUID()
  payeeId: string;

  @ApiProperty({
    required: false,
    description: "Existing category to assign as the payee's default",
  })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiProperty({
    required: false,
    description: "Name of a new category to create and assign",
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @SanitizeHtml()
  newCategoryName?: string;
}

export class ApplySessionDto {
  @ApiProperty({
    type: [ApplySessionItemDto],
    description:
      "The subset of draft items the user chose to apply. Only these are applied -- never the whole draft blindly.",
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ApplySessionItemDto)
  items: ApplySessionItemDto[];
}
