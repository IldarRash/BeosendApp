import { describe, expect, it, vi } from "vitest";
import type { DatabaseService } from "../../db/database.service";
import { reminderWindow } from "./notification-messages";
import { NotificationsRepository } from "./notifications.repository";

class CapturingSelectQuery {
  whereCondition: unknown;

  from = vi.fn(() => this);
  innerJoin = vi.fn(() => this);
  leftJoin = vi.fn(() => this);
  where = vi.fn((condition: unknown): [] => {
    this.whereCondition = condition;
    return [];
  });
}

function collectTimestampParams(value: unknown): string[] {
  const timestamps: string[] = [];

  const visit = (node: unknown): void => {
    if (typeof node === "string") {
      if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(node)) {
        timestamps.push(node);
      }
      return;
    }

    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }

    if (node !== null && typeof node === "object" && "queryChunks" in node) {
      visit((node as { queryChunks?: unknown }).queryChunks);
    }
  };

  visit(value);
  return timestamps;
}

describe("NotificationsRepository reminder window formatting", () => {
  it("compares training date/time against Europe/Belgrade wall-clock bounds", async () => {
    const originalTimeZone = process.env.TZ;
    process.env.TZ = "UTC";

    try {
      const query = new CapturingSelectQuery();
      const database = {
        db: {
          select: vi.fn(() => query)
        }
      } as unknown as DatabaseService;
      const repo = new NotificationsRepository(database);

      const { start, end } = reminderWindow("reminder-3h", new Date("2026-07-06T14:45:00Z"));

      await repo.findDueReminders("reminder-3h", start, end);

      const timestampParams = collectTimestampParams(query.whereCondition);
      expect(timestampParams).toEqual(
        expect.arrayContaining(["2026-07-06 19:30:00", "2026-07-06 20:00:00"])
      );
      expect(timestampParams).not.toContain("2026-07-06 17:30:00");
      expect(timestampParams).not.toContain("2026-07-06 18:00:00");
    } finally {
      if (originalTimeZone === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = originalTimeZone;
      }
    }
  });
});
