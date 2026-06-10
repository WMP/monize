import { Module, forwardRef } from "@nestjs/common";
import { AiModule } from "../ai.module";
import { SecuritiesModule } from "../../securities/securities.module";
import { AccountsModule } from "../../accounts/accounts.module";
import { BrokerImportService } from "./broker-import.service";
import { BrokerImportController } from "./broker-import.controller";

/**
 * Broker Import: an AI-assisted feature that turns pasted brokerage
 * order-history HTML into reviewable buy/sell orders, then records them as
 * investment transactions. It reuses AiService (AiModule) for parsing,
 * SecuritiesService (SecuritiesModule) for matching/creating securities, and
 * InvestmentTransactionsService for the buy/sell writes. The same service
 * backs both the REST endpoints and the MCP tools.
 */
@Module({
  imports: [
    forwardRef(() => AiModule),
    SecuritiesModule,
    forwardRef(() => AccountsModule),
  ],
  providers: [BrokerImportService],
  controllers: [BrokerImportController],
  exports: [BrokerImportService],
})
export class BrokerImportModule {}
