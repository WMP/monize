import { Module } from "@nestjs/common";
import { EncryptionModule } from "../common/encryption/encryption.module";
import {
  ImapFlowMailboxClient,
  ImapMailboxClient,
} from "./imap/imap-mailbox-client";
import { EmailReceiptMailboxController } from "./mailbox/email-receipt-mailbox.controller";
import { EmailReceiptMailboxService } from "./mailbox/email-receipt-mailbox.service";

/**
 * Email receipts (docs/future-plans/email-receipts.md): a user's dedicated IMAP
 * mailbox is read, never written, and each order-confirmation email proposes an
 * enrichment of the bank transaction it pays for. This module holds the mailbox
 * settings and the IMAP client; the pipeline, the poll and the receipts routes
 * join it as they land.
 *
 * `ImapMailboxClient` is bound to the real client here and is the one seam a
 * spec replaces to test a service without a network. The queue the proposals go
 * through (`AiReviewModule`) is imported by the modules that need it, not here:
 * the edge must not run back from the queue to this module.
 */
@Module({
  imports: [EncryptionModule],
  controllers: [EmailReceiptMailboxController],
  providers: [
    EmailReceiptMailboxService,
    { provide: ImapMailboxClient, useClass: ImapFlowMailboxClient },
  ],
  exports: [EmailReceiptMailboxService, ImapMailboxClient],
})
export class EmailReceiptsModule {}
