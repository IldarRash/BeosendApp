import { ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Env } from "@beosand/config";
import { isAdmin } from "@beosand/config";
import type {
  ListSubscriptionsQuery,
  SubscriptionPaymentState,
  SubscriptionSummary
} from "@beosand/types";
import { rsd, subscriptionSummarySchema } from "@beosand/types";
import { ENV } from "../../config/config.module";
import {
  type SubscriptionAggregateRow,
  SubscriptionsRepository
} from "./subscriptions.repository";

/**
 * Subscription payment tracking (admin console only). A subscription is the set
 * of bookings sharing one groupSubscriptionId; payment is a per-booking flag set
 * for ALL non-cancelled bookings of the batch at once. Every method is admin-only
 * (gated here via isAdmin, never in the controller or the bot) and computes money
 * server-side: totalRsd is groups.priceMonthRsd (how the month was sold), never
 * summed or trusted from the client.
 */
@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly repo: SubscriptionsRepository,
    @Inject(ENV) private readonly env: Env
  ) {}

  /** Admin-only list of monthly subscriptions, optionally filtered by payment state / client. */
  async list(actor: number, query: ListSubscriptionsQuery): Promise<SubscriptionSummary[]> {
    this.assertAdmin(actor);

    const rows = await this.repo.aggregate(query.clientId);
    const summaries = rows.map((row) => this.toSummary(row));

    return query.paymentState
      ? summaries.filter((s) => s.paymentState === query.paymentState)
      : summaries;
  }

  /**
   * Admin-only: mark every non-cancelled booking of a subscription paid/unpaid in
   * one transaction, then return the re-aggregated summary. 404 when no
   * non-cancelled booking matches the id. Seat counts / training status untouched.
   */
  async setPaid(actor: number, groupSubscriptionId: string, paid: boolean): Promise<SubscriptionSummary> {
    this.assertAdmin(actor);

    const row = await this.repo.transaction(async (tx) => {
      const updated = await this.repo.setBatchPaid(tx, groupSubscriptionId, paid, actor);
      if (updated === 0) {
        throw new NotFoundException("Subscription not found");
      }
      return this.repo.aggregateOne(groupSubscriptionId, tx);
    });

    if (!row) {
      throw new NotFoundException("Subscription not found");
    }
    return this.toSummary(row);
  }

  /**
   * Derive a contract-validated summary from a raw aggregate row. totalRsd is the
   * group's priceMonthRsd (how the month was sold), already joined in the aggregate
   * from the authoritative groups row and validated with the shared `rsd` primitive;
   * 0 when the subscription's group is gone.
   */
  private toSummary(row: SubscriptionAggregateRow): SubscriptionSummary {
    const totalRsd = rsd.parse(row.priceMonthRsd ?? 0);
    const [year, month] = parseYearMonth(row.minDate);

    return subscriptionSummarySchema.parse({
      groupSubscriptionId: row.groupSubscriptionId,
      clientId: row.clientId,
      clientName: row.clientName,
      groupId: row.groupId,
      groupName: row.groupName,
      year,
      month,
      dateCount: row.dateCount,
      paidCount: row.paidCount,
      waitlistedCount: row.waitlistedCount,
      totalRsd,
      paymentState: paymentStateOf(row.dateCount, row.paidCount)
    });
  }

  private assertAdmin(actorTelegramId: number): void {
    if (!isAdmin(this.env, actorTelegramId)) {
      throw new ForbiddenException("Admin privileges required");
    }
  }
}

/** "all paid" → paid, "none paid" → unpaid, otherwise partial (over non-cancelled). */
function paymentStateOf(dateCount: number, paidCount: number): SubscriptionPaymentState {
  if (paidCount === 0) return "unpaid";
  if (paidCount >= dateCount) return "paid";
  return "partial";
}

/** Split a "YYYY-MM-DD" training date into [year, month]. */
function parseYearMonth(isoDate: string): [number, number] {
  const [year, month] = isoDate.split("-");
  return [Number(year), Number(month)];
}
