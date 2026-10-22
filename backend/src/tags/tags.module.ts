import { Module, forwardRef } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Tag } from "./entities/tag.entity";
import { TransactionTag } from "./entities/transaction-tag.entity";
import { TransactionSplitTag } from "./entities/transaction-split-tag.entity";
import { TagsService } from "./tags.service";
import { TagsController } from "./tags.controller";
import { ActionHistoryModule } from "../action-history/action-history.module";
import { DelegationModule } from "../delegation/delegation.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([Tag, TransactionTag, TransactionSplitTag]),
    ActionHistoryModule,
    // The usage endpoint scopes an acting delegate to their READ-granted
    // accounts (DelegationService). `forwardRef` because DelegationModule
    // reaches back here -- see `src/module-graph.spec.ts`.
    forwardRef(() => DelegationModule),
  ],
  providers: [TagsService],
  controllers: [TagsController],
  exports: [TagsService],
})
export class TagsModule {}
