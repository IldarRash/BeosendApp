import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { WebhookDispatcher } from "./webhook-dispatcher.service";
import { WebhookEndpointsRepository } from "./webhook-endpoints.repository";
import { WebhookDeliveriesRepository } from "./webhook-deliveries.repository";

/**
 * Re-POSTs failed-but-due webhook deliveries (connectors §6). Every minute it loads
 * deliveries whose `nextAttemptAt` is due, looks up each one's endpoint (for the
 * signing secret), and re-attempts via the dispatcher's shared `attempt` — which marks
 * `delivered` on success or re-schedules with capped exponential backoff, giving up
 * (status stays `failed`, `nextAttemptAt` null) once `WEBHOOK_MAX_ATTEMPTS` is reached.
 *
 * Best-effort: a scan error is logged, never thrown. The scheduler carries no domain
 * logic — it supplies `now` and delegates the attempt + backoff to the dispatcher/repo.
 */
@Injectable()
export class WebhookRetryScheduler {
  private readonly logger = new Logger(WebhookRetryScheduler.name);

  constructor(
    private readonly dispatcher: WebhookDispatcher,
    private readonly endpoints: WebhookEndpointsRepository,
    private readonly deliveries: WebhookDeliveriesRepository
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async retryDue(): Promise<void> {
    try {
      const due = await this.deliveries.findDueForRetry(new Date());
      for (const delivery of due) {
        const endpoint = await this.endpoints.findById(delivery.endpointId);
        // Endpoint deleted (cascade should have removed the row) or now inactive:
        // skip — only active endpoints receive deliveries.
        if (!endpoint || endpoint.status !== "active") {
          continue;
        }
        await this.dispatcher.attempt(endpoint, delivery);
      }
      if (due.length > 0) {
        this.logger.log(`Webhook retries attempted: ${due.length}`);
      }
    } catch (error) {
      this.logger.error(
        `Webhook retry scan failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
