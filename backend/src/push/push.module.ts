/**
 * TEST DRIVE ONLY -- NOT FOR MERGE.
 *
 * The real module on `claude/notification-settings-menu-4tebh9` imports
 * `TypeOrmModule.forFeature([PushSubscription, PushInstanceConfig])` and the
 * encryption module. This one has no entities at all, because the tables it
 * would need arrive with migration 171 and this branch exists to be run on a
 * database that has not been migrated.
 *
 * `DataSource` is still injected -- one real read survives, the recipient's
 * stored language from `user_preferences`, which exists on `main`.
 */
import { Module } from "@nestjs/common";
import { PushController } from "./push.controller";
import { PushConfigService } from "./push-config.service";
import { PushSubscriptionService } from "./push-subscription.service";
import { WebPushSender } from "./web-push-sender.service";

@Module({
  controllers: [PushController],
  providers: [PushConfigService, PushSubscriptionService, WebPushSender],
  exports: [PushConfigService],
})
export class PushModule {}
