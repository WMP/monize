import { Module } from "@nestjs/common";
import { UsersService } from "./users.service";
import { UsersController } from "./users.controller";
import { PasswordBreachService } from "../auth/password-breach.service";
import { OidcReauthService } from "../auth/oidc/oidc-reauth.service";
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
    // DemoModeModule is @Global, but UsersService depends on DemoModeService
    // directly, so import it here too: integration tests build a TestingModule
    // around UsersModule without AppModule's global registration, and would
    // otherwise fail to resolve DemoModeService.
    DemoModeModule,
  ],
  // `OidcReauthService` is re-provided here for the same reason as
  // `PasswordBreachService`: UsersModule cannot import AuthModule. It holds no
  // injected dependencies and its replay counter is module-level, so a second
  // Nest instance is not a second set of state.
  providers: [UsersService, PasswordBreachService, OidcReauthService],
  controllers: [UsersController],
  exports: [UsersService],
})
export class UsersModule {}
