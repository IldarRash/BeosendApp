import { Module } from "@nestjs/common";
import { NotificationsModule } from "../notifications/notifications.module";
import { NotificationTemplatesModule } from "../notification-templates/notification-templates.module";
import { RecordStatusRepository } from "./record-status.repository";
import { RecordStatusScheduler } from "./record-status.scheduler";
import { RecordStatusService } from "./record-status.service";
import { RecordStatusController } from "./record-status.controller";

/** Transactional client-record status outbox. Root registers this in AppModule. */
@Module({
  imports: [NotificationsModule, NotificationTemplatesModule],
  controllers: [RecordStatusController],
  providers: [RecordStatusRepository, RecordStatusService, RecordStatusScheduler],
  exports: [RecordStatusService]
})
export class RecordStatusModule {}
