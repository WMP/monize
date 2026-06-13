import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Query,
  Req,
  ParseUUIDPipe,
  UseGuards,
  HttpCode,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";
import { AiSuggestionSessionService } from "./ai-suggestion-session.service";
import { ApplySessionDto } from "./dto/apply-session.dto";
import { ListSessionsQueryDto } from "./dto/list-sessions.dto";

interface AuthedRequest {
  user: { id: string };
}

@ApiTags("ai-suggestion-sessions")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"))
@Controller("ai/suggestion-sessions")
export class AiSuggestionSessionController {
  constructor(private readonly service: AiSuggestionSessionService) {}

  @Get()
  listSessions(
    @Req() req: AuthedRequest,
    @Query() query: ListSessionsQueryDto,
  ) {
    return this.service.listSessions(req.user.id, {
      kind: query.kind,
      status: query.status,
    });
  }

  @Get(":id")
  getSession(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.service.getSession(req.user.id, id);
  }

  @Post(":id/apply")
  @HttpCode(200)
  applySession(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ApplySessionDto,
  ) {
    return this.service.applySession(req.user.id, id, { items: dto.items });
  }

  @Delete(":id")
  @HttpCode(204)
  async discardSession(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.service.discardSession(req.user.id, id);
  }
}
