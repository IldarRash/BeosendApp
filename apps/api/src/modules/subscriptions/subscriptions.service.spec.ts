import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import type { Env } from "@beosand/config";
import type { Database } from "@beosand/db";
import type { BookingStatus, PriceSnapshotSource } from "@beosand/types";
import { beforeEach, describe, expect, it } from "vitest";
import { SubscriptionsService } from "./subscriptions.service";
import type { SubscriptionAggregateRow, SubscriptionsRepository } from "./subscriptions.repository";

const ADMIN_ID = 111;
const STRANGER_ID = 999;
const SUB_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_SUB_ID = "55555555-5555-4555-8555-555555555555";
const CLIENT_ID = "22222222-2222-2222-2222-222222222222";
const GROUP_ID = "33333333-3333-3333-3333-333333333333";

const env = { ADMIN_TELEGRAM_IDS: [String(ADMIN_ID)] } as unknown as Env;

/** One non-cancelled booking belonging to a subscription, for the fake to aggregate. */
interface FakeBooking {
  id: string;
  groupSubscriptionId: string;
  clientId: string;
  clientName: string;
  groupId: string | null;
  groupName: string | null;
  priceMonthRsd: number | null;
  trainingId: string;
  date: string;
  status: BookingStatus;
  paymentStatus: "paid" | "unpaid";
  paidAt: Date | null;
  paidBy: number | null;
  priceSnapshotRsd: number | null;
  priceSnapshotSource: PriceSnapshotSource | null;
  pricingTierId: string | null;
  pricingTierLabel: string | null;
  pricingTierMinTrainings: number | null;
  pricingTierMaxTrainings: number | null;
  bookingOrdinalInMonth: number | null;
  priceSnapshotAt: string | null;
}

/**
 * In-memory stand-in for the repository: it aggregates exactly as the SQL does
 * (only non-cancelled bookings counted; paidCount over payment_status='paid';
 * minDate the earliest date) so the service's paymentState / totalRsd derivation
 * is what is actually under test. transaction() runs the work inline.
 */
class FakeSubscriptionsRepository {
  bookings: FakeBooking[] = [];

  transaction<T>(work: (tx: Database) => Promise<T>): Promise<T> {
    return work({} as Database);
  }

  private active(): FakeBooking[] {
    return this.bookings.filter((b) => b.status !== "cancelled");
  }

  private aggregateRows(subId?: string): SubscriptionAggregateRow[] {
    const groups = new Map<string, FakeBooking[]>();
    for (const b of this.active()) {
      if (subId && b.groupSubscriptionId !== subId) continue;
      const list = groups.get(b.groupSubscriptionId) ?? [];
      list.push(b);
      groups.set(b.groupSubscriptionId, list);
    }
    return [...groups.entries()].map(([groupSubscriptionId, list]) => {
      const first = list[0];
      return {
        groupSubscriptionId,
        clientId: first.clientId,
        clientName: first.clientName,
        groupId: first.groupId,
        groupName: first.groupName,
        priceMonthRsd: first.priceMonthRsd,
        minDate: list.map((b) => b.date).sort()[0],
        dateCount: list.length,
        paidCount: list.filter((b) => b.paymentStatus === "paid").length,
        waitlistedCount: 0
      } satisfies SubscriptionAggregateRow;
    });
  }

  async aggregate(clientId?: string): Promise<SubscriptionAggregateRow[]> {
    const rows = this.aggregateRows();
    return clientId ? rows.filter((r) => r.clientId === clientId) : rows;
  }

  async aggregateOne(groupSubscriptionId: string): Promise<SubscriptionAggregateRow | undefined> {
    return this.aggregateRows(groupSubscriptionId)[0];
  }

  async setBatchPaid(
    _tx: Database,
    groupSubscriptionId: string,
    paid: boolean,
    actorTelegramId: number
  ): Promise<number> {
    const targets = this.bookings.filter(
      (b) => b.groupSubscriptionId === groupSubscriptionId && b.status !== "cancelled"
    );
    for (const b of targets) {
      b.paymentStatus = paid ? "paid" : "unpaid";
      b.paidAt = paid ? new Date() : null;
      b.paidBy = paid ? actorTelegramId : null;
    }
    return targets.length;
  }

