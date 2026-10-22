import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { Warranty } from "./entities/warranty.entity";
import { WarrantyClaim } from "./entities/warranty-claim.entity";
import { WarrantiesController } from "./warranties.controller";
import { WarrantiesService } from "./warranties.service";
import { WarrantyClaimsController } from "./warranty-claims.controller";
import { WarrantyClaimsService } from "./warranty-claims.service";

/**
 * Warranties and their claims (docs/future-plans/warranty-tracker.md). The
 * module imports no other feature module: it reads the linked transaction and
 * payee through their entities inside its own transaction, and it never
 * reaches a ledger writer (WTY-001, `warranties.guard.spec.ts`), so it needs
 * no `forwardRef`.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Warranty, WarrantyClaim])],
  providers: [WarrantiesService, WarrantyClaimsService],
  controllers: [WarrantiesController, WarrantyClaimsController],
  exports: [WarrantiesService],
})
export class WarrantiesModule {}
