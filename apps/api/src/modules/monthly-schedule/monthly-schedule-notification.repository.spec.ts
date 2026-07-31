import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import { MonthlyScheduleNotificationRepository } from "./monthly-schedule-notification.repository";

describe("MonthlyScheduleNotificationRepository", () => {
  it("claims and marks deliveries processing in one SKIP LOCKED statement", async () => {
    let statement: unknown;
    const db = {
      execute: vi.fn(async (input: unknown) => {
        statement = input;
        return { rows: [] };
      })
    };
    const repository = new MonthlyScheduleNotificationRepository({ db } as never);

    await repository.claim(20);

    const rendered = new PgDialect().sqlToQuery(statement as never).sql.toLowerCase();
    expect(rendered).toContain("for update skip locked");
    expect(rendered).toContain("set outcome = 'processing'");
    expect(rendered).toContain("attempts = delivery.attempts + 1");
  });

  it("turns expired processing claims ambiguous instead of making them retryable", async () => {
    let statement: unknown;
    const db = {
      execute: vi.fn(async (input: unknown) => {
        statement = input;
        return { rows: [] };
      })
    };
    const repository = new MonthlyScheduleNotificationRepository({ db } as never);

    await repository.expireProcessing();

    const rendered = new PgDialect().sqlToQuery(statement as never).sql.toLowerCase();
    expect(rendered).toContain("set outcome = 'ambiguous'");
    expect(rendered).toContain("where outcome = 'processing'");
    expect(rendered).not.toContain("outcome = 'pending'");
  });
});
