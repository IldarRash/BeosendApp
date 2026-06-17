import { forwardRef, Module } from "@nestjs/common";
import { ConnectorsModule } from "../connectors/connectors.module";
import { NotificationTemplatesModule } from "../notification-templates/notification-templates.module";
import { NotificationsRepository } from "./notifications.repository";
import { NotificationsScheduler } from "./notifications.scheduler";
import { NotificationsService } from "./notifications.service";
import { TelegramSender } from "./telegram-sender";

/**
 * Owns every outbound domain notification and the `notifications` send log. Outbound
 * channel sends now go through the connectors ChannelDispatcher (Slice 0): in this
 * slice only TelegramChannel is registered, so behavior is identical to the previous
 * direct-TelegramSender path. Exports NotificationsService so the bookings flow (and
 * T1.12 / T2.1) can trigger sends; no HTTP controller (all sends are server-internal).
 *
 * Imports NotificationTemplatesModule for the admin's body-text overrides (Slice F),
 * and ConnectorsModule (forwardRef — ConnectorsModule wraps this module's
 * TelegramSender) for the ChannelDispatcher. TelegramSender stays exported for the
 * trainer-DM/keyboard sends and the broadcasts module.
 */
@Module({
  imports: [NotificationTemplatesModule, forwardRef(() => ConnectorsModule)],
  providers: [
    NotificationsService,
    NotificationsRepository,
    TelegramSender,
    NotificationsScheduler
  ],
  exports: [NotificationsService, TelegramSender]
})
export class NotificationsModule {}
