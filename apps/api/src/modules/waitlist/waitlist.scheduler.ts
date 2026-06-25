import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { WaitlistService } from "./waitlist.service";

/**
 * The minutely waitlist safety net (frictionless waitlist). Promotion is now
 * auto-book + notify on a freed seat — the post-commit cancel/decline seams call
 * `promoteNext` directly — so this sweep only catches any freed-seat gap a direct
 * call missed (e.g. transferGroup): it asks the service to auto-promote every
 * group training that is still bookable AND has a `waiting` head. The scheduler
 * carries no domain logic — it only triggers the sweep and logs counts.
 */
@Injectable()
export class WaitlistScheduler {
  private readonly logger = new Logger(WaitlistScheduler.name);

  constructor(private readonly waitlist: WaitlistService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async sweep(): Promise<void> {
    const promotable = await this.waitlist.sweepPromotable();
    if (promotable > 0) {
      this.logger.log(`Waitlist sweep: ${promotable} promotable trainings`);
    }
  }
}
