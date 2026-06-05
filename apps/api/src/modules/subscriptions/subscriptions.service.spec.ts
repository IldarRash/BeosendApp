import { ForbiddenException, NotFoundException } from "@nestjs/common";
import type { Env } from "@beosand/config";
import type { Database } from "@beosand/db";
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
  groupSubscriptionId: string;
  clientId: string;
  clientName: string;
  groupId: string | null;
  groupName: string | null;
  priceMonthRsd: number | null;
  date: string;
  status: "booked" | "cancelled" | "attended";
  paymentStatus: "paid" | "unpaid";
  paidAt: Date | null;
  paidBy: number | null;
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
        paidCount: list.filter((b) => b.paymentStatus === "paid").length
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
}

function makeBooking(overrides: Partial<FakeBooking> = {}): FakeBooking {
  return {
    groupSubscriptionId: SUB_ID,
    clientId: CLIENT_ID,
    clientName: "Ана",
    groupId: GROUP_ID,
    groupName: "Утренняя",
    priceMonthRsd: 10000,
    date: "2026-06-03",
    status: "booked",
    paymentStatus: "unpaid",
    paidAt: null,
    paidBy: null,
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

  it("sources totalRsd from the group's priceMonthRsd (server-side), never summed", async () => {
    repo.bookings = [
      makeBooking({ priceMonthRsd: 14000 }),
      makeBooking({ date: "2026-06-10", priceMonthRsd: 14000 })
    ];
    const [summary] = await service.list(ADMIN_ID, {});
    // Two bookings but the total is the month price, not a per-booking sum.
    expect(summary.totalRsd).toBe(14000);
  });

  it("falls back to totalRsd 0 when the subscription's group is gone", async () => {
    repo.bookings = [makeBooking({ groupId: null, groupName: null, priceMonthRsd: null })];
    const [summary] = await service.list(ADMIN_ID, {});
    expect(summary.totalRsd).toBe(0);
    expect(summary.groupId).toBeNull();
  });

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
