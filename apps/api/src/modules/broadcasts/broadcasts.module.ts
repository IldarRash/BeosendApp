import { Module } from "@nestjs/common";
import { NotificationsModule } from "../notifications/notifications.module";
import { BroadcastsController } from "./broadcasts.controller";
import { BroadcastsRepository } from "./broadcasts.repository";
import { BroadcastsService } from "./broadcasts.service";

/**
 * Free-slot broadcasts (T2.4): admin-only preview/send of bookable training
 * slots. Imports NotificationsModule for the shared bot-token TelegramSender so
 * outbound sends stay on the established server-side path.
 */
@Module({
  imports: [NotificationsModule],
  controllers: [BroadcastsController],
  providers: [BroadcastsService, BroadcastsRepository]
})
export class BroadcastsModule {}
