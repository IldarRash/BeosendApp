import { Module } from "@nestjs/common";
import { NotificationsModule } from "../notifications/notifications.module";
import { SettingsModule } from "../settings/settings.module";
import { BroadcastsController, BroadcastTemplatesController } from "./broadcasts.controller";
import { BroadcastsRepository } from "./broadcasts.repository";
import { BroadcastsService } from "./broadcasts.service";
import { SameDayFreedSlotDispatcher } from "./same-day-freed-slot-dispatcher.service";

/**
 * Free-slot broadcasts (T2.4): admin-only preview/send of bookable training
 * slots. Imports NotificationsModule for the shared bot-token TelegramSender so
 * outbound sends stay on the established server-side path.
 */
@Module({
  imports: [NotificationsModule, SettingsModule],
  controllers: [BroadcastsController, BroadcastTemplatesController],
  providers: [BroadcastsService, BroadcastsRepository, SameDayFreedSlotDispatcher],
  exports: [SameDayFreedSlotDispatcher]
})
export class BroadcastsModule {}
