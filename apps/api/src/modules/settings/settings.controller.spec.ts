import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { SettingsController } from "./settings.controller";
import type { SettingsService } from "./settings.service";

const CONTACT = { contact: "@beosand", url: "https://t.me/beosand" };
const REQUEST_LOGGING = { detailed: true };
const MONTH_VIEW = {
  year: 2026,
  month: 7,
  fallback: { openTime: "07:00", closeTime: "21:00" },
  monthDefault: null,
  dayOverrides: []
};
const DAY_VIEW = {
  date: "2026-07-15",
  effective: {
    date: "2026-07-15",
    openTime: "07:00",
    closeTime: "21:00",
    source: "fallback"
  },
  fallback: { openTime: "07:00", closeTime: "21:00" },
  monthDefault: null,
  dayOverride: null
};
const MONTH_SETTING = {
  year: 2026,
  month: 7,
  openTime: "08:00",
  closeTime: "20:00",
  updatedAt: "2026-07-02T10:00:00.000Z",
  updatedBy: 111
};
const DAY_SETTING = {
  date: "2026-07-15",
  openTime: "09:00",
  closeTime: "18:00",
  updatedAt: "2026-07-02T10:00:00.000Z",
  updatedBy: 111
};

function build() {
  const settings = {
    managerContact: vi.fn(async () => CONTACT),
    updateManagerContact: vi.fn(async () => CONTACT),
    requestLoggingSettings: vi.fn(async () => REQUEST_LOGGING),
    updateRequestLoggingSettings: vi.fn(async () => REQUEST_LOGGING),
    courtWorkingHoursMonthView: vi.fn(async () => MONTH_VIEW),
    updateCourtWorkingHoursMonth: vi.fn(async () => MONTH_SETTING),
    deleteCourtWorkingHoursMonth: vi.fn(async () => undefined),
    courtWorkingHoursDayView: vi.fn(async () => DAY_VIEW),
    updateCourtWorkingHoursDay: vi.fn(async () => DAY_SETTING),
    deleteCourtWorkingHoursDay: vi.fn(async () => undefined)
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

  it("GET /settings/request-logging parses the admin actor and delegates", async () => {
    const { controller, settings } = build();

    await expect(controller.requestLoggingSettings("111")).resolves.toEqual(REQUEST_LOGGING);
    expect(settings.requestLoggingSettings).toHaveBeenCalledWith(111);
  });

  it("PATCH /settings/request-logging validates the strict body and passes the actor id", async () => {
    const { controller, settings } = build();

    await expect(
      controller.updateRequestLoggingSettings("111", { detailed: true })
    ).resolves.toEqual(REQUEST_LOGGING);
    expect(settings.updateRequestLoggingSettings).toHaveBeenCalledWith(111, {
      detailed: true
    });
  });

  it("rejects invalid request logging actors and bodies before the service runs", () => {
    const { controller, settings } = build();

    expect(() => controller.requestLoggingSettings(undefined)).toThrow(BadRequestException);
    expect(() => controller.updateRequestLoggingSettings("nope", { detailed: true })).toThrow(
      BadRequestException
    );
    expect(() =>
      controller.updateRequestLoggingSettings("111", { detailed: true, token: "secret" })
    ).toThrow(BadRequestException);
    expect(() => controller.updateRequestLoggingSettings("111", { detailed: "true" })).toThrow(
      BadRequestException
    );
    expect(settings.requestLoggingSettings).not.toHaveBeenCalled();
    expect(settings.updateRequestLoggingSettings).not.toHaveBeenCalled();
  });

  it("GET /settings/court-hours/month validates the query and delegates", async () => {
    const { controller, settings } = build();

    await expect(
      controller.courtWorkingHoursMonth("111", { year: "2026", month: "7" })
    ).resolves.toEqual(MONTH_VIEW);
    expect(settings.courtWorkingHoursMonthView).toHaveBeenCalledWith(111, {
      year: 2026,
      month: 7
    });
  });

  it("PUT /settings/court-hours/month validates the body and delegates", async () => {
    const { controller, settings } = build();

    await expect(
      controller.updateCourtWorkingHoursMonth("111", {
        year: 2026,
        month: 7,
        openTime: "08:00",
        closeTime: "20:00"
      })
    ).resolves.toEqual(MONTH_SETTING);
    expect(settings.updateCourtWorkingHoursMonth).toHaveBeenCalledWith(111, {
      year: 2026,
      month: 7,
      openTime: "08:00",
      closeTime: "20:00"
    });
  });

  it("GET/PUT/DELETE /settings/court-hours/day validate date bodies and queries", async () => {
    const { controller, settings } = build();

    await expect(
      controller.courtWorkingHoursDay("111", { date: "2026-07-15" })
    ).resolves.toEqual(DAY_VIEW);
    await expect(
      controller.updateCourtWorkingHoursDay("111", {
        date: "2026-07-15",
        openTime: "09:00",
        closeTime: "18:00"
      })
    ).resolves.toEqual(DAY_SETTING);
    await expect(
      controller.deleteCourtWorkingHoursDay("111", { date: "2026-07-15" })
    ).resolves.toBeUndefined();

    expect(settings.courtWorkingHoursDayView).toHaveBeenCalledWith(111, {
      date: "2026-07-15"
    });
    expect(settings.updateCourtWorkingHoursDay).toHaveBeenCalledWith(111, {
      date: "2026-07-15",
      openTime: "09:00",
      closeTime: "18:00"
    });
    expect(settings.deleteCourtWorkingHoursDay).toHaveBeenCalledWith(111, {
      date: "2026-07-15"
    });
  });

  it("rejects invalid court-hours input before the service runs", () => {
    const { controller, settings } = build();

    expect(() => controller.courtWorkingHoursMonth("111", { year: "2026", month: "13" })).toThrow(
      BadRequestException
    );
    expect(() =>
      controller.updateCourtWorkingHoursDay("111", {
        date: "2026-02-30",
        openTime: "09:00",
        closeTime: "18:00"
      })
    ).toThrow(BadRequestException);
    expect(() =>
      controller.updateCourtWorkingHoursMonth("111", {
        year: 2026,
        month: 7,
        openTime: "09:15",
        closeTime: "18:00"
      })
    ).toThrow(BadRequestException);

    expect(settings.courtWorkingHoursMonthView).not.toHaveBeenCalled();
    expect(settings.updateCourtWorkingHoursDay).not.toHaveBeenCalled();
    expect(settings.updateCourtWorkingHoursMonth).not.toHaveBeenCalled();
  });
});
