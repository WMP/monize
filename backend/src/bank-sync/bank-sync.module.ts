import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AccountsModule } from "../accounts/accounts.module";
import { EncryptionModule } from "../common/encryption/encryption.module";
import { JobClaimModule } from "../common/jobs/job-claim.module";
import { NetWorthModule } from "../net-worth/net-worth.module";
import { PayeesModule } from "../payees/payees.module";
import { ProviderHealthModule } from "../provider-health/provider-health.module";
import { TransactionRulesModule } from "../transaction-rules/transaction-rules.module";
import { BankSyncConnectionsService } from "./bank-sync-connections.service";
import { BankSyncController } from "./bank-sync.controller";
import { BankSyncCredentialsService } from "./bank-sync-credentials.service";
import { BankSyncCronService } from "./bank-sync-cron.service";
import { BankSyncService } from "./bank-sync.service";
import { BankSyncWriterService } from "./bank-sync-writer.service";
import { BankSyncProviderRegistry } from "./providers/bank-sync-provider.registry";
import { EnableBankingProvider } from "./providers/enable-banking/enable-banking.client";

/**
 * Bank sync (docs/specs/bank-sync.md). Nothing imports this module, so its
 * edges to the modules it reads through are bare: no require cycle can reach
 * back here (`src/module-graph.spec.ts`).
 *
 * The provider layer is registered here and reached only through
 * `BankSyncProviderRegistry`; a second aggregator is a new directory under
 * `providers/` and one provider line.
 */
@Module({
  imports: [
    ConfigModule,
    EncryptionModule,
    JobClaimModule,
    ProviderHealthModule,
    AccountsModule,
    PayeesModule,
    TransactionRulesModule,
    NetWorthModule,
  ],
  controllers: [BankSyncController],
  providers: [
    EnableBankingProvider,
    BankSyncProviderRegistry,
    BankSyncCredentialsService,
    BankSyncConnectionsService,
    BankSyncWriterService,
    BankSyncService,
    BankSyncCronService,
  ],
})
export class BankSyncModule {}
