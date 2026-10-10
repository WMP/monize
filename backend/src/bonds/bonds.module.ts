import { Module } from "@nestjs/common";
import { BondValuationService } from "./bond-valuation.service";

@Module({
  providers: [BondValuationService],
  exports: [BondValuationService],
})
export class BondsModule {}
