import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { SettingsController } from "./settings.controller";
import type { SettingsService } from "./settings.service";

const CONTACT = { contact: "@beosand", url: "https://t.me/beosand" };

function build() {
  const settings = {
    managerContact: vi.fn(async () => CONTACT),
    updateManagerContact: vi.fn(async () => CONTACT)
  } as unknown as SettingsService;
  return { controller: new SettingsController(settings), settings };
}

describe("SettingsController", () => {
  it("GET /settings/manager-contact is public and delegates to the service fallback logic", async () => {
    const { controller, settings } = build();

    await expect(controller.managerContact()).resolves.toEqual(CONTACT);
    expect(settings.managerContact).toHaveBeenCalledOnce();
  });

  it("PATCH /settings/manager-contact validates the body and passes the actor id", async () => {
    const { controller, settings } = build();

    await expect(
      controller.updateManagerContact("111", { contact: "  @beosand  " })
    ).resolves.toEqual(CONTACT);
    expect(settings.updateManagerContact).toHaveBeenCalledWith(111, { contact: "@beosand" });
  });

  it("rejects a missing or invalid actor header before the update service runs", () => {
    const { controller, settings } = build();

    expect(() => controller.updateManagerContact(undefined, { contact: "@beosand" })).toThrow(
      BadRequestException
    );
    expect(() => controller.updateManagerContact("12.5", { contact: "@beosand" })).toThrow(
      BadRequestException
    );
    expect(settings.updateManagerContact).not.toHaveBeenCalled();
  });

  it("rejects invalid or extra body fields before the update service runs", () => {
    const { controller, settings } = build();

    expect(() => controller.updateManagerContact("111", { contact: " " })).toThrow(
      BadRequestException
    );
    expect(() =>
      controller.updateManagerContact("111", { contact: "@beosand", url: "https://t.me/beosand" })
    ).toThrow(BadRequestException);
    expect(settings.updateManagerContact).not.toHaveBeenCalled();
  });
});