  async listPricingBreakdown(groupSubscriptionId: string): Promise<
    Array<{
      bookingId: string;
      trainingId: string;
      date: string;
      status: BookingStatus;
      priceSnapshotRsd: number | null;
      priceSnapshotSource: PriceSnapshotSource | null;
      pricingTierId: string | null;
      pricingTierLabel: string | null;
      pricingTierMinTrainings: number | null;
      pricingTierMaxTrainings: number | null;
      bookingOrdinalInMonth: number | null;
      priceSnapshotAt: string | null;
    }>
  > {
    return this.bookings
      .filter((b) => b.groupSubscriptionId === groupSubscriptionId)
      .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
      .map((b) => ({
        bookingId: b.id,
        trainingId: b.trainingId,
        date: b.date,
        status: b.status,
        priceSnapshotRsd: b.priceSnapshotRsd,
        priceSnapshotSource: b.priceSnapshotSource,
        pricingTierId: b.pricingTierId,
        pricingTierLabel: b.pricingTierLabel,
        pricingTierMinTrainings: b.pricingTierMinTrainings,
        pricingTierMaxTrainings: b.pricingTierMaxTrainings,
        bookingOrdinalInMonth: b.bookingOrdinalInMonth,
        priceSnapshotAt: b.priceSnapshotAt
      }));
  }

  async monthlyPricingCounts(
    clientId: string,
    from: string,
    to: string
  ): Promise<{ pricingCountedBookingCount: number; excludedBookingCount: number }> {
    const monthRows = this.bookings.filter(
      (b) => b.clientId === clientId && b.groupId !== null && b.date >= from && b.date <= to
    );
    return {
      pricingCountedBookingCount: monthRows.filter(
        (b) => b.status === "booked" || b.status === "attended"
      ).length,
      excludedBookingCount: monthRows.filter((b) =>
        ["cancelled", "no_show", "waitlist", "pending"].includes(b.status)
      ).length
    };
  }
}

function makeBooking(overrides: Partial<FakeBooking> = {}): FakeBooking {
  const day = (overrides.date ?? "2026-06-03").slice(-2);
  return {
    id: `44444444-4444-4444-8444-0000000000${day}`,
    groupSubscriptionId: SUB_ID,
    clientId: CLIENT_ID,
    clientName: "Ана",
    groupId: GROUP_ID,
    groupName: "Утренняя",
    priceMonthRsd: 10000,
    trainingId: `66666666-6666-4666-8666-0000000000${day}`,
    date: "2026-06-03",
    status: "booked",
    paymentStatus: "unpaid",
    paidAt: null,
    paidBy: null,
    priceSnapshotRsd: 1500,
    priceSnapshotSource: "training_pricing_tier",
    pricingTierId: "77777777-7777-4777-8777-777777777777",
    pricingTierLabel: "1-3 trainings",
    pricingTierMinTrainings: 1,
    pricingTierMaxTrainings: 3,
    bookingOrdinalInMonth: 1,
    priceSnapshotAt: "2026-06-01T12:00:00.000Z",
    ...overrides
  };
}

let repo: FakeSubscriptionsRepository;
let service: SubscriptionsService;

beforeEach(() => {
  repo = new FakeSubscriptionsRepository();
  service = new SubscriptionsService(repo as unknown as SubscriptionsRepository, env);
});

