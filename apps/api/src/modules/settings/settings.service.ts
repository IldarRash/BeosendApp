import { ForbiddenException, Inject, Injectable } from "@nestjs/common";
import type { Env } from "@beosand/config";
import { isAdmin } from "@beosand/config";
import {
  COURT_CLOSE_HOUR,
  COURT_OPEN_HOUR,
  courtWorkingHoursDayOverrideSchema,
  courtWorkingHoursDayViewSchema,
  courtWorkingHoursMonthSchema,
  courtWorkingHoursMonthViewSchema,
  courtWorkingHoursSchema,
  courtWorkingHoursWindowSchema,
  managerContactSchema,
  managerContactTelegramUrl,
  managerContactValueSchema,
  requestLoggingSettingsSchema,
  type CourtWorkingHours,
  type CourtWorkingHoursDayOverride,
  type CourtWorkingHoursDayQuery,
  type CourtWorkingHoursDayView,
  type CourtWorkingHoursMonth,
  type CourtWorkingHoursMonthQuery,
  type CourtWorkingHoursMonthView,
  type CourtWorkingHoursWindow,
  type ManagerContact,
  type RequestLoggingSettings,
  type UpdateCourtWorkingHoursDay,
  type UpdateCourtWorkingHoursMonth,
  type UpdateRequestLoggingSettingsInput,
  type UpdateManagerContactInput
} from "@beosand/types";
import { ENV } from "../../config/config.module";
import { SettingsRepository, type AppSettingRow } from "./settings.repository";

const MANAGER_CONTACT_KEY = "manager_contact";
const REQUEST_LOGGING_DETAILED_KEY = "request_logging_detailed";
const REQUEST_LOGGING_DETAILED_CACHE_TTL_MS = 1_000;
const COURT_HOURS_MONTH_KEY_PREFIX = "court_hours_month:";
const COURT_HOURS_DAY_KEY_PREFIX = "court_hours_day:";

interface RequestLoggingDetailedCache {
  detailed: boolean;
  expiresAt: number;
}

/** Owns settings domain logic: env fallback, admin gate, and contact URL derivation. */
@Injectable()
export class SettingsService {
  private requestLoggingDetailedCache: RequestLoggingDetailedCache | undefined;

  constructor(
    private readonly settings: SettingsRepository,
    @Inject(ENV) private readonly env: Env
  ) {}

  async managerContact(): Promise<ManagerContact> {
    const stored = await this.settings.findValue(MANAGER_CONTACT_KEY);
    return this.toManagerContact(stored ?? this.env.MANAGER_CONTACT);
  }

  async updateManagerContact(
    actorTelegramId: number,
    input: UpdateManagerContactInput
  ): Promise<ManagerContact> {
    this.assertAdmin(actorTelegramId);
    const value = await this.settings.upsertValue(
      MANAGER_CONTACT_KEY,
      input.contact,
      actorTelegramId
    );
    return this.toManagerContact(value);
  }

  async requestLoggingSettings(actorTelegramId: number): Promise<RequestLoggingSettings> {
    this.assertAdmin(actorTelegramId);
    return this.currentRequestLoggingSettings();
  }

  async updateRequestLoggingSettings(
    actorTelegramId: number,
    input: UpdateRequestLoggingSettingsInput
  ): Promise<RequestLoggingSettings> {
    this.assertAdmin(actorTelegramId);
    const value = input.detailed ? "true" : "false";
    const stored = await this.settings.upsertValue(
      REQUEST_LOGGING_DETAILED_KEY,
      value,
      actorTelegramId
    );
    const settings = this.toRequestLoggingSettings(stored);
    this.setRequestLoggingDetailedCache(settings.detailed);
    return settings;
  }

  async requestLoggingDetailedEnabled(): Promise<boolean> {
    const now = Date.now();
    if (
      this.requestLoggingDetailedCache &&
      this.requestLoggingDetailedCache.expiresAt > now
    ) {
      return this.requestLoggingDetailedCache.detailed;
    }

    const settings = await this.currentRequestLoggingSettings();
    this.setRequestLoggingDetailedCache(settings.detailed);
    return settings.detailed;
  }

  async courtWorkingHoursMonthView(
    actorTelegramId: number,
    input: CourtWorkingHoursMonthQuery
  ): Promise<CourtWorkingHoursMonthView> {
    this.assertAdmin(actorTelegramId);
    const [monthDefault, dayOverrides] = await Promise.all([
      this.findMonthDefault(input.year, input.month),
      this.findDayOverridesForMonth(input.year, input.month)
    ]);
    return courtWorkingHoursMonthViewSchema.parse({
      year: input.year,
      month: input.month,
      fallback: fallbackCourtWorkingHours(),
      monthDefault,
      dayOverrides
    });
  }

  async courtWorkingHoursDayView(
    actorTelegramId: number,
    input: CourtWorkingHoursDayQuery
  ): Promise<CourtWorkingHoursDayView> {
    this.assertAdmin(actorTelegramId);
    const [effective, monthDefault, dayOverride] = await Promise.all([
      this.resolveCourtWorkingHours(input.date),
      this.findMonthDefault(yearOf(input.date), monthOf(input.date)),
      this.findDayOverride(input.date)
    ]);
    return courtWorkingHoursDayViewSchema.parse({
      date: input.date,
      effective,
      fallback: fallbackCourtWorkingHours(),
      monthDefault,
      dayOverride
    });
  }

  async updateCourtWorkingHoursMonth(
    actorTelegramId: number,
    input: UpdateCourtWorkingHoursMonth
  ): Promise<CourtWorkingHoursMonth> {
    this.assertAdmin(actorTelegramId);
    const row = await this.settings.upsertRow(
      monthKey(input.year, input.month),
      serializeWindow(input),
      actorTelegramId
    );
    return this.toMonthDefault(input.year, input.month, row);
  }

