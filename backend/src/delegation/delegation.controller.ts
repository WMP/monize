import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Request,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { DemoRestricted } from "../common/decorators/demo-restricted.decorator";
import { DelegationService } from "./delegation.service";
import { CreateDelegateDto } from "./dto/create-delegate.dto";
import { SetGrantsDto } from "./dto/set-grants.dto";

/**
 * Owner-scoped delegate management ("Shared Access" settings). Every endpoint
 * uses req.user.id as the OWNER. This is NOT the admin module and requires no
 * admin role -- any normal user can manage delegates for their own account.
 *
 * Not annotated @AllowDelegate(): a delegate acting as an owner is blocked
 * from managing that owner's delegates by AccountDelegateGuard (fail closed).
 */
@ApiTags("Delegation")
@Controller("delegation")
@UseGuards(AuthGuard("jwt"))
@ApiBearerAuth()
export class DelegationController {
  constructor(private readonly delegationService: DelegationService) {}

  @Get("delegates")
  @ApiOperation({ summary: "List delegates for the current account" })
  listDelegates(@Request() req) {
    return this.delegationService.listDelegates(req.user.id);
  }

  @Post("delegates")
  @DemoRestricted()
  @ApiOperation({
    summary: "Create or link a delegate for the current account",
  })
  createDelegate(@Request() req, @Body() dto: CreateDelegateDto) {
    return this.delegationService.createDelegate(req.user.id, dto);
  }

  @Delete("delegates/:id")
  @HttpCode(HttpStatus.OK)
  @DemoRestricted()
  @ApiOperation({ summary: "Revoke a delegate" })
  revokeDelegate(@Request() req, @Param("id", ParseUUIDPipe) id: string) {
    return this.delegationService.revokeDelegate(req.user.id, id);
  }

  @Put("delegates/:id/grants")
  @DemoRestricted()
  @ApiOperation({ summary: "Set the delegate's READ-granted accounts" })
  setGrants(
    @Request() req,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: SetGrantsDto,
  ) {
    return this.delegationService.setGrants(req.user.id, id, dto.accountIds);
  }

  @Post("delegates/:id/reset-password")
  @HttpCode(HttpStatus.OK)
  @DemoRestricted()
  @ApiOperation({ summary: "Reset a delegate's password (owner-driven)" })
  resetPassword(@Request() req, @Param("id", ParseUUIDPipe) id: string) {
    return this.delegationService.resetDelegatePassword(req.user.id, id);
  }
}
