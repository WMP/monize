import {
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { SanitizeHtml } from "../../../common/decorators/sanitize-html.decorator";

class RelayMessageDto {
  @IsIn(["user", "assistant"])
  role: "user" | "assistant";

  @IsString()
  @MaxLength(50000)
  content: string;
}

/**
 * A prompt routed to the user's MCP agent via the relay. Mirrors AiQueryDto but
 * allows a much longer prompt: unlike the server-side LLM path (capped at 2000
 * to bound provider token cost), relay prompts often carry pasted content
 * (tables, logs) and are handled by the user's own agent, so 50000 matches the
 * message-content and post_response limits.
 */
export class RelayQueryDto {
  @IsString()
  @MaxLength(50000)
  @IsNotEmpty()
  @SanitizeHtml()
  query: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RelayMessageDto)
  conversationHistory?: RelayMessageDto[];
}
