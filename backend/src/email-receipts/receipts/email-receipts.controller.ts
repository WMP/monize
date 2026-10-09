import {
  Body,
  Controller,
  Delete,
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
import { AuthGuard } from "@nestjs/passport";
import { Throttle } from "@nestjs/throttler";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { OwnerOnly } from "../../delegation/decorators/delegate-access.decorator";
import { EmailReceiptAiService } from "../ai/email-receipt-ai.service";
import {
  AskAiEmailReceiptDto,
  EmailReceiptStatusCountsDto,
  ListEmailReceiptDomainsDto,
  LinkEmailReceiptDto,
  ListEmailReceiptsDto,
  ProcessBatchEmailReceiptsDto,
} from "./dto/email-receipts.dto";
import { EmailReceiptsService } from "./email-receipts.service";

/**
 * The stored order-confirmation emails (design sections 6 and 8): the list, one
 * email, and what a person does with it. Owner-only: a delegate ("acting as")
 * session is refused on every route, since an email and its proposal belong to
 * the owner alone. `userId` is the JWT's, never the request's.
 *
 * `email-receipts/mailbox` is the mailbox controller's and is registered first
 * in the module, so `:id` (a UUID, by `ParseUUIDPipe`) never sees it.
 */
@ApiTags("Email Receipts")
@Controller("email-receipts")
@UseGuards(AuthGuard("jwt"))
@OwnerOnly()
@ApiBearerAuth()
export class EmailReceiptsController {
  constructor(
    private readonly receipts: EmailReceiptsService,
    private readonly ai: EmailReceiptAiService,
  ) {}

  @Get()
  @ApiOperation({
    summary: "List my stored emails, newest first (no text), with their state",
  })
  list(
    @Request() req: { user: { id: string } },
    @Query() query: ListEmailReceiptsDto,
  ) {
    return this.receipts.list(req.user.id, {
      status: query.status,
      domain: query.domain,
      limit: query.limit,
    });
  }

  // Declared before `:id`, so the literal segment is matched first.
  @Get("domains")
  @ApiOperation({
    summary:
      "The sender domains of my stored emails with their counts, most first (at most 200); `status` keeps only the emails in that state",
  })
  domains(
    @Request() req: { user: { id: string } },
    @Query() query: ListEmailReceiptDomainsDto,
  ) {
    return this.receipts.listDomains(req.user.id, { status: query.status });
  }

  // Declared before `:id`, so the literal segment is matched first.
  @Get("domains/uncovered")
  @ApiOperation({
    summary:
      "The sender domains of my stored emails that no approved profile covers, with their counts and the draft profile for each, if any (at most 200)",
  })
  uncoveredDomains(@Request() req: { user: { id: string } }) {
    return this.receipts.listUncoveredDomains(req.user.id);
  }

  // Declared before `:id`, so the literal segment is matched first.
  @Get("status-counts")
  @ApiOperation({
    summary:
      "How many of my stored emails are in each state, optionally only from one sender domain",
  })
  statusCounts(
    @Request() req: { user: { id: string } },
    @Query() query: EmailReceiptStatusCountsDto,
  ) {
    return this.receipts.statusCounts(req.user.id, { domain: query.domain });
  }

  // Declared before `:id`, so the literal segment is matched first.
  @Get("overview")
  @ApiOperation({
    summary:
      "What the Email receipts hub's Overview shows: the mailbox, the emails by status, the profiles, the proposals to approve (one query)",
  })
  overview(@Request() req: { user: { id: string } }) {
    return this.receipts.overview(req.user.id);
  }

  @Post("process-batch")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  @ApiOperation({
    summary:
      "Run the pipeline over up to `limit` emails in the given statuses, oldest first, one after the other; answers where they ended and how many are left",
  })
  processBatch(
    @Request() req: { user: { id: string } },
    @Body() dto: ProcessBatchEmailReceiptsDto,
  ) {
    return this.receipts.processBatch(req.user.id, {
      domain: dto.domain,
      statuses: dto.statuses,
      limit: dto.limit,
      since: dto.since,
    });
  }

  @Get(":id")
  @ApiOperation({
    summary:
      "One stored email with its text, what the parser read and the candidates",
  })
  get(
    @Request() req: { user: { id: string } },
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.receipts.get(req.user.id, id);
  }

  @Post(":id/reprocess")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  @ApiOperation({ summary: "Run an email through the pipeline again" })
  reprocess(
    @Request() req: { user: { id: string } },
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.receipts.reprocess(req.user.id, id);
  }

  @Post(":id/link")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  @ApiOperation({ summary: "Link an email to the transaction it paid for" })
  link(
    @Request() req: { user: { id: string } },
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: LinkEmailReceiptDto,
  ) {
    return this.receipts.link(req.user.id, id, dto.transactionId);
  }

  @Post(":id/ignore")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Ignore an email: it proposes nothing" })
  ignore(
    @Request() req: { user: { id: string } },
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.receipts.ignore(req.user.id, id);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: "Delete a stored email and dismiss its open request",
  })
  async remove(
    @Request() req: { user: { id: string } },
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.receipts.remove(req.user.id, id);
  }

  @Post(":id/ask-ai")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({
    summary:
      "Queue an AI review request for the email's transaction (optionally a chosen one); the assistant in the chat answers it",
  })
  askAi(
    @Request() req: { user: { id: string } },
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: AskAiEmailReceiptDto,
  ) {
    return this.ai.askAi(req.user.id, id, dto.transactionId || null);
  }
}