  async deleteCourtWorkingHoursMonth(
    actorTelegramId: number,
    input: CourtWorkingHoursMonthQuery
  ): Promise<void> {
    this.assertAdmin(actorTelegramId);
    await this.settings.deleteValue(monthKey(input.year, input.month));
  }

  async updateCourtWorkingHoursDay(
    actorTelegramId: number,
    input: UpdateCourtWorkingHoursDay
  ): Promise<CourtWorkingHoursDayOverride> {
    this.assertAdmin(actorTelegramId);
    const row = await this.settings.upsertRow(
      dayKey(input.date),
      serializeWindow(input),
      actorTelegramId
    );
    return this.toDayOverride(input.date, row);
  }

  async deleteCourtWorkingHoursDay(
    actorTelegramId: number,
    input: CourtWorkingHoursDayQuery
  ): Promise<void> {
    this.assertAdmin(actorTelegramId);
    await this.settings.deleteValue(dayKey(input.date));
  }

  async resolveCourtWorkingHours(date: string): Promise<CourtWorkingHours> {
    const override = await this.findDayOverride(date);
    if (override) {
      return courtWorkingHoursSchema.parse({
        date,
        openTime: override.openTime,
        closeTime: override.closeTime,
        source: "day"
      });
    }

    const monthDefault = await this.findMonthDefault(yearOf(date), monthOf(date));
    if (monthDefault) {
      return courtWorkingHoursSchema.parse({
        date,
        openTime: monthDefault.openTime,
        closeTime: monthDefault.closeTime,
        source: "month"
      });
    }

    return courtWorkingHoursSchema.parse({
      date,
      ...fallbackCourtWorkingHours(),
      source: "fallback"
    });
  }

  private toManagerContact(value: string): ManagerContact {
    const contact = managerContactValueSchema.parse(value);
    return managerContactSchema.parse({
      contact,
      url: managerContactTelegramUrl(contact)
    });
  }

  private async currentRequestLoggingSettings(): Promise<RequestLoggingSettings> {
    const stored = await this.settings.findValue(REQUEST_LOGGING_DETAILED_KEY);
    return this.toRequestLoggingSettings(stored);
  }

  private toRequestLoggingSettings(value: string | undefined): RequestLoggingSettings {
    return requestLoggingSettingsSchema.parse({
      detailed: value === "true"
    });
  }

  private setRequestLoggingDetailedCache(detailed: boolean): void {
    this.requestLoggingDetailedCache = {
      detailed,
      expiresAt: Date.now() + REQUEST_LOGGING_DETAILED_CACHE_TTL_MS
    };
  }

  private assertAdmin(actorTelegramId: number): void {
    if (!isAdmin(this.env, actorTelegramId)) {
      throw new ForbiddenException("Admin privileges required");
    }
  }

  private async findMonthDefault(
    year: number,
    month: number
  ): Promise<CourtWorkingHoursMonth | null> {
    const row = await this.settings.findRow(monthKey(year, month));
    return row ? this.toMonthDefault(year, month, row) : null;
  }

  private async findDayOverride(date: string): Promise<CourtWorkingHoursDayOverride | null> {
    const row = await this.settings.findRow(dayKey(date));
    return row ? this.toDayOverride(date, row) : null;
  }

  private async findDayOverridesForMonth(
    year: number,
    month: number
  ): Promise<CourtWorkingHoursDayOverride[]> {
    const rows = await this.settings.findRowsByPrefix(dayKeyPrefix(year, month));
    return rows.map((row) => this.toDayOverride(row.key.slice(COURT_HOURS_DAY_KEY_PREFIX.length), row));
  }

  private toMonthDefault(year: number, month: number, row: AppSettingRow): CourtWorkingHoursMonth {
    return courtWorkingHoursMonthSchema.parse({
      year,
      month,
      ...parseWindow(row.value),
      updatedAt: row.updatedAt.toISOString(),
      updatedBy: row.updatedBy
    });
  }

  private toDayOverride(date: string, row: AppSettingRow): CourtWorkingHoursDayOverride {
    return courtWorkingHoursDayOverrideSchema.parse({
      date,
      ...parseWindow(row.value),
      updatedAt: row.updatedAt.toISOString(),
      updatedBy: row.updatedBy
    });
  }
}

function fallbackCourtWorkingHours(): CourtWorkingHoursWindow {
  return courtWorkingHoursWindowSchema.parse({
    openTime: `${String(COURT_OPEN_HOUR).padStart(2, "0")}:00`,
    closeTime: `${String(COURT_CLOSE_HOUR).padStart(2, "0")}:00`
  });
}

function serializeWindow(input: CourtWorkingHoursWindow): string {
  return JSON.stringify(
    courtWorkingHoursWindowSchema.parse({
      openTime: input.openTime,
      closeTime: input.closeTime
    })
  );
}

function parseWindow(value: string): CourtWorkingHoursWindow {
  return courtWorkingHoursWindowSchema.parse(JSON.parse(value));
}

function monthKey(year: number, month: number): string {
  return `${COURT_HOURS_MONTH_KEY_PREFIX}${year}-${pad2(month)}`;
}

function dayKey(date: string): string {
  return `${COURT_HOURS_DAY_KEY_PREFIX}${date}`;
}

function dayKeyPrefix(year: number, month: number): string {
  return `${COURT_HOURS_DAY_KEY_PREFIX}${year}-${pad2(month)}-`;
}

function yearOf(date: string): number {
  return Number(date.slice(0, 4));
}

function monthOf(date: string): number {
  return Number(date.slice(5, 7));
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}