describe("SubscriptionsService.list — payment-state derivation", () => {
  it("marks a subscription 'paid' when every non-cancelled booking is paid", async () => {
    repo.bookings = [
      makeBooking({ date: "2026-06-03", paymentStatus: "paid" }),
      makeBooking({ date: "2026-06-10", paymentStatus: "paid" })
    ];
    const [summary] = await service.list(ADMIN_ID, {});
    expect(summary.paymentState).toBe("paid");
    expect(summary.paidCount).toBe(2);
    expect(summary.dateCount).toBe(2);
  });

  it("marks a subscription 'unpaid' when no booking is paid", async () => {
    repo.bookings = [makeBooking(), makeBooking({ date: "2026-06-10" })];
    const [summary] = await service.list(ADMIN_ID, {});
    expect(summary.paymentState).toBe("unpaid");
    expect(summary.paidCount).toBe(0);
  });

  it("marks a subscription 'partial' when some are paid and some are not", async () => {
    repo.bookings = [
      makeBooking({ date: "2026-06-03", paymentStatus: "paid" }),
      makeBooking({ date: "2026-06-10", paymentStatus: "unpaid" })
    ];
    const [summary] = await service.list(ADMIN_ID, {});
    expect(summary.paymentState).toBe("partial");
    expect(summary.paidCount).toBe(1);
    expect(summary.dateCount).toBe(2);
  });

  it("excludes cancelled bookings from BOTH counts and the derived state", async () => {
    // Two paid + one cancelled-unpaid: state must be 'paid', not 'partial'.
    repo.bookings = [
      makeBooking({ date: "2026-06-03", paymentStatus: "paid" }),
      makeBooking({ date: "2026-06-10", paymentStatus: "paid" }),
      makeBooking({ date: "2026-06-17", status: "cancelled", paymentStatus: "unpaid" })
    ];
    const [summary] = await service.list(ADMIN_ID, {});
    expect(summary.dateCount).toBe(2);
    expect(summary.paidCount).toBe(2);
    expect(summary.paymentState).toBe("paid");
  });

  it("derives year/month from the earliest training date in the batch", async () => {
    repo.bookings = [
      makeBooking({ date: "2026-06-24" }),
      makeBooking({ date: "2026-06-03" }),
      makeBooking({ date: "2026-06-17" })
    ];
    const [summary] = await service.list(ADMIN_ID, {});
    expect(summary.year).toBe(2026);
    expect(summary.month).toBe(6);
  });

  it("sums stored booking snapshots, not groups.priceMonthRsd", async () => {
    repo.bookings = [
      makeBooking({ priceMonthRsd: 14000, priceSnapshotRsd: 1500 }),
      makeBooking({ date: "2026-06-10", priceMonthRsd: 14000, priceSnapshotRsd: 1400 })
    ];
    const [summary] = await service.list(ADMIN_ID, {});
    expect(summary.totalRsd).toBe(2900);
    expect(summary.storedBookingPricesRsd).toEqual([1500, 1400]);
  });

  it("keeps using stored snapshots when the subscription's group is gone", async () => {
    repo.bookings = [makeBooking({ groupId: null, groupName: null, priceMonthRsd: null })];
    const [summary] = await service.list(ADMIN_ID, {});
    expect(summary.totalRsd).toBe(1500);
    expect(summary.groupId).toBeNull();
  });

  it("counts and sums only booked/attended rows even if excluded statuses carry old snapshots", async () => {
    repo.bookings = [
      makeBooking({ id: "44444444-4444-4444-8444-000000000001", date: "2026-06-01", status: "booked", priceSnapshotRsd: 1500 }),
      makeBooking({ id: "44444444-4444-4444-8444-000000000002", date: "2026-06-02", status: "attended", priceSnapshotRsd: 1400 }),
      makeBooking({ id: "44444444-4444-4444-8444-000000000003", date: "2026-06-03", status: "cancelled", priceSnapshotRsd: 9999 }),
      makeBooking({ id: "44444444-4444-4444-8444-000000000004", date: "2026-06-04", status: "no_show", priceSnapshotRsd: 9999 }),
      makeBooking({ id: "44444444-4444-4444-8444-000000000005", date: "2026-06-05", status: "waitlist", priceSnapshotRsd: 9999 }),
      makeBooking({ id: "44444444-4444-4444-8444-000000000006", date: "2026-06-06", status: "pending", priceSnapshotRsd: 9999 })
    ];

    const [summary] = await service.list(ADMIN_ID, {});

    expect(summary.totalRsd).toBe(2900);
    expect(summary.storedBookingPricesRsd).toEqual([1500, 1400]);
    expect(summary.monthlyPricingCountContext).toMatchObject({
      pricingCountedBookingCount: 2,
      excludedBookingCount: 4,
      countedStatuses: ["booked", "attended"],
      excludedStatuses: ["cancelled", "no_show", "waitlist", "pending"],
      paymentStatusAffectsPricing: false
    });
  });

  it.each(["booked", "attended"] as const)(
    "rejects a %s subscription row missing its pricing snapshot",
    async (status) => {
      repo.bookings = [makeBooking({ status, priceSnapshotRsd: null })];

      await expect(service.list(ADMIN_ID, {})).rejects.toBeInstanceOf(ConflictException);
    }
  );

  it("applies the paymentState filter in the service", async () => {
    repo.bookings = [
      makeBooking({ groupSubscriptionId: SUB_ID, paymentStatus: "paid" }),
      makeBooking({ groupSubscriptionId: OTHER_SUB_ID, paymentStatus: "unpaid" })
    ];
    const paid = await service.list(ADMIN_ID, { paymentState: "paid" });
    expect(paid).toHaveLength(1);
    expect(paid[0].groupSubscriptionId).toBe(SUB_ID);
  });

  it("rejects a non-admin caller BEFORE any read", async () => {
    let read = false;
    repo.aggregate = async () => {
      read = true;
      return [];
    };
    await expect(service.list(STRANGER_ID, {})).rejects.toBeInstanceOf(ForbiddenException);
    expect(read).toBe(false);
  });
});

