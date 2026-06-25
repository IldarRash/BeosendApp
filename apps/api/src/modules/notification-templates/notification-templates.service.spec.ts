import { ForbiddenException } from "@nestjs/common";
import type { Env } from "@beosand/config";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NotificationTemplatesRepository } from "./notification-templates.repository";
import { NotificationTemplatesService } from "./notification-templates.service";

const ADMIN_ID = 111;
const NON_ADMIN_ID = 999;
const env = { ADMIN_TELEGRAM_IDS: [String(ADMIN_ID)] } as unknown as Env;

interface RepoMock {
  listOverrides: ReturnType<typeof vi.fn>;
  findOverride: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
}

function makeService(): { service: NotificationTemplatesService; repo: RepoMock } {
  const repo: RepoMock = {
    listOverrides: vi.fn().mockResolvedValue(new Map()),
    findOverride: vi.fn().mockResolvedValue(undefined),
    upsert: vi.fn(),
    remove: vi.fn().mockResolvedValue(true)
  };
  const service = new NotificationTemplatesService(
    repo as unknown as NotificationTemplatesRepository,
    env
  );
  return { service, repo };
}

describe("NotificationTemplatesService", () => {
  let service: NotificationTemplatesService;
  let repo: RepoMock;

  beforeEach(() => {
    ({ service, repo } = makeService());
  });

  describe("admin gate", () => {
    it("rejects a non-admin list", async () => {
      await expect(service.list(NON_ADMIN_ID, "ru")).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.listOverrides).not.toHaveBeenCalled();
    });

    it("rejects a non-admin update (no write)", async () => {
      await expect(
        service.update(NON_ADMIN_ID, "booking-confirmed", "ru", "x")
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.upsert).not.toHaveBeenCalled();
    });

    it("rejects a non-admin reset (no delete)", async () => {
      await expect(service.reset(NON_ADMIN_ID, "booking-confirmed", "ru")).rejects.toBeInstanceOf(
        ForbiddenException
      );
      expect(repo.remove).not.toHaveBeenCalled();
    });
  });

  describe("list", () => {
    it("returns all 13 events with default + audience + isOverridden + placeholders", async () => {
      const entries = await service.list(ADMIN_ID, "ru");
      expect(entries).toHaveLength(13);
      const confirmed = entries.find((e) => e.eventKey === "booking-confirmed");
      expect(confirmed?.audience).toBe("client");
      expect(confirmed?.isOverridden).toBe(false);
      expect(confirmed?.body).toBe(confirmed?.defaultBody);
      expect(confirmed?.defaultBody).toBe("Запись подтверждена ✅\n{training}");
      expect(confirmed?.placeholders).toContain("{training}");

      const adminEvent = entries.find((e) => e.eventKey === "booking-pending-admin");
      expect(adminEvent?.audience).toBe("staff");

      const waitlist = entries.find((e) => e.eventKey === "waitlist-displaced");
      expect(waitlist?.placeholders).toContain("{position}");
    });

    it("serves the locale default body when no override is set", async () => {
      const entries = await service.list(ADMIN_ID, "en");
      const confirmed = entries.find((e) => e.eventKey === "booking-confirmed");
      expect(confirmed?.defaultBody).toBe("Booking confirmed ✅\n{training}");
    });

    it("marks an event overridden and serves the override body for its locale", async () => {
      repo.listOverrides.mockResolvedValue(
        new Map<string, string>([["booking-confirmed:ru", "Custom {training}"]])
      );
      const entries = await service.list(ADMIN_ID, "ru");
      const confirmed = entries.find((e) => e.eventKey === "booking-confirmed");
      expect(confirmed?.isOverridden).toBe(true);
      expect(confirmed?.body).toBe("Custom {training}");
      expect(confirmed?.defaultBody).toBe("Запись подтверждена ✅\n{training}");
    });
  });

  describe("update", () => {
    it("upserts and returns the new effective (overridden) template", async () => {
      repo.upsert.mockResolvedValue({
        eventKey: "booking-confirmed",
        language: "ru",
        body: "New {training}"
      });
      const result = await service.update(ADMIN_ID, "booking-confirmed", "ru", "New {training}");
      expect(repo.upsert).toHaveBeenCalledWith("booking-confirmed", "ru", "New {training}");
      expect(result.isOverridden).toBe(true);
      expect(result.body).toBe("New {training}");
    });
  });

  describe("reset", () => {
    it("removes the override and returns the default template", async () => {
      const result = await service.reset(ADMIN_ID, "booking-confirmed", "ru");
      expect(repo.remove).toHaveBeenCalledWith("booking-confirmed", "ru");
      expect(result.isOverridden).toBe(false);
      expect(result.body).toBe("Запись подтверждена ✅\n{training}");
    });
  });
});
