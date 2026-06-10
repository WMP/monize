import {
  Body,
  Controller,
  Post,
  Request,
  UseGuards,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { Throttle } from "@nestjs/throttler";
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from "@nestjs/swagger";
import { PayeeOrganizerService } from "./payee-organizer.service";
import { SuggestPayeeOrganizationDto } from "./dto/suggest-payee-organization.dto";
import { ApplyPayeeOrganizationDto } from "./dto/apply-payee-organization.dto";

@ApiTags("AI Payee Organizer")
@Controller("ai/payee-organizer")
@UseGuards(AuthGuard("jwt"))
@ApiBearerAuth()
export class PayeeOrganizerController {
  constructor(private readonly payeeOrganizerService: PayeeOrganizerService) {}

  @Post("suggest")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @ApiOperation({
    summary:
      "Use the configured LLM to suggest default categories and duplicate-payee merges for uncategorized payees",
  })
  @ApiResponse({ status: 200, description: "Suggestions generated" })
  suggest(
    @Request() req: { user: { id: string } },
    @Body() dto: SuggestPayeeOrganizationDto,
  ) {
    return this.payeeOrganizerService.suggest(req.user.id, dto);
  }

  @Post("apply")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({
    summary:
      "Apply reviewed category assignments and payee merges (creates new categories where requested)",
  })
  @ApiResponse({ status: 200, description: "Selections applied" })
  apply(
    @Request() req: { user: { id: string } },
    @Body() dto: ApplyPayeeOrganizationDto,
  ) {
    return this.payeeOrganizerService.apply(req.user.id, dto);
  }
}
