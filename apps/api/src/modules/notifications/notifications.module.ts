import { forwardRef, Module } from "@nestjs/common";
import { ConnectorsModule } from "../connectors/connectors.module";
import { ManagersRepository } from "../managers/managers.repository";
import { NotificationTemplatesModule } from "../notification-templates/notification-templates.module";
import { TrainersRepository } from "../trainers/trainers.repository";
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
 *
 * ManagersRepository/TrainersRepository (each depends only on DatabaseService) are
 * provided directly to resolve a staff recipient's notification locale at admin-DM
 * time — mirroring how ManagersModule provides TrainersRepository — without importing
 * those modules (TrainersModule already imports this one).
 */
@Module({
  imports: [NotificationTemplatesModule, forwardRef(() => ConnectorsModule)],
  providers: [
    NotificationsService,
    NotificationsRepository,
    TelegramSender,
    NotificationsScheduler,
    ManagersRepository,
    TrainersRepository
  ],
  exports: [NotificationsService, TelegramSender]
})
export class NotificationsModule {}
