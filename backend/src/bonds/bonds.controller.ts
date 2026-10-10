import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Request,
  UnprocessableEntityException,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { todayYMD } from "../common/date-utils";
import { ParseOptionalCalendarDatePipe } from "../common/pipes/parse-calendar-date.pipe";
import { tr } from "../i18n/translate";
import { BondCatalogService } from "./bond-catalog.service";
import {
  BondDataInconsistentError,
  BondDataNotFoundError,
} from "./bond-errors";
import { BondPriceRecompute, BondPriceService } from "./bond-price.service";
import {
  BondInstrumentSummary,
  BondValuationService,
  SecurityValuation,
} from "./bond-valuation.service";
import { BondEngineError } from "./engine/bond-engine";

/**
 * The bond catalog, a linked security's lots valued on a day, and the on-demand
 * price recompute (spec 12.5). Owner-scoped: `userId` comes from the JWT only,
 * and another user's security answers 404 exactly as an unlinked one does.
 */
@ApiTags("Bonds")
@Controller("bonds")
@UseGuards(AuthGuard("jwt"))
@ApiBearerAuth()
export class BondsController {
  constructor(
    private readonly catalog: BondCatalogService,
    private readonly valuation: BondValuationService,
    private readonly prices: BondPriceService,
  ) {}

  @Get("instruments")
  @ApiOperation({
    summary: "List the bond instruments a security can be linked to",
    description:
      "The deployment's catalog (global reference data), ordered by issuer " +
      "country, issuer and series, for the link picker.",
  })
  @ApiResponse({ status: 200, description: "Bond instruments" })
  listInstruments(): Promise<BondInstrumentSummary[]> {
    return this.catalog.listInstruments();
  }

  @Get("securities/:securityId/valuation")
  @ApiOperation({
    summary: "Value the lots of a bond-linked security on a day",
    description:
      "The open lots on `asOf` (default today), each with its valuation, and " +
      "the lot totals. A total is null unless every lot has the figure. " +
      "`refusal` names why the lots cannot be derived (a split, a fractional " +
      "quantity, a removal larger than the lots held).",
  })
  @ApiQuery({ name: "asOf", required: false, example: "2027-04-15" })
  @ApiResponse({ status: 200, description: "The lots, valuations and totals" })
  @ApiResponse({
    status: 404,
    description: "Not the caller's security, or not linked to a bond",
  })
  async valuationOf(
    @Request() req,
    @Param("securityId", ParseUUIDPipe) securityId: string,
    @Query("asOf", new ParseOptionalCalendarDatePipe()) asOf?: string,
  ): Promise<SecurityValuation> {
    return this.mapBondErrors(() =>
      this.valuation.valueSecurity(req.user.id, securityId, asOf ?? todayYMD()),
    );
  }

  @Post("securities/:securityId/recompute")
  @ApiOperation({
    summary: "Recompute the engine prices of a bond-linked security",
    description:
      "Writes the daily prices from the first transaction to today. A manual " +
      "or transaction-derived price on a day is never overwritten.",
  })
  @ApiResponse({
    status: 201,
    description: "Rows written and bond-engine rows deleted",
  })
  @ApiResponse({
    status: 404,
    description: "Not the caller's security, or not linked to a bond",
  })
  async recompute(
    @Request() req,
    @Param("securityId", ParseUUIDPipe) securityId: string,
  ): Promise<BondPriceRecompute> {
    return this.mapBondErrors(() =>
      this.prices.recomputeSecurity(req.user.id, securityId),
    );
  }

  /** The stored data is missing or contradicts itself, or the input is unusable. */
  private async mapBondErrors<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof BondDataNotFoundError) {
        throw new NotFoundException(
          tr(
            "errors.bonds.dataNotFound",
            `The stored bond data needed for this valuation is not available: ${error.message}`,
            { detail: error.message },
          ),
        );
      }
      if (error instanceof BondDataInconsistentError) {
        throw new UnprocessableEntityException(
          tr(
            "errors.bonds.dataInconsistent",
            `The stored bond data contradicts itself, so no valuation is given: ${error.message}`,
            { detail: error.message },
          ),
        );
      }
      if (error instanceof BondEngineError) {
        throw new BadRequestException(
          tr(
            "errors.bonds.invalidInput",
            `The valuation request is not valid: ${error.message}`,
            { detail: error.message },
          ),
        );
      }
      throw error;
    }
  }
}
