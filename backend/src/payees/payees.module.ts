import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Payee } from "./entities/payee.entity";
import { PayeeAlias } from "./entities/payee-alias.entity";
import { Transaction } from "../transactions/entities/transaction.entity";
import { ScheduledTransaction } from "../scheduled-transactions/entities/scheduled-transaction.entity";
import { Category } from "../categories/entities/category.entity";
import { PayeesService } from "./payees.service";
import { PayeeAutoMergeService } from "./payee-auto-merge.service";
import { PayeesController } from "./payees.controller";
import { ActionHistoryModule } from "../action-history/action-history.module";
import { CategoriesModule } from "../categories/categories.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Payee,
      PayeeAlias,
      Transaction,
      ScheduledTransaction,
      Category,
    ]),
    ActionHistoryModule,
    CategoriesModule,
  ],
  providers: [PayeesService, PayeeAutoMergeService],
  controllers: [PayeesController],
  exports: [PayeesService],
})
export class PayeesModule {}
