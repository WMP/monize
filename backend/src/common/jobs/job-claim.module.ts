import { Global, Module } from "@nestjs/common";
import { JobClaimService } from "./job-claim.service";

/**
 * Global so any cron can claim its work without every feature module
 * re-declaring the provider -- and so there is exactly one claim mechanism to
 * find when the next multi-replica job needs one.
 */
@Global()
@Module({
  providers: [JobClaimService],
  exports: [JobClaimService],
})
export class JobClaimModule {}
