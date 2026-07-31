import { Injectable } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { MonthlyScheduleNotificationService } from "./monthly-schedule-notification.service";

@Injectable()
export class MonthlyScheduleNotificationScheduler {
  constructor(private readonly notifications: MonthlyScheduleNotificationService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  dispatch(): Promise<void> {
    return this.notifications.dispatchPending();
  }
}
