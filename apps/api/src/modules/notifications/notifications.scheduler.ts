import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { NotificationsService } from "./notifications.service";

/**
 * Drives the 24h / 3h reminders (T2.2). Every 5 minutes it asks the service for
 * due reminders at the current clock; the service's ±15 min window plus the send
 * log make overlapping ticks safe (at-most-once per client/training/type). The
 * scheduler carries no domain logic — it only supplies `now` and logs counts.
 */
@Injectable()
export class NotificationsScheduler {
  private readonly logger = new Logger(NotificationsScheduler.name);

  constructor(private readonly notifications: NotificationsService) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async scanReminders(): Promise<void> {
    const now = new Date();
    const sent24 = await this.notifications.sendDueReminders("reminder-24h", now);
    const sent3 = await this.notifications.sendDueReminders("reminder-3h", now);
    if (sent24 > 0 || sent3 > 0) {
      this.logger.log(`Reminders sent: 24h=${sent24}, 3h=${sent3}`);
    }
  }
}
