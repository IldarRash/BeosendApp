import { tables, type Database } from "@beosand/db";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import type { DatabaseService } from "../../db/database.service";
import { BroadcastsRepository } from "./broadcasts.repository";

const TRAINING_ID = "11111111-1111-4111-8111-111111111111";
const BOOKING_ID = "22222222-2222-4222-8222-222222222222";
const CANCELLING_CLIENT_ID = "33333333-3333-4333-8333-333333333333";
const CLIENT_ID = "44444444-4444-4444-8444-444444444444";
const EVENT_ID = "55555555-5555-4555-8555-555555555555";
const DELIVERY_ID = "66666666-6666-4666-8666-666666666666";

function render(predicate: unknown): { sql: string; params: unknown[] } {
  const query = new PgDialect().sqlToQuery(predicate as never);
  return { sql: query.sql.toLowerCase(), params: query.params };
}

describe("BroadcastsRepository.filterSameDayFreedSlotRecipients", () => {
  it("excludes the canceller plus clients with booked/pending bookings or waiting/notified entries", async () => {
    const predicates: unknown[] = [];
    let selectIndex = 0;
    const db = {
      select: () => {
        const index = selectIndex++;
        const builder = {
          from: () => builder,
          where: (predicate: unknown) => {
            predicates[index] = predicate;
            if (index === 2) {
              return [];
            }
            return {
              getSQL: () => sql`select 1 where ${predicate as never}`
            };
          }
        };
        return builder;
      }
    } as unknown as Database;
    const repo = new BroadcastsRepository({ db } as unknown as DatabaseService);

    await repo.filterSameDayFreedSlotRecipients(
      [
        { telegramId: 111111, language: "sr" },
        { telegramId: 222222, language: "ru" }
      ],
      TRAINING_ID,
      CANCELLING_CLIENT_ID
    );

    expect(predicates).toHaveLength(3);
    const activeBooking = render(predicates[0]);
    expect(activeBooking.sql).toContain('"bookings"."client_id" = "clients"."id"');
    expect(activeBooking.sql).toContain('"bookings"."training_id" = $');
    expect(activeBooking.sql).toMatch(/"bookings"\."status" in \(\$\d+, \$\d+\)/);
    expect(activeBooking.params).toEqual([TRAINING_ID, "booked", "pending"]);

    const activeWaitlist = render(predicates[1]);
    expect(activeWaitlist.sql).toContain('"waitlist"."client_id" = "clients"."id"');
    expect(activeWaitlist.sql).toContain('"waitlist"."training_id" = $');
    expect(activeWaitlist.sql).toMatch(/"waitlist"\."status" in \(\$\d+, \$\d+\)/);
    expect(activeWaitlist.params).toEqual([TRAINING_ID, "waiting", "notified"]);

    const recipients = render(predicates[2]);
    expect(recipients.sql).toContain('"clients"."status" = $');
    expect(recipients.sql).toContain('"clients"."id" <> $');
    expect(recipients.sql).toContain('"clients"."telegram_id" is not null');
    expect(recipients.sql).toMatch(/"clients"\."telegram_id" in \(\$\d+, \$\d+\)/);
    expect((recipients.sql.match(/not exists/g) ?? [])).toHaveLength(2);
    expect(recipients.params).toEqual(
      expect.arrayContaining([
        "active",
        CANCELLING_CLIENT_ID,
        111111,
        222222,
        TRAINING_ID,
        "booked",
        "pending",
        "waiting",
        "notified"
      ])
    );
  });
});

