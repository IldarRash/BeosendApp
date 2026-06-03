import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { WaitlistService } from "./waitlist.service";

/**
 * Expires stale waitlist promotions (T2.1). Every minute it asks the service to
 * sweep `notified` entries whose confirmation window has closed; the service
 * marks them `expired` and promotes the next head. The scheduler carries no
 * domain logic — it only supplies `now` and logs counts. A 30-min window thus
 * expires within ~1 min of its deadline.
 */
@Injectable()
export class WaitlistScheduler {
  private readonly logger = new Logger(WaitlistScheduler.name);

  constructor(private readonly waitlist: WaitlistService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async sweep(): Promise<void> {
    const expired = await this.waitlist.sweepExpired(new Date());
    if (expired > 0) {
      this.logger.log(`Waitlist sweep: ${expired} expired`);
    }
  }
}
