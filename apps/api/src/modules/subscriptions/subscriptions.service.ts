import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import type { Env } from "@beosand/config";
import { isAdmin } from "@beosand/config";
import type { Database } from "@beosand/db";
import type {
  ListSubscriptionsQuery,
  SubscriptionPricingBreakdownRow,
  SubscriptionPaymentState,
  SubscriptionSummary
} from "@beosand/types";
import { subscriptionSummarySchema } from "@beosand/types";
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
 * server-side from immutable booking price snapshots.
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
    const summaries = await Promise.all(rows.map((row) => this.toSummary(row)));

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

    return this.repo.transaction(async (tx) => {
      const updated = await this.repo.setBatchPaid(tx, groupSubscriptionId, paid, actor);
      if (updated === 0) {
        throw new NotFoundException("Subscription not found");
      }
      const row = await this.repo.aggregateOne(groupSubscriptionId, tx);
      if (!row) {
        throw new NotFoundException("Subscription not found");
      }
      return this.toSummary(row, tx);
    });
  }

  /**
   * Derive a contract-validated summary from a raw aggregate row. Payment state
   * remains based on non-cancelled rows; pricing totals come only from stored
   * snapshots on booked/attended subscription bookings.
   */
  private async toSummary(
    row: SubscriptionAggregateRow,
    tx?: Database
  ): Promise<SubscriptionSummary> {
    const [year, month] = parseYearMonth(row.minDate);
    const [from, to] = monthBounds(year, month);
    const hasPricingBreakdown = typeof this.repo.listPricingBreakdown === "function";
    const breakdown =
      hasPricingBreakdown
        ? await this.repo.listPricingBreakdown(row.groupSubscriptionId, tx)
        : [];
    const counts =
      typeof this.repo.monthlyPricingCounts === "function"
        ? await this.repo.monthlyPricingCounts(row.clientId, from, to, tx)
        : { pricingCountedBookingCount: row.dateCount, excludedBookingCount: 0 };
    const pricingBreakdown = breakdown.map(toPricingBreakdownRow);
    const missingSnapshots = pricingBreakdown.filter(
      (booking) => isPricingCounted(booking.status) && booking.priceSnapshotRsd === null
    );
    if (missingSnapshots.length > 0) {
      throw new ConflictException(
        `Subscription ${row.groupSubscriptionId} has ${missingSnapshots.length} pricing-counted booking(s) without price snapshots`
      );
    }
    const storedBookingPricesRsd = pricingBreakdown
      .filter((booking) => isPricingCounted(booking.status) && booking.priceSnapshotRsd !== null)
      .map((booking) => booking.priceSnapshotRsd as number);
    const totalRsd = hasPricingBreakdown
      ? storedBookingPricesRsd.reduce((sum, price) => sum + price, 0)
      : row.priceMonthRsd ?? 0;

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
      paymentState: paymentStateOf(row.dateCount, row.paidCount),
      pricingScope: "client_calendar_month_all_groups",
      monthlyPricingCountContext: {
        clientId: row.clientId,
        year,
        month,
        pricingCountedBookingCount: counts.pricingCountedBookingCount,
        excludedBookingCount: counts.excludedBookingCount,
        countedStatuses: ["booked", "attended"],
        excludedStatuses: ["cancelled", "no_show", "waitlist", "pending"],
        paymentStatusAffectsPricing: false
      },
      storedBookingPricesRsd,
      pricingBreakdown
    });
  }

  private assertAdmin(actorTelegramId: number): void {
    if (!isAdmin(this.env, actorTelegramId)) {
      throw new ForbiddenException("Admin privileges required");
    }
  }
}

function toPricingBreakdownRow(
  row: Awaited<ReturnType<SubscriptionsRepository["listPricingBreakdown"]>>[number]
): SubscriptionPricingBreakdownRow {
  return {
    bookingId: row.bookingId,
    trainingId: row.trainingId,
    date: row.date,
    status: row.status,
    priceSnapshotRsd: row.priceSnapshotRsd,
    priceSnapshotSource: row.priceSnapshotSource,
    pricingTierId: row.pricingTierId,
    pricingTierLabel: row.pricingTierLabel,
    pricingTierMinTrainings: row.pricingTierMinTrainings,
    pricingTierMaxTrainings: row.pricingTierMaxTrainings,
    bookingOrdinalInMonth: row.bookingOrdinalInMonth,
    priceSnapshotAt: row.priceSnapshotAt
  };
}

function isPricingCounted(status: SubscriptionPricingBreakdownRow["status"]): boolean {
  return status === "booked" || status === "attended";
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

function monthBounds(year: number, month: number): [string, string] {
  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return [from, `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`];
}
