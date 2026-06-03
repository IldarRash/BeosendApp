import { Module } from "@nestjs/common";
import { NotificationsRepository } from "./notifications.repository";
import { NotificationsScheduler } from "./notifications.scheduler";
import { NotificationsService } from "./notifications.service";
import { TelegramSender } from "./telegram-sender";

/**
 * Owns every outbound Telegram domain notification and the `notifications` send
 * log. Exports NotificationsService so the bookings flow (and future T1.12 /
 * T2.1) can trigger sends; no HTTP controller (all sends are server-internal).
 */
@Module({
  providers: [
    NotificationsService,
    NotificationsRepository,
    TelegramSender,
    NotificationsScheduler
  ],
  exports: [NotificationsService, TelegramSender]
})
export class NotificationsModule {}
