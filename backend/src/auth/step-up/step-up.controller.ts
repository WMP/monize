import {
  Body,
  Controller,
  Post,
  Request,
  Res,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import type { Request as ExpressRequest, Response } from "express";
import { StepUpAuthService } from "./step-up.service";
import { VerifyStepUpDto } from "./dto/verify-step-up.dto";
import { OidcReauthService } from "../oidc/oidc-reauth.service";

@ApiTags("Authentication")
@Controller("auth/step-up")
@UseGuards(AuthGuard("jwt"))
export class StepUpAuthController {
  constructor(
    private readonly service: StepUpAuthService,
    private readonly oidcReauthService: OidcReauthService,
  ) {}

  @Post()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary:
      "Verify the user's strongest auth factor and issue a step-up token",
  })
  async verify(
    @Request() req: ExpressRequest & { user: { id: string } },
    @Body() dto: VerifyStepUpDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    // An OIDC account proves freshness with the HttpOnly cookie the callback
    // set, never with a flag in the request body: the client is the thing being
    // challenged, so its own claim to have redirected cannot be the evidence.
    // The proof is bound to the purpose the step-up was started for, so a
    // restore redirect cannot mint a delete-account token here.
    const oidcReauthProven = await this.oidcReauthService.verify(
      req,
      req.user.id,
      dto.purpose,
    );

    const result = await this.service.verifyAndIssue(req.user.id, dto.purpose, {
      password: dto.password,
      totpCode: dto.totpCode,
      oidcReauthProven,
    });

    // One redirect buys one step-up token.
    if (oidcReauthProven) {
      this.oidcReauthService.consume(res);
    }
    return result;
  }
}
