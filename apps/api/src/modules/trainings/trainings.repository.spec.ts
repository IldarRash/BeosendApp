import { PgDialect } from "drizzle-orm/pg-core";
import { tables, type Database } from "@beosand/db";
import { describe, expect, it } from "vitest";
import { TrainingsRepository } from "./trainings.repository";
import type { DatabaseService } from "../../db/database.service";

const TRAINING_ID = "11111111-1111-4111-8111-111111111111";
const CLIENT_ID = "22222222-2222-4222-8222-222222222222";
const GROUP_ID = "33333333-3333-4333-8333-333333333333";
const TRAINER_ID = "44444444-4444-4444-8444-444444444444";

async function runAccessCheck(input: {
  bookingRows?: unknown[];
  waitlistRows?: unknown[];
}): Promise<{ result: boolean; rendered: Array<{ sql: string; params: unknown[] }> }> {
  const wheres: unknown[] = [];
  const responses = [input.bookingRows ?? [], input.waitlistRows ?? []];
  let selectCall = 0;

  const db = {
    select: () => {
      const callIndex = selectCall;
      selectCall += 1;
      const builder = {
        from: () => builder,
        where: (predicate: unknown) => {
          wheres.push(predicate);
          return builder;
        },
        limit: async () => responses[callIndex] ?? []
      };
      return builder;
    }
  } as unknown as Database;

  const repo = new TrainingsRepository({ db } as unknown as DatabaseService);
  const result = await repo.hasActiveParticipantAccess(TRAINING_ID, CLIENT_ID);
  const dialect = new PgDialect();
  return {
    result,
    rendered: wheres.map((where) => dialect.sqlToQuery(where as never))
  };
}

describe("TrainingsRepository.hasActiveParticipantAccess", () => {
  it("permits a client with a live booking on the training", async () => {
    const { result, rendered } = await runAccessCheck({
      bookingRows: [{ id: "booking-id" }]
    });

    expect(result).toBe(true);
    expect(rendered).toHaveLength(1);
    expect(rendered[0].sql.toLowerCase()).toContain('"bookings"."training_id" =');
    expect(rendered[0].sql.toLowerCase()).toContain('"bookings"."client_id" =');
    expect(rendered[0].params).toEqual(
      expect.arrayContaining([TRAINING_ID, CLIENT_ID, "pending", "booked", "attended", "no_show"])
    );
  });

  it("permits a client with an active waitlist entry when no booking exists", async () => {
    const { result, rendered } = await runAccessCheck({
      bookingRows: [],
      waitlistRows: [{ id: "waitlist-id" }]
    });

    expect(result).toBe(true);
    expect(rendered).toHaveLength(2);
    expect(rendered[1].sql.toLowerCase()).toContain('"waitlist"."training_id" =');
    expect(rendered[1].sql.toLowerCase()).toContain('"waitlist"."client_id" =');
    expect(rendered[1].params).toEqual(
      expect.arrayContaining([TRAINING_ID, CLIENT_ID, "waiting", "notified"])
    );
  });

  it("rejects an unrelated client with neither booking nor waitlist access", async () => {
    const { result, rendered } = await runAccessCheck({
      bookingRows: [],
      waitlistRows: []
    });

    expect(result).toBe(false);
    expect(rendered).toHaveLength(2);
  });
});

describe("TrainingsRepository.listInRange", () => {
  it("includes the trainer predicate when trainerId is supplied", async () => {
    let rendered: { sql: string; params: unknown[] } | undefined;
    const dialect = new PgDialect();
    const builder = {
      from: () => builder,
      where: (predicate: unknown) => {
        rendered = dialect.sqlToQuery(predicate as never);
        return builder;
      },
      orderBy: async () => [] as unknown[]
    };
    const db = {
      select: () => builder
    } as unknown as Database;
    const repo = new TrainingsRepository({ db } as unknown as DatabaseService);

    await repo.listInRange("2026-07-01", "2026-07-31", GROUP_ID, TRAINER_ID);

    expect(rendered).toBeDefined();
    expect(rendered?.sql.toLowerCase()).toContain('"trainings"."trainer_id" =');
    expect(rendered?.params).toEqual(
      expect.arrayContaining([
        "2026-07-01",
        "2026-07-31",
        GROUP_ID,
        TRAINER_ID,
        "cancelled",
        "completed"
      ])
    );
  });
});

describe("TrainingsRepository.listSchedule", () => {
  it("selects the joined group name for the shared slot card and context label", async () => {
    let selection: Record<string, unknown> | undefined;
    const builder = {
      from: () => builder,
      innerJoin: () => builder,
      where: () => builder,
      orderBy: async () => [] as unknown[]
    };
    const db = {
      select: (columns: Record<string, unknown>) => {
        selection = columns;
        return builder;
      }
    } as unknown as Database;
    const repo = new TrainingsRepository({ db } as unknown as DatabaseService);

    await repo.listSchedule("2026-07-01", "2026-07-31");

    expect(selection).toBeDefined();
    expect(selection?.groupName).toBe(tables.groups.name);
    expect(selection?.trainingContextLabel).toBe(tables.groups.name);
  });
});

describe("TrainingsRepository.listAvailable", () => {
  it("selects the joined group name for the shared slot card", async () => {
    let selection: Record<string, unknown> | undefined;
    const builder = {
      from: () => builder,
      innerJoin: () => builder,
      where: () => builder,
      orderBy: async () => [] as unknown[]
    };
    const db = {
      select: (columns: Record<string, unknown>) => {
        selection = columns;
        return builder;
      }
    } as unknown as Database;
    const repo = new TrainingsRepository({ db } as unknown as DatabaseService);

    await repo.listAvailable("2026-07-01", "2026-07-31");

    expect(selection).toBeDefined();
    expect(selection?.groupName).toBe(tables.groups.name);
  });
});
