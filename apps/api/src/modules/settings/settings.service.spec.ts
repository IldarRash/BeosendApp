import { ForbiddenException } from "@nestjs/common";
import type { Env } from "@beosand/config";
import { describe, expect, it, vi } from "vitest";
import { SettingsRepository } from "./settings.repository";
import { SettingsService } from "./settings.service";

const ADMIN_ID = 111;
const NON_ADMIN_ID = 222;

function env(managerContact = "@env_manager"): Env {
  return {
    ADMIN_TELEGRAM_IDS: [String(ADMIN_ID)],
    MANAGER_CONTACT: managerContact
  } as unknown as Env;
}

function repo(stored?: string): SettingsRepository {
  return {
    findValue: vi.fn(async () => stored),
    upsertValue: vi.fn(async (_key: string, value: string) => value)
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
