import { Module, forwardRef } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AiModule } from "../ai.module";
import { PayeesModule } from "../../payees/payees.module";
import { CategoriesModule } from "../../categories/categories.module";
import { PayeeMergeRejection } from "../../payees/entities/payee-merge-rejection.entity";
import { PayeeOrganizerService } from "./payee-organizer.service";
import { PayeeOrganizerController } from "./payee-organizer.controller";

/**
 * Payee Organizer: an AI-driven cleanup feature that suggests default
 * categories for uncategorized payees (from their names) and detects
 * likely-duplicate payees to merge. It reuses PayeesService and
 * CategoriesService for all writes, and AiService (from AiModule) for the
 * LLM call. The same service backs the REST endpoints, the MCP tool, and
 * the AI Assistant tool executor, so they all share one implementation.
 */
@Module({
  imports: [
    forwardRef(() => AiModule),
    PayeesModule,
    forwardRef(() => CategoriesModule),
    TypeOrmModule.forFeature([PayeeMergeRejection]),
  ],
  providers: [PayeeOrganizerService],
  controllers: [PayeeOrganizerController],
  exports: [PayeeOrganizerService],
})
export class PayeeOrganizerModule {}
