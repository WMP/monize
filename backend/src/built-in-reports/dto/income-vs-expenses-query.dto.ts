import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import { ReportQueryDto } from "./report-query.dto";

/** A comma-separated query parameter, as a trimmed non-empty array. */
export function csv({ value }: { value: unknown }): unknown {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return value;
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** Surrounding whitespace is a paste artifact, never part of a tag key. */
const trimmed = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;

/**
 * Income vs Expenses is the one answer the full report and the dashboard widget
 * both draw, so the settings the widget carried on the client -- which
 * accounts, and how wide a bar is -- are asked of the server instead of applied
 * to its answer.
 */
export class IncomeVsExpensesQueryDto extends ReportQueryDto {
  @ApiPropertyOptional({
    description: "Account ids to restrict the report to (comma-separated)",
    type: [String],
  })
  @IsOptional()
  @Transform(csv)
  @IsArray()
  // Bounded because an unbounded array is a lever on the query planner, and
  // `common/array-bound-dto.spec.ts` fails a new one without a cap.
  @ArrayMaxSize(200)
  @IsUUID("4", { each: true })
  accountIds?: string[];

  @ApiPropertyOptional({
    description: "Width of one bar. Defaults to month.",
    enum: ["month", "week"],
  })
  @IsOptional()
  @IsIn(["month", "week"])
  bucket?: "month" | "week";

  @ApiPropertyOptional({
    description:
      "Day a week bucket starts on, 0 = Sunday through 6 = Saturday. Defaults to Monday.",
  })
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? value : Number(value)))
  @IsInt()
  @Min(0)
  @Max(6)
  weekStartsOn?: number;

  /**
   * Bare KEY of a `KEY:VALUE` tag (e.g. "scope") to partition the report by
   * (`docs/specs/report-tag-key-breakdown.md`). Absent -> today's response,
   * byte-for-byte unchanged. Present -> the response additionally carries
   * `tagKey` and `buckets`, one per discovered value plus the reserved
   * untagged bucket. Never a value list -- the server discovers the values
   * itself, the client never asserts them.
   */
  @ApiPropertyOptional({
    description:
      "Bare KEY of a KEY:VALUE tag to break the report down by (e.g. 'scope'). Absent renders today's response unchanged.",
  })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(100)
  tagKey?: string;
}
