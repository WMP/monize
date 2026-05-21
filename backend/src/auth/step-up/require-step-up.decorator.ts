import { SetMetadata } from "@nestjs/common";
import type { StepUpPurpose } from "./dto/verify-step-up.dto";

export const REQUIRE_STEP_UP_KEY = "requireStepUp";

/**
 * Marks a controller handler as requiring a valid step-up token for the
 * given purpose. The `StepUpGuard` reads this metadata and rejects requests
 * whose `X-Step-Up-Token` header is missing, expired, or scoped to a
 * different purpose.
 */
export const RequireStepUp = (purpose: StepUpPurpose) =>
  SetMetadata(REQUIRE_STEP_UP_KEY, purpose);
