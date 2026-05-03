import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { User } from "./entities/user.entity";
import { UserPreference } from "./entities/user-preference.entity";
import { TrustedDevice } from "./entities/trusted-device.entity";
import { RefreshToken } from "../auth/entities/refresh-token.entity";
import { PersonalAccessToken } from "../auth/entities/personal-access-token.entity";
import { UsersService } from "./users.service";
import { UsersController } from "./users.controller";
import { PasswordBreachService } from "../auth/password-breach.service";
import { CurrenciesModule } from "../currencies/currencies.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      UserPreference,
      TrustedDevice,
      RefreshToken,
      PersonalAccessToken,
    ]),
    CurrenciesModule,
  ],
  providers: [UsersService, PasswordBreachService],
  controllers: [UsersController],
  exports: [UsersService],
})
export class UsersModule {}
