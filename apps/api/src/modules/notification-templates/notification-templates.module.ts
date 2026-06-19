import { Module } from "@nestjs/common";
import { NotificationTemplatesController } from "./notification-templates.controller";
import { NotificationTemplatesRepository } from "./notification-templates.repository";
import { NotificationTemplatesService } from "./notification-templates.service";

/**
 * Admin-editable, per-locale body text for all 12 notification events (client +
 * staff). Exports the repository so NotificationsService and CourtRequestsService
 * can read a per-(event, locale) override at send time.
 */
@Module({
  controllers: [NotificationTemplatesController],
  providers: [NotificationTemplatesService, NotificationTemplatesRepository],
  exports: [NotificationTemplatesRepository]
})
export class NotificationTemplatesModule {}
