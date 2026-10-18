import { ApiPropertyOptional } from "@nestjs/swagger";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsUUID,
  ValidateIf,
} from "class-validator";
import { AI_REVIEW_REOPEN_MAX } from "../ai-review-retry";

export const AI_REVIEW_REOPEN_PRESETS = ["provider_timeout"] as const;

/**
 * Body of `POST /ai-review-requests/reopen-batch`: exactly one of `ids` and
 * `preset`. Each field is checked unless the other one is the one given, so a
 * body with neither fails on `ids`; a body with both is refused by
 * `AiReviewWorkService.reopenMany` (400), the one place that decides it for the
 * REST route, the MCP tool and the assistant alike.
 */
export class ReopenAiReviewBatchDto {
  @ApiPropertyOptional({
    type: [String],
    minItems: 1,
    maxItems: AI_REVIEW_REOPEN_MAX,
    description:
      "The closed requests to send again. Each gets its own outcome (reopened, not_found, not_closed, kind_not_reopenable, open_exists, superseded).",
  })
  @ValidateIf((o: ReopenAiReviewBatchDto) => o.preset === undefined)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(AI_REVIEW_REOPEN_MAX)
  @IsUUID("all", { each: true })
  ids?: string[];

  @ApiPropertyOptional({
    enum: AI_REVIEW_REOPEN_PRESETS,
    description:
      "provider_timeout: every closed receipt request the AI provider did not answer (at most 500, newest first).",
  })
  @ValidateIf((o: ReopenAiReviewBatchDto) => o.ids === undefined)
  @IsIn(AI_REVIEW_REOPEN_PRESETS)
  preset?: (typeof AI_REVIEW_REOPEN_PRESETS)[number];
}
