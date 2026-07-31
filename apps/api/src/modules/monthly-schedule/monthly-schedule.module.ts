import { Module } from "@nestjs/common";
import { MonthlyScheduleController } from "./monthly-schedule.controller";
import { MonthlyScheduleRepository } from "./monthly-schedule.repository";
import { MonthlyScheduleService } from "./monthly-schedule.service";
import { SettingsModule } from "../settings/settings.module";
import { MonthlyScheduleConflictRepository } from "./monthly-schedule-conflict.repository";
import { MonthlyScheduleNotificationRepository } from "./monthly-schedule-notification.repository";
import { MonthlyScheduleNotificationService } from "./monthly-schedule-notification.service";
import { MonthlyScheduleNotificationScheduler } from "./monthly-schedule-notification.scheduler";
import { NotificationsModule } from "../notifications/notifications.module";
import { ConnectorsModule } from "../connectors/connectors.module";
import { BroadcastAutomationsModule } from "../broadcast-automations/broadcast-automations.module";

@Module({
  imports: [SettingsModule, NotificationsModule, ConnectorsModule, BroadcastAutomationsModule],
  controllers: [MonthlyScheduleController],
  providers: [MonthlyScheduleService, MonthlyScheduleRepository, MonthlyScheduleConflictRepository, MonthlyScheduleNotificationRepository, MonthlyScheduleNotificationService, MonthlyScheduleNotificationScheduler]
})
export class MonthlyScheduleModule {}
