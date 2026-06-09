import { Module } from "@nestjs/common";
import { NotificationTemplatesController } from "./notification-templates.controller";
import { NotificationTemplatesRepository } from "./notification-templates.repository";
import { NotificationTemplatesService } from "./notification-templates.service";

/**
 * Admin-editable body text for the 7 client-facing single-training
 * notifications (Slice F). Exports the repository so NotificationsService can
 * read the override map at send time (the only cross-module dependency).
 */
@Module({
  controllers: [NotificationTemplatesController],
  providers: [NotificationTemplatesService, NotificationTemplatesRepository],
  exports: [NotificationTemplatesRepository]
})
export class NotificationTemplatesModule {}
