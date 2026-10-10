import { Module } from "@nestjs/common";
import { ProviderHealthModule } from "../provider-health/provider-health.module";
import { BenchmarkRefreshService } from "./benchmark-refresh.service";
import { BondCatalogService } from "./bond-catalog.service";
import { BondValuationService } from "./bond-valuation.service";

@Module({
  imports: [ProviderHealthModule],
  providers: [
    BondValuationService,
    BondCatalogService,
    BenchmarkRefreshService,
  ],
  exports: [BondValuationService],
})
export class BondsModule {}
