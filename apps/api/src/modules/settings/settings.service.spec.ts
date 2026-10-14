import { ForbiddenException, GoneException } from "@nestjs/common";
import type { Env } from "@beosand/config";
import { describe, expect, it, vi } from "vitest";
import { SettingsRepository, type AppSettingRow } from "./settings.repository";
import type { Database } from "@beosand/db";
import { SettingsService } from "./settings.service";

const ADMIN_ID = 111;
const NON_ADMIN_ID = 222;
const NOW = new Date("2026-07-02T10:00:00.000Z");

describe("global late-cancellation policy", () => {
  it("defaults to disabled, including malformed stored data", async () => {
    const repository = repo();
    const service = new SettingsService(repository, env());
    expect(await service.lateCancellationPolicy(ADMIN_ID)).toMatchObject({ enabled: false, hours: null });
    vi.mocked(repository.findRow).mockResolvedValue({ key: "policy", value: "invalid", updatedAt: NOW, updatedBy: ADMIN_ID });
    expect(await service.lateCancellationPolicy(ADMIN_ID)).toMatchObject({ enabled: false, hours: null });
  });

  it("serializes updates, advances the policy version, and retains no old liability state", async () => {
    const repository = repo();
    let stored: AppSettingRow | undefined;
    const tx = {} as Database;
    repository.transaction = async (work) => work(tx);
    repository.lockKey = vi.fn(async () => undefined);
    repository.findRowForUpdate = vi.fn(async () => stored);
    repository.upsertRowInTransaction = vi.fn(async (_tx, key, value, updatedBy) => {
      stored = { key, value, updatedBy, updatedAt: NOW };
      return stored;
    });
    const service = new SettingsService(repository, env());
    const enabled = await service.updateLateCancellationPolicy(ADMIN_ID, { enabled: true, hours: 24 });
    const disabled = await service.updateLateCancellationPolicy(ADMIN_ID, { enabled: false, hours: null });
    expect(enabled).toMatchObject({ enabled: true, hours: 24, version: 2, updatedBy: ADMIN_ID });
    expect(enabled.effectiveFrom).not.toBeNull();
    expect(disabled).toMatchObject({ enabled: false, hours: null, version: 3, effectiveFrom: null });
    expect(repository.lockKey).toHaveBeenCalledTimes(2);
    expect(repository.lockKey).toHaveBeenCalledWith(tx, "group_training_late_cancellation_policy_v1");
  });

  it("rejects unauthorized policy reads and writes before repository access", async () => {
    const repository = repo();
    const service = new SettingsService(repository, env());
    await expect(service.lateCancellationPolicy(NON_ADMIN_ID)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.updateLateCancellationPolicy(NON_ADMIN_ID, { enabled: true, hours: 24 })).rejects.toBeInstanceOf(ForbiddenException);
    expect(repository.findRow).not.toHaveBeenCalled();
  });
});

function env(managerContact = "@env_manager"): Env {
  return {
    ADMIN_TELEGRAM_IDS: [String(ADMIN_ID)],
    MANAGER_CONTACT: managerContact
  } as unknown as Env;
}

function repo(stored?: string): SettingsRepository {
  return {
    findValue: vi.fn(async () => stored),
    findRow: vi.fn(async () => undefined),
    findRowsByPrefix: vi.fn(async () => []),
    upsertValue: vi.fn(async (_key: string, value: string) => value),
    upsertRow: vi.fn(async (key: string, value: string, updatedBy: number) => ({
      key,
      value,
      updatedAt: NOW,
      updatedBy
    })),
    deleteValue: vi.fn(async () => true)
  } as unknown as SettingsRepository;
}

describe("SettingsService.managerContact", () => {
  it("falls back to the env contact and derives a Telegram URL", async () => {
    const settingsRepo = repo(undefined);
    const service = new SettingsService(settingsRepo, env("@fallback_manager"));

    await expect(service.managerContact()).resolves.toEqual({
      contact: "@fallback_manager",
      url: "https://t.me/fallback_manager"
    });
    expect(settingsRepo.findValue).toHaveBeenCalledWith("manager_contact");
  });

  it("uses the stored value and suppresses URL for free-text contacts", async () => {
    const service = new SettingsService(repo("+381 60 123 4567"), env("@fallback_manager"));

    await expect(service.managerContact()).resolves.toEqual({
      contact: "+381 60 123 4567",
      url: null
    });
  });

  it("rejects an invalid stored or fallback value instead of returning a broken contact", async () => {
    await expect(new SettingsService(repo(" "), env()).managerContact()).rejects.toThrow();
    await expect(new SettingsService(repo(undefined), env(" ")).managerContact()).rejects.toThrow();
  });
});