describe("BroadcastsRepository same-day freed-slot claims", () => {
  it("uses training_id as the conflict arbiter so duplicate/concurrent event claims have one winner", async () => {
    const conflicts: Array<{ target?: unknown }> = [];
    let won = false;
    const db = {
      insert: () => {
        const builder = {
          values: () => builder,
          onConflictDoNothing: (config: { target?: unknown }) => {
            conflicts.push(config);
            return builder;
          },
          returning: async () => {
            if (won) {
              return [];
            }
            won = true;
            return [{ id: EVENT_ID }];
          }
        };
        return builder;
      }
    } as unknown as Database;
    const repo = new BroadcastsRepository({ db } as unknown as DatabaseService);
    const input = {
      cancelledBookingId: BOOKING_ID,
      trainingId: TRAINING_ID,
      audienceSnapshot: { kind: "all" } as const,
      occurrenceDate: "2026-07-17",
      occurrenceStartTime: "18:00",
      capacity: 6,
      bookedCount: 5
    };

    const claims = await Promise.all([
      repo.createSameDayFreedSlotEvent(input),
      repo.createSameDayFreedSlotEvent(input)
    ]);

    expect(claims).toEqual([{ id: EVENT_ID }, undefined]);
    expect(conflicts).toHaveLength(2);
    expect(conflicts.every((conflict) => conflict.target === tables.sameDayFreedSlotEvents.trainingId))
      .toBe(true);
  });

  it("claims each event/client delivery with claimed outcome and conflict-ignore semantics", async () => {
    const values: Array<Record<string, unknown>> = [];
    const conflictArgs: unknown[] = [];
    let won = false;
    const db = {
      insert: () => {
        const builder = {
          values: (input: Record<string, unknown>) => {
            values.push(input);
            return builder;
          },
          onConflictDoNothing: (config?: unknown) => {
            conflictArgs.push(config);
            return builder;
          },
          returning: async () => {
            if (won) {
              return [];
            }
            won = true;
            return [{ id: DELIVERY_ID }];
          }
        };
        return builder;
      }
    } as unknown as Database;
    const repo = new BroadcastsRepository({ db } as unknown as DatabaseService);
    const recipient = { clientId: CLIENT_ID, telegramId: 123456, language: "sr" as const };

    const claims = await Promise.all([
      repo.claimSameDayFreedSlotDelivery(EVENT_ID, recipient),
      repo.claimSameDayFreedSlotDelivery(EVENT_ID, recipient)
    ]);

    expect(claims).toEqual([{ id: DELIVERY_ID }, undefined]);
    expect(values).toEqual([
      { eventId: EVENT_ID, clientId: CLIENT_ID, telegramId: 123456, outcome: "claimed" },
      { eventId: EVENT_ID, clientId: CLIENT_ID, telegramId: 123456, outcome: "claimed" }
    ]);
    expect(conflictArgs).toEqual([undefined, undefined]);
  });
});

describe("BroadcastsRepository same-day freed-slot outcome transitions", () => {
  it.each([
    ["sent", (repo: BroadcastsRepository) => repo.markSameDayFreedSlotDeliverySent(DELIVERY_ID)],
    [
      "failed",
      (repo: BroadcastsRepository) =>
        repo.markSameDayFreedSlotDeliveryFailed(DELIVERY_ID, "definite failure")
    ],
    [
      "ambiguous",
      (repo: BroadcastsRepository) =>
        repo.markSameDayFreedSlotDeliveryAmbiguous(DELIVERY_ID, "unknown result")
    ]
  ])("guards the claimed -> %s transition", async (outcome, transition) => {
    let patch: Record<string, unknown> | undefined;
    let predicate: unknown;
    const builder = {
      set: (input: Record<string, unknown>) => {
        patch = input;
        return builder;
      },
      where: (input: unknown) => {
        predicate = input;
        return [];
      }
    };
    const db = { update: () => builder } as unknown as Database;
    const repo = new BroadcastsRepository({ db } as unknown as DatabaseService);

    await transition(repo);

    expect(patch).toMatchObject({ outcome });
    const guard = render(predicate);
    expect(guard.sql).toContain('"same_day_freed_slot_deliveries"."id" = $');
    expect(guard.sql).toContain('"same_day_freed_slot_deliveries"."outcome" = $');
    expect(guard.params).toEqual([DELIVERY_ID, "claimed"]);
  });

  it.each([
    [
      "skipped",
      "policy-disabled",
      (repo: BroadcastsRepository) =>
        repo.markSameDayFreedSlotEventSkipped(EVENT_ID, "policy-disabled")
    ],
    [
      "completed",
      null,
      (repo: BroadcastsRepository) => repo.markSameDayFreedSlotEventDispatched(EVENT_ID)
    ]
  ])("records the event terminal outcome %s", async (outcome, skipReason, transition) => {
    let patch: Record<string, unknown> | undefined;
    const builder = {
      set: (input: Record<string, unknown>) => {
        patch = input;
        return builder;
      },
      where: () => []
    };
    const db = { update: () => builder } as unknown as Database;
    const repo = new BroadcastsRepository({ db } as unknown as DatabaseService);

    await transition(repo);

    expect(patch).toMatchObject({ outcome, skipReason });
  });
});