describe("SubscriptionsService.setPaid", () => {
  it("flips every non-cancelled booking paid and stamps paidAt/paidBy", async () => {
    repo.bookings = [
      makeBooking({ date: "2026-06-03" }),
      makeBooking({ date: "2026-06-10" })
    ];
    const summary = await service.setPaid(ADMIN_ID, SUB_ID, true);
    expect(summary.paymentState).toBe("paid");
    expect(summary.paidCount).toBe(2);
    for (const b of repo.bookings) {
      expect(b.paymentStatus).toBe("paid");
      expect(b.paidAt).toBeInstanceOf(Date);
      expect(b.paidBy).toBe(ADMIN_ID);
    }
  });

  it("leaves cancelled bookings untouched when marking the batch paid", async () => {
    const cancelled = makeBooking({ date: "2026-06-17", status: "cancelled" });
    repo.bookings = [makeBooking({ date: "2026-06-03" }), cancelled];
    await service.setPaid(ADMIN_ID, SUB_ID, true);
    expect(cancelled.paymentStatus).toBe("unpaid");
    expect(cancelled.paidAt).toBeNull();
    expect(cancelled.paidBy).toBeNull();
  });

  it("clears paidAt/paidBy when marking the batch unpaid", async () => {
    repo.bookings = [
      makeBooking({ paymentStatus: "paid", paidAt: new Date(), paidBy: ADMIN_ID })
    ];
    const summary = await service.setPaid(ADMIN_ID, SUB_ID, false);
    expect(summary.paymentState).toBe("unpaid");
    expect(repo.bookings[0].paidAt).toBeNull();
    expect(repo.bookings[0].paidBy).toBeNull();
  });

  it("does not change stored pricing snapshots, totals, or ordinals when paymentStatus changes", async () => {
    repo.bookings = [
      makeBooking({
        date: "2026-06-03",
        paymentStatus: "unpaid",
        priceSnapshotRsd: 1500,
        bookingOrdinalInMonth: 3
      }),
      makeBooking({
        date: "2026-06-10",
        paymentStatus: "unpaid",
        priceSnapshotRsd: 1400,
        pricingTierLabel: "4-7 trainings",
        pricingTierMinTrainings: 4,
        pricingTierMaxTrainings: 7,
        bookingOrdinalInMonth: 4
      })
    ];

    const paid = await service.setPaid(ADMIN_ID, SUB_ID, true);
    const unpaid = await service.setPaid(ADMIN_ID, SUB_ID, false);

    expect(paid.totalRsd).toBe(2900);
    expect(unpaid.totalRsd).toBe(2900);
    expect(paid.storedBookingPricesRsd).toEqual([1500, 1400]);
    expect(unpaid.storedBookingPricesRsd).toEqual([1500, 1400]);
    expect(unpaid.pricingBreakdown.map((row) => row.bookingOrdinalInMonth)).toEqual([3, 4]);
    expect(unpaid.monthlyPricingCountContext.paymentStatusAffectsPricing).toBe(false);
  });

  it("a fresh unpaid booking added after a paid batch makes the subscription 'partial'", async () => {
    repo.bookings = [makeBooking({ date: "2026-06-03" })];
    await service.setPaid(ADMIN_ID, SUB_ID, true);
    repo.bookings.push(makeBooking({ date: "2026-06-24", paymentStatus: "unpaid" }));
    const [summary] = await service.list(ADMIN_ID, {});
    expect(summary.paymentState).toBe("partial");
    expect(summary.paidCount).toBe(1);
    expect(summary.dateCount).toBe(2);
  });

  it("raises 404 when no non-cancelled booking matches the subscription id", async () => {
    repo.bookings = [makeBooking({ status: "cancelled" })];
    await expect(service.setPaid(ADMIN_ID, SUB_ID, true)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("rejects a non-admin caller BEFORE any write", async () => {
    repo.bookings = [makeBooking()];
    let wrote = false;
    repo.setBatchPaid = async () => {
      wrote = true;
      return 1;
    };
    await expect(service.setPaid(STRANGER_ID, SUB_ID, true)).rejects.toBeInstanceOf(
      ForbiddenException
    );
    expect(wrote).toBe(false);
  });
});
