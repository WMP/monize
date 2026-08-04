import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { TypeOrmModule } from "@nestjs/typeorm";
import { OidcReauthService } from "./oidc-reauth.service";
import { OidcStepUpClaim } from "./entities/oidc-step-up-claim.entity";

/**
 * `OidcReauthService` on its own, so every surface that performs a destructive
 * action can verify an identity-provider round trip without importing
 * `AuthModule`. `AuthModule` already imports `UsersModule`, so pulling it into
 * `UsersModule` would close a cycle; the service needs the JWT signer, config and
 * the shared claim ledger, which is a small enough dependency to stand alone.
 */
@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([OidcStepUpClaim]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get("JWT_SECRET"),
        signOptions: { algorithm: "HS256" as const },
        verifyOptions: { algorithms: ["HS256" as const] },
      }),
    }),
  ],
  providers: [OidcReauthService],
  exports: [OidcReauthService],
})
export class OidcReauthModule {}
