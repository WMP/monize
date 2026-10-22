import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { DelegationModule } from "../delegation/delegation.module";
import { Warranty } from "./entities/warranty.entity";
import { WarrantyClaim } from "./entities/warranty-claim.entity";
import { WarrantiesController } from "./warranties.controller";
import { WarrantiesService } from "./warranties.service";
import { WarrantyClaimsController } from "./warranty-claims.controller";
import { WarrantyClaimsService } from "./warranty-claims.service";

/**
 * Warranties and their claims (docs/future-plans/warranty-tracker.md). The
 * module reads the linked transaction and payee through their entities inside
 * its own transaction and never reaches a ledger writer (WTY-001,
 * `warranties.guard.spec.ts`). Its one feature import is `DelegationModule`,
 * for the account scope an acting delegate's linked purchases are narrowed to
 * (WTY-007); nothing reaches back here, so the edge is bare.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Warranty, WarrantyClaim]),
    DelegationModule,
  ],
  providers: [WarrantiesService, WarrantyClaimsService],
  controllers: [WarrantiesController, WarrantyClaimsController],
  exports: [WarrantiesService],
})
export class WarrantiesModule {}
