import { Module, forwardRef } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AiSuggestionSession } from "./entities/ai-suggestion-session.entity";
import { AiSuggestionSessionService } from "./ai-suggestion-session.service";
import { AiSuggestionSessionController } from "./ai-suggestion-session.controller";
import { PayeesModule } from "../../payees/payees.module";
import { CategoriesModule } from "../../categories/categories.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([AiSuggestionSession]),
    forwardRef(() => PayeesModule),
    forwardRef(() => CategoriesModule),
  ],
  providers: [AiSuggestionSessionService],
  controllers: [AiSuggestionSessionController],
  exports: [AiSuggestionSessionService],
})
export class AiSuggestionSessionModule {}
