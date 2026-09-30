import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  Request,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { Throttle } from "@nestjs/throttler";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { OwnerOnly } from "../../delegation/decorators/delegate-access.decorator";
import {
  TestEmailReceiptMailboxDto,
  UpsertEmailReceiptMailboxDto,
} from "./dto/upsert-email-receipt-mailbox.dto";
import { EmailReceiptMailboxService } from "./email-receipt-mailbox.service";

/**
 * The settings of the user's receipts mailbox (design sections 3 and 8): read,
 * replace, delete and test. Owner-only: a delegate ("acting as") session is
 * refused on every route, since the mailbox is the owner's own credential.
 * `userId` is the JWT's. The password is accepted on the way in and never
 * returned (INV-RECEIPT-005).
 */
@ApiTags("Email Receipts")
@Controller("email-receipts/mailbox")
@UseGuards(AuthGuard("jwt"))
@OwnerOnly()
@ApiBearerAuth()
export class EmailReceiptMailboxController {
  constructor(private readonly mailbox: EmailReceiptMailboxService) {}

  @Get()
  @ApiOperation({
    summary: "Get my receipts mailbox settings (an empty body when none)",
  })
  get(@Request() req: { user: { id: string } }) {
    return this.mailbox.getView(req.user.id);
  }

  @Put()
  @ApiOperation({
    summary:
      "Create or replace my receipts mailbox. The password is write-only.",
  })
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  upsert(
    @Request() req: { user: { id: string } },
    @Body() dto: UpsertEmailReceiptMailboxDto,
  ) {
    return this.mailbox.upsert(req.user.id, dto);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Delete my receipts mailbox and its stored emails" })
  async remove(@Request() req: { user: { id: string } }): Promise<void> {
    await this.mailbox.remove(req.user.id);
  }

  @Post("test")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Test a connection to the mailbox without saving (the stored settings, or a draft)",
  })
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  test(
    @Request() req: { user: { id: string } },
    @Body() dto: TestEmailReceiptMailboxDto,
  ) {
    return this.mailbox.testConnection(req.user.id, dto);
  }
}
