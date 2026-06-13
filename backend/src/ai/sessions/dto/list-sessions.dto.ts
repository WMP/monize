import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional } from "class-validator";
import {
  SUGGESTION_SESSION_KINDS,
  SUGGESTION_SESSION_STATUSES,
  SuggestionSessionKind,
  SuggestionSessionStatus,
} from "../entities/ai-suggestion-session.entity";

export class ListSessionsQueryDto {
  @ApiPropertyOptional({ enum: SUGGESTION_SESSION_KINDS })
  @IsOptional()
  @IsIn(SUGGESTION_SESSION_KINDS as unknown as string[])
  kind?: SuggestionSessionKind;

  @ApiPropertyOptional({ enum: SUGGESTION_SESSION_STATUSES })
  @IsOptional()
  @IsIn(SUGGESTION_SESSION_STATUSES as unknown as string[])
  status?: SuggestionSessionStatus;
}
