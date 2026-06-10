import { ApiProperty } from "@nestjs/swagger";
import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from "class-validator";

export type PayeeOrganizerMode = "all" | "merge";

export class SuggestPayeeOrganizationDto {
  @ApiProperty({
    example: false,
    description:
      "When true, the AI may propose creating brand-new categories for payees that do not fit any existing category. When false, the AI must only map to existing categories.",
  })
  @IsBoolean()
  allowNewCategories: boolean;

  @ApiProperty({
    required: false,
    example: 50,
    description:
      "Maximum number of uncategorized payees to analyse in this run. Keep it small (e.g. 50) when the configured AI provider has a low tokens-per-minute limit, then run again for the next slice. Defaults to 50; capped server-side at 300.",
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(300)
  limit?: number;

  @ApiProperty({
    required: false,
    enum: ["all", "merge"],
    example: "all",
    description:
      "'all' (default) suggests categories and detects duplicates. 'merge' only detects duplicate payees to merge — it skips category suggestions, which makes the prompt much smaller (no category list) and cheaper on token-limited providers.",
  })
  @IsOptional()
  @IsIn(["all", "merge"])
  mode?: PayeeOrganizerMode;

  @ApiProperty({
    required: false,
    example: 0,
    description:
      "Only suggest categories for payees with at least this many transactions (0 = no minimum). Lets you focus on frequently-used payees and skip one-off entries. Applies to category suggestions only.",
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  minTransactions?: number;
}
