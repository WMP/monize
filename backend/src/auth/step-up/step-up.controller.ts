import { Body, Controller, Post, Request, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { StepUpAuthService } from "./step-up.service";
import { VerifyStepUpDto } from "./dto/verify-step-up.dto";

@ApiTags("Authentication")
@Controller("auth/step-up")
@UseGuards(AuthGuard("jwt"))
export class StepUpAuthController {
  constructor(private readonly service: StepUpAuthService) {}

  @Post()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary:
      "Verify the user's strongest auth factor and issue a step-up token",
  })
  async verify(
    @Request() req: { user: { id: string } },
    @Body() dto: VerifyStepUpDto,
  ) {
    return this.service.verifyAndIssue(req.user.id, dto.purpose, {
      password: dto.password,
      totpCode: dto.totpCode,
    });
  }
}
