import { Module } from "@nestjs/common";
import { OidcReauthModule } from "../auth/oidc/oidc-reauth.module";
import { UsersService } from "./users.service";
import { UsersController } from "./users.controller";
import { PasswordBreachService } from "../auth/password-breach.service";
import { DemoModeModule } from "../common/demo-mode.module";

/**
 * `PasswordBreachService` is re-provided here (rather than imported from
 * AuthModule) on purpose: the dependency chain
 * `NotificationsModule -> UsersModule -> AuthModule -> NotificationsModule`
 * cannot be broken by a single `forwardRef`. Since `PasswordBreachService`
 * is stateless (HIBP HTTP client, no in-memory cache), the duplicate
 * instance has no correctness or memory cost.
 */
@Module({
  imports: [
    OidcReauthModule,
    // DemoModeModule is @Global, but UsersService depends on DemoModeService
    // directly, so import it here too: integration tests build a TestingModule
    // around UsersModule without AppModule's global registration, and would
    // otherwise fail to resolve DemoModeService.
    DemoModeModule,
  ],
  providers: [UsersService, PasswordBreachService],
  controllers: [UsersController],
  exports: [UsersService],
})
export class UsersModule {}
