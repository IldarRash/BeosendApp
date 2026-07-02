import { Module } from "@nestjs/common";
import { ConnectorsModule } from "../connectors/connectors.module";
import { NotificationTemplatesModule } from "../notification-templates/notification-templates.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { SettingsModule } from "../settings/settings.module";
import { CourtRequestsController } from "./court-requests.controller";
import { CourtRequestsRepository } from "./court-requests.repository";
import { CourtRequestsService } from "./court-requests.service";

/**
 * Court-request moderation (Edition 2). Post-commit client notifications now go
 * through the connectors ChannelDispatcher (replacing the removed in-module
 * CourtNotifier) and emit typed domain events via DomainEventsService, so Slices A–C
 * can consume court decisions. Imports ConnectorsModule for both, and
 * NotificationsModule for the operational admin DM on a new court request, and
 * NotificationTemplatesModule for the admin-editable, per-locale decision-DM bodies.
 */
@Module({
  imports: [ConnectorsModule, NotificationsModule, NotificationTemplatesModule, SettingsModule],
  controllers: [CourtRequestsController],
  providers: [CourtRequestsService, CourtRequestsRepository]
})
export class CourtRequestsModule {}
