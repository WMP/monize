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
import { BrokerImportService } from "./broker-import.service";
import { ParseBrokerImportDto } from "./dto/parse-broker-import.dto";
import { ApplyBrokerImportDto } from "./dto/apply-broker-import.dto";

@ApiTags("AI Broker Import")
@Controller("ai/broker-import")
@UseGuards(AuthGuard("jwt"))
@ApiBearerAuth()
export class BrokerImportController {
  constructor(private readonly brokerImportService: BrokerImportService) {}

  @Post("parse")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @ApiOperation({
    summary:
      "Use the configured LLM to parse pasted brokerage order-history HTML into reviewable buy/sell orders",
  })
  @ApiResponse({ status: 200, description: "Orders parsed" })
  parse(
    @Request() req: { user: { id: string } },
    @Body() dto: ParseBrokerImportDto,
  ) {
    return this.brokerImportService.parse(req.user.id, dto);
  }

  @Post("apply")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({
    summary:
      "Apply reviewed broker-import orders: create new securities where requested and record buy/sell investment transactions",
  })
  @ApiResponse({ status: 200, description: "Orders applied" })
  apply(
    @Request() req: { user: { id: string } },
    @Body() dto: ApplyBrokerImportDto,
  ) {
    return this.brokerImportService.apply(req.user.id, dto);
  }
}