describe("SettingsService.updateManagerContact", () => {
  it("lets an admin update the shared contact and returns the derived link", async () => {
    const settingsRepo = repo();
    const service = new SettingsService(settingsRepo, env());

    await expect(
      service.updateManagerContact(ADMIN_ID, { contact: "@new_manager" })
    ).resolves.toEqual({
      contact: "@new_manager",
      url: "https://t.me/new_manager"
    });
    expect(settingsRepo.upsertValue).toHaveBeenCalledWith(
      "manager_contact",
      "@new_manager",
      ADMIN_ID
    );
  });

  it("forbids non-admin updates before writing", async () => {
    const settingsRepo = repo();
    const service = new SettingsService(settingsRepo, env());

    await expect(
      service.updateManagerContact(NON_ADMIN_ID, { contact: "@blocked_manager" })
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(settingsRepo.upsertValue).not.toHaveBeenCalled();
  });
});

describe("SettingsService.requestLoggingSettings", () => {
  it("defaults to detailed false when the app_settings key is absent", async () => {
    const settingsRepo = repo(undefined);
    const service = new SettingsService(settingsRepo, env());

    await expect(service.requestLoggingSettings(ADMIN_ID)).resolves.toEqual({ detailed: false });
    expect(settingsRepo.findValue).toHaveBeenCalledWith("request_logging_detailed");
  });

  it("reads true only from the stored string true", async () => {
    const service = new SettingsService(repo("true"), env());

    await expect(service.requestLoggingSettings(ADMIN_ID)).resolves.toEqual({ detailed: true });
  });

  it("forbids non-admin reads", async () => {
    const settingsRepo = repo("true");
    const service = new SettingsService(settingsRepo, env());

    await expect(service.requestLoggingSettings(NON_ADMIN_ID)).rejects.toBeInstanceOf(
      ForbiddenException
    );
    expect(settingsRepo.findValue).not.toHaveBeenCalled();
  });
});

describe("SettingsService.requestLoggingDetailedEnabled", () => {
  it("reuses the cached detailed flag for repeated request logging checks", async () => {
    const settingsRepo = repo("true");
    const service = new SettingsService(settingsRepo, env());

    await expect(service.requestLoggingDetailedEnabled()).resolves.toBe(true);
    await expect(service.requestLoggingDetailedEnabled()).resolves.toBe(true);

    expect(settingsRepo.findValue).toHaveBeenCalledTimes(1);
    expect(settingsRepo.findValue).toHaveBeenCalledWith("request_logging_detailed");
  });

  it("updates the cached detailed flag after an admin write", async () => {
    const settingsRepo = repo("false");
    const service = new SettingsService(settingsRepo, env());

    await expect(service.requestLoggingDetailedEnabled()).resolves.toBe(false);
    await expect(
      service.updateRequestLoggingSettings(ADMIN_ID, { detailed: true })
    ).resolves.toEqual({ detailed: true });
    await expect(service.requestLoggingDetailedEnabled()).resolves.toBe(true);

    expect(settingsRepo.findValue).toHaveBeenCalledTimes(1);
    expect(settingsRepo.upsertValue).toHaveBeenCalledWith(
      "request_logging_detailed",
      "true",
      ADMIN_ID
    );
  });
});

describe("SettingsService.updateRequestLoggingSettings", () => {
  it("lets an admin write the detailed flag as strings", async () => {
    const settingsRepo = repo();
    const service = new SettingsService(settingsRepo, env());

    await expect(
      service.updateRequestLoggingSettings(ADMIN_ID, { detailed: true })
    ).resolves.toEqual({ detailed: true });
    expect(settingsRepo.upsertValue).toHaveBeenCalledWith(
      "request_logging_detailed",
      "true",
      ADMIN_ID
    );
  });

  it("writes false as the string false", async () => {
    const settingsRepo = repo();
    const service = new SettingsService(settingsRepo, env());

    await expect(
      service.updateRequestLoggingSettings(ADMIN_ID, { detailed: false })
    ).resolves.toEqual({ detailed: false });
    expect(settingsRepo.upsertValue).toHaveBeenCalledWith(
      "request_logging_detailed",
      "false",
      ADMIN_ID
    );
  });

  it("forbids non-admin updates before writing", async () => {
    const settingsRepo = repo("false");
    const service = new SettingsService(settingsRepo, env());

    await expect(
      service.updateRequestLoggingSettings(NON_ADMIN_ID, { detailed: true })
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(settingsRepo.upsertValue).not.toHaveBeenCalled();
  });
});

describe("SettingsService same-day freed-slot automation", () => {
  it("defaults to disabled and unconfigured when the singleton key is absent", async () => {
    const settingsRepo = repo(undefined);
    const service = new SettingsService(settingsRepo, env());

    await expect(service.sameDayFreedSlotAutomationSettings(ADMIN_ID)).resolves.toEqual({
      enabled: false,
      audience: null
    });
    expect(settingsRepo.findValue).toHaveBeenCalledWith("same_day_freed_slot_automation");
  });

  it("rejects mutation of the retired global policy without writing app_settings", async () => {
    const settingsRepo = repo();
    const service = new SettingsService(settingsRepo, env());
    const input = { enabled: true, audience: { kind: "active" as const, days: 30 } };

    await expect(service.updateSameDayFreedSlotAutomationSettings(ADMIN_ID, input)).rejects.toBeInstanceOf(
      GoneException
    );
    expect(settingsRepo.upsertValue).not.toHaveBeenCalled();
  });

  it.each([
    "not-json",
    JSON.stringify({ enabled: true, audience: null }),
    JSON.stringify({ enabled: true, audience: { kind: "unknown" } }),
    JSON.stringify({ enabled: true, audience: { kind: "all" }, extra: true })
  ])("fails closed for corrupt persisted settings: %s", async (stored) => {
    const service = new SettingsService(repo(stored), env());

    await expect(service.currentSameDayFreedSlotAutomationSettings()).resolves.toEqual({
      enabled: false,
      audience: null
    });
  });

  it("forbids non-admin reads and writes before touching app_settings", async () => {
    const settingsRepo = repo(JSON.stringify({ enabled: false, audience: null }));
    const service = new SettingsService(settingsRepo, env());

    await expect(
      service.sameDayFreedSlotAutomationSettings(NON_ADMIN_ID)
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.updateSameDayFreedSlotAutomationSettings(NON_ADMIN_ID, {
        enabled: true,
        audience: { kind: "all" }
      })
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(settingsRepo.findValue).not.toHaveBeenCalled();
    expect(settingsRepo.upsertValue).not.toHaveBeenCalled();
  });
});

describe("SettingsService court working hours", () => {
  it("resolves day override before month default before fallback", async () => {
    const settingsRepo = repo();
    vi.mocked(settingsRepo.findRow).mockImplementation(async (key: string) => {
      if (key === "court_hours_day:2026-07-15") {
        return {
          key,
          value: JSON.stringify({ openTime: "09:00", closeTime: "18:00" }),
          updatedAt: NOW,
          updatedBy: ADMIN_ID
        };
      }
      if (key === "court_hours_month:2026-07") {
        return {
          key,
          value: JSON.stringify({ openTime: "08:00", closeTime: "20:00" }),
          updatedAt: NOW,
          updatedBy: ADMIN_ID
        };
      }
      return undefined;
    });
    const service = new SettingsService(settingsRepo, env());

    await expect(service.resolveCourtWorkingHours("2026-07-15")).resolves.toEqual({
      date: "2026-07-15",
      openTime: "09:00",
      closeTime: "18:00",
      source: "day"
    });
    await expect(service.resolveCourtWorkingHours("2026-07-16")).resolves.toEqual({
      date: "2026-07-16",
      openTime: "08:00",
      closeTime: "20:00",
      source: "month"
    });
    await expect(service.resolveCourtWorkingHours("2026-08-01")).resolves.toEqual({
      date: "2026-08-01",
      openTime: "07:00",
      closeTime: "21:00",
      source: "fallback"
    });
  });

  it("upserts month and day settings with the acting admin id", async () => {
    const settingsRepo = repo();
    const service = new SettingsService(settingsRepo, env());

    await expect(
      service.updateCourtWorkingHoursMonth(ADMIN_ID, {
        year: 2026,
        month: 7,
        openTime: "08:00",
        closeTime: "20:30"
      })
    ).resolves.toMatchObject({
      year: 2026,
      month: 7,
      openTime: "08:00",
      closeTime: "20:30",
      updatedBy: ADMIN_ID
    });
    expect(settingsRepo.upsertRow).toHaveBeenCalledWith(
      "court_hours_month:2026-07",
      JSON.stringify({ openTime: "08:00", closeTime: "20:30" }),
      ADMIN_ID
    );

    await expect(
      service.updateCourtWorkingHoursDay(ADMIN_ID, {
        date: "2026-07-15",
        openTime: "09:00",
        closeTime: "18:00"
      })
    ).resolves.toMatchObject({
      date: "2026-07-15",
      openTime: "09:00",
      closeTime: "18:00",
      updatedBy: ADMIN_ID
    });
    expect(settingsRepo.upsertRow).toHaveBeenCalledWith(
      "court_hours_day:2026-07-15",
      JSON.stringify({ openTime: "09:00", closeTime: "18:00" }),
      ADMIN_ID
    );
  });

  it("forbids non-admin working-hours writes before touching app_settings", async () => {
    const settingsRepo = repo();
    const service = new SettingsService(settingsRepo, env());

    await expect(
      service.updateCourtWorkingHoursDay(NON_ADMIN_ID, {
        date: "2026-07-15",
        openTime: "09:00",
        closeTime: "18:00"
      })
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(settingsRepo.upsertRow).not.toHaveBeenCalled();
  });
});
