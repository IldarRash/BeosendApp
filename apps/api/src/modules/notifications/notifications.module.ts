import { Module } from "@nestjs/common";
import { NotificationTemplatesModule } from "../notification-templates/notification-templates.module";
import { NotificationsRepository } from "./notifications.repository";
import { NotificationsScheduler } from "./notifications.scheduler";
import { NotificationsService } from "./notifications.service";
import { TelegramSender } from "./telegram-sender";

/**
 * Owns every outbound Telegram domain notification and the `notifications` send
 * log. Exports NotificationsService so the bookings flow (and future T1.12 /
 * T2.1) can trigger sends; no HTTP controller (all sends are server-internal).
 *
 * Imports NotificationTemplatesModule so the service can read the admin's
 * body-text overrides (Slice F) at send time, falling back to the code defaults.
 */
@Module({
  imports: [NotificationTemplatesModule],
  providers: [
    NotificationsService,
    NotificationsRepository,
    TelegramSender,
    NotificationsScheduler
  ],
  exports: [NotificationsService, TelegramSender]
})
export class NotificationsModule {}
