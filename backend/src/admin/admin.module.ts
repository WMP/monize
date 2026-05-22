import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { User } from "../users/entities/user.entity";
import { UserPreference } from "../users/entities/user-preference.entity";
import { RefreshToken } from "../auth/entities/refresh-token.entity";
import { PersonalAccessToken } from "../auth/entities/personal-access-token.entity";
import { AdminService } from "./admin.service";
import { AdminController } from "./admin.controller";
import { OAuthModule } from "../oauth/oauth.module";
import { UsersModule } from "../users/users.module";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      UserPreference,
      RefreshToken,
      PersonalAccessToken,
    ]),
    OAuthModule,
    UsersModule,
    NotificationsModule,
  ],
  providers: [AdminService],
  controllers: [AdminController],
})
export class AdminModule {}
