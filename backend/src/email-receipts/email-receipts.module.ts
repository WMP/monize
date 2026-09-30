import { Module } from "@nestjs/common";
import { AiModule } from "../ai/ai.module";
import { AiReviewModule } from "../ai-review/ai-review.module";
import { AiReviewQueueModule } from "../ai-review/ai-review-queue.module";
import { EncryptionModule } from "../common/encryption/encryption.module";
import { TransactionsModule } from "../transactions/transactions.module";
import { EmailReceiptAiService } from "./ai/email-receipt-ai.service";
import {
  ImapFlowMailboxClient,
  ImapMailboxClient,
} from "./imap/imap-mailbox-client";
import { EmailReceiptMailboxController } from "./mailbox/email-receipt-mailbox.controller";
import { EmailReceiptMailboxService } from "./mailbox/email-receipt-mailbox.service";
import { EmailReceiptParsersController } from "./parsers/email-receipt-parsers.controller";
import { EmailReceiptParsersService } from "./parsers/email-receipt-parsers.service";
import { EmailReceiptPipelineService } from "./pipeline/email-receipt-pipeline.service";
import { EmailReceiptPollService } from "./poll/email-receipt-poll.service";
import { EmailReceiptsController } from "./receipts/email-receipts.controller";
import { EmailReceiptsService } from "./receipts/email-receipts.service";

/**
 * Email receipts (docs/future-plans/email-receipts.md): a user's dedicated IMAP
 * mailbox is read, never written, and each order-confirmation email proposes an
 * enrichment of the bank transaction it pays for, through the AI review queue.
 *
 * `ImapMailboxClient` is bound to the real client here and is the one seam a
 * spec replaces to test a service without a network.
 *
 * The edge to the queue runs one way: this module imports `AiReviewModule`
 * (the requests), `AiReviewQueueModule` (`AiReviewWorkService`, the agents'
 * door a receipt's proposal goes through) and `AiModule` (`AiService` for the
 * drafts and `AiActionsService.confirm` for the opt-in auto-apply); none of them
 * imports this module, so no `forwardRef` is needed (`module-graph.spec.ts`).
 *
 * Controller order matters: `email-receipts/mailbox` is registered before
 * `email-receipts/:id`, so the literal segment is matched first.
 */
@Module({
  imports: [
    EncryptionModule,
    AiModule,
    AiReviewModule,
    AiReviewQueueModule,
    TransactionsModule,
  ],
  controllers: [
    EmailReceiptMailboxController,
    EmailReceiptsController,
    EmailReceiptParsersController,
  ],
  providers: [
    EmailReceiptMailboxService,
    { provide: ImapMailboxClient, useClass: ImapFlowMailboxClient },
    EmailReceiptPipelineService,
    EmailReceiptPollService,
    EmailReceiptsService,
    EmailReceiptParsersService,
    EmailReceiptAiService,
  ],
  exports: [EmailReceiptMailboxService, ImapMailboxClient],
})
export class EmailReceiptsModule {}
