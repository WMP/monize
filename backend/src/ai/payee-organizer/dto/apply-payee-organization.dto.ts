import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ArrayMaxSize,
  ValidateNested,
} from "class-validator";
import { SanitizeHtml } from "../../../common/decorators/sanitize-html.decorator";

export class CategoryAssignmentDto {
  @ApiProperty({ description: "ID of the payee to categorize" })
  @IsUUID()
  payeeId: string;

  @ApiPropertyOptional({
    description:
      "ID of an existing category to assign. Mutually exclusive with newCategoryName.",
  })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({
    description:
      "Name of a new category to create and assign. Mutually exclusive with categoryId.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @SanitizeHtml()
  newCategoryName?: string;
}

export class PayeeMergeDto {
  @ApiProperty({
    description: "ID of the canonical payee that duplicates merge INTO",
  })
  @IsUUID()
  targetPayeeId: string;

  @ApiProperty({
    description: "IDs of the duplicate payees that will be merged and deleted",
    type: [String],
  })
  @IsArray()
  @ArrayMaxSize(1000)
  @IsUUID("4", { each: true })
  sourcePayeeIds: string[];
}

export class RejectedMergeDto {
  @ApiProperty({
    description:
      "ID of the canonical payee of a merge group the user marked NOT a duplicate",
  })
  @IsUUID()
  canonicalPayeeId: string;

  @ApiProperty({
    description:
      "IDs of the payees that are NOT duplicates of the canonical payee",
    type: [String],
  })
  @IsArray()
  @ArrayMaxSize(1000)
  @IsUUID("all", { each: true })
  duplicatePayeeIds: string[];
}

export class ApplyPayeeOrganizationDto {
  @ApiProperty({ type: [CategoryAssignmentDto] })
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => CategoryAssignmentDto)
  categoryAssignments: CategoryAssignmentDto[];

  @ApiProperty({ type: [PayeeMergeDto] })
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => PayeeMergeDto)
  merges: PayeeMergeDto[];

  @ApiPropertyOptional({
    type: [RejectedMergeDto],
    description:
      "Merge groups the user marked NOT a duplicate; persisted so they are never re-suggested",
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => RejectedMergeDto)
  rejectedMerges?: RejectedMergeDto[];
}
