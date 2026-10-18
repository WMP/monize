import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Request,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "@nestjs/passport";
import { OwnerOnly } from "../delegation/decorators/delegate-access.decorator";
import { AiReviewWorkService } from "./ai-review-work.service";
import { ListAiReviewRequestsDto } from "./dto/list-ai-review-requests.dto";
import { ReopenAiReviewBatchDto } from "./dto/reopen-ai-review-batch.dto";

/**
 * The review inbox (design 6.5): the user's AI review requests with the
 * transaction each is about and, when an agent has proposed an edit, the
 * confirmation card. Approval is not here -- the card is committed through
 * `POST /ai/actions/confirm`, which marks the request applied in the same
 * transaction as the edit. Owner-only: a delegate ("acting as") session is
 * refused on every route. `userId` is the JWT's.
 */
@ApiTags("AI Review")
@Controller("ai-review-requests")
@UseGuards(AuthGuard("jwt"))
@OwnerOnly()
@ApiBearerAuth()
export class AiReviewRequestsController {
  constructor(private readonly work: AiReviewWorkService) {}

  @Get()
  @ApiOperation({ summary: "List my AI review requests, newest first" })
  list(
    @Request() req: { user: { id: string } },
    @Query() query: ListAiReviewRequestsDto,
  ) {
    return this.work.listInbox(req.user.id, {
      status: query.status,
      limit: query.limit,
    });
  }

  @Post(":id/dismiss")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Dismiss an open AI review request" })
  dismiss(
    @Request() req: { user: { id: string } },
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.work.dismiss(req.user.id, id);
  }

  @Post("reopen-batch")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Send closed AI review requests again: by id, or every one the AI provider did not answer",
  })
  reopenBatch(
    @Request() req: { user: { id: string } },
    @Body() dto: ReopenAiReviewBatchDto,
  ) {
    return this.work.reopenMany(req.user.id, {
      ids: dto.ids,
      preset: dto.preset,
    });
  }

  @Post(":id/reopen")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Send one closed AI review request again (404 when it is not mine, 409 with the reason when it cannot be)",
  })
  reopen(
    @Request() req: { user: { id: string } },
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.work.reopenOne(req.user.id, id);
  }
}
