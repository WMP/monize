import { Module, forwardRef } from "@nestjs/common";
import { NetWorthModule } from "../net-worth/net-worth.module";
import { ProviderHealthModule } from "../provider-health/provider-health.module";
import { BenchmarkRefreshService } from "./benchmark-refresh.service";
import { BondCatalogService } from "./bond-catalog.service";
import { BondPriceService } from "./bond-price.service";
import { BondValuationService } from "./bond-valuation.service";
import { BondsController } from "./bonds.controller";

@Module({
  imports: [
    ProviderHealthModule,
    // BondPriceService dispatches the net-worth recompute after a price write.
    // SecuritiesModule imports this module (a link recomputes the security's
    // prices) and NetWorthModule reaches SecuritiesModule back through
    // CurrenciesModule, so the edge lies on a require cycle: forwardRef.
    forwardRef(() => NetWorthModule),
  ],
  controllers: [BondsController],
  providers: [
    BondValuationService,
    BondCatalogService,
    BenchmarkRefreshService,
    BondPriceService,
  ],
  exports: [BondValuationService, BondPriceService],
})
export class BondsModule {}
