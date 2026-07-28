import { z } from "zod";
import {
  dateString,
  isSlotAligned,
  minutesOfDay,
  normalizeUsername,
  timeString
} from "./common";
import { broadcastAudienceSchema } from "./training-contracts";

/** Manager contact shown to clients. Allows handles, phones, or short free text. */
export const managerContactValueSchema = z.string().trim().min(1).max(120);

export const managerContactSchema = z
  .object({
    contact: managerContactValueSchema,
    url: z.string().url().nullable()
  })
  .strict();
export type ManagerContact = z.infer<typeof managerContactSchema>;

export const updateManagerContactSchema = z
  .object({
    contact: managerContactValueSchema
  })
  .strict();
export type UpdateManagerContactInput = z.infer<typeof updateManagerContactSchema>;

export const requestLoggingSettingsSchema = z
  .object({
    detailed: z.boolean()
  })
  .strict();
export type RequestLoggingSettings = z.infer<typeof requestLoggingSettingsSchema>;

export const updateRequestLoggingSettingsSchema = z
  .object({
    detailed: z.boolean()
  })
  .strict();
export type UpdateRequestLoggingSettingsInput = z.infer<
  typeof updateRequestLoggingSettingsSchema
>;

const sameDayFreedSlotAutomationSettingsShape = {
  enabled: z.boolean(),
  audience: broadcastAudienceSchema.nullable()
};

export const sameDayFreedSlotAutomationSettingsSchema = z
  .object(sameDayFreedSlotAutomationSettingsShape)
  .strict()
  .refine((value) => !value.enabled || value.audience !== null, {
    message: "Audience is required when same-day freed-slot automation is enabled.",
    path: ["audience"]
  });
export type SameDayFreedSlotAutomationSettings = z.infer<
  typeof sameDayFreedSlotAutomationSettingsSchema
>;

export const updateSameDayFreedSlotAutomationSettingsSchema = z
  .object(sameDayFreedSlotAutomationSettingsShape)
  .strict()
  .refine((value) => !value.enabled || value.audience !== null, {
    message: "Audience is required when same-day freed-slot automation is enabled.",
    path: ["audience"]
  });
export type UpdateSameDayFreedSlotAutomationSettingsInput = z.infer<
  typeof updateSameDayFreedSlotAutomationSettingsSchema
>;

const calendarYear = z.coerce.number().int().min(2000).max(2100);
const calendarMonth = z.coerce.number().int().min(1).max(12);
const semanticDateString = dateString.refine(isRealIsoDate, "expected a real YYYY-MM-DD date");

export const courtWorkingHoursSourceSchema = z.enum(["day", "month", "fallback"]);
export type CourtWorkingHoursSource = z.infer<typeof courtWorkingHoursSourceSchema>;

const courtWorkingHoursWindowShape = {
  openTime: timeString,
  closeTime: timeString
};

export const courtWorkingHoursWindowSchema = z
  .object({
    ...courtWorkingHoursWindowShape
  })
  .strict()
  .refine((value) => isSlotAligned(value.openTime) && isSlotAligned(value.closeTime), {
    message: "Court working hours must use 30-minute aligned HH:mm times."
  })
  .refine((value) => minutesOfDay(value.openTime) < minutesOfDay(value.closeTime), {
    message: "Court working hours openTime must be before closeTime.",
    path: ["closeTime"]
  });
export type CourtWorkingHoursWindow = z.infer<typeof courtWorkingHoursWindowSchema>;

export const courtWorkingHoursSchema = z
  .object({
    date: semanticDateString,
    ...courtWorkingHoursWindowShape,
    source: courtWorkingHoursSourceSchema
  })
  .strict()
  .refine((value) => isSlotAligned(value.openTime) && isSlotAligned(value.closeTime), {
    message: "Court working hours must use 30-minute aligned HH:mm times."
  })
  .refine((value) => minutesOfDay(value.openTime) < minutesOfDay(value.closeTime), {
    message: "Court working hours openTime must be before closeTime.",
    path: ["closeTime"]
  });
export type CourtWorkingHours = z.infer<typeof courtWorkingHoursSchema>;

export const courtWorkingHoursMonthQuerySchema = z
  .object({
    year: calendarYear,
    month: calendarMonth
  })
  .strict();
export type CourtWorkingHoursMonthQuery = z.infer<typeof courtWorkingHoursMonthQuerySchema>;

export const updateCourtWorkingHoursMonthSchema = z
  .object({
    year: calendarYear,
    month: calendarMonth,
    ...courtWorkingHoursWindowShape
  })
  .strict()
  .refine((value) => isSlotAligned(value.openTime) && isSlotAligned(value.closeTime), {
    message: "Court working hours must use 30-minute aligned HH:mm times."
  })
  .refine((value) => minutesOfDay(value.openTime) < minutesOfDay(value.closeTime), {
    message: "Court working hours openTime must be before closeTime.",
    path: ["closeTime"]
  });
export type UpdateCourtWorkingHoursMonth = z.infer<typeof updateCourtWorkingHoursMonthSchema>;

export const courtWorkingHoursDayQuerySchema = z
  .object({
    date: semanticDateString
  })
  .strict();
export type CourtWorkingHoursDayQuery = z.infer<typeof courtWorkingHoursDayQuerySchema>;

export const updateCourtWorkingHoursDaySchema = z
  .object({
    date: semanticDateString,
    ...courtWorkingHoursWindowShape
  })
  .strict()
  .refine((value) => isSlotAligned(value.openTime) && isSlotAligned(value.closeTime), {
    message: "Court working hours must use 30-minute aligned HH:mm times."
  })
  .refine((value) => minutesOfDay(value.openTime) < minutesOfDay(value.closeTime), {
    message: "Court working hours openTime must be before closeTime.",
    path: ["closeTime"]
  });
export type UpdateCourtWorkingHoursDay = z.infer<typeof updateCourtWorkingHoursDaySchema>;

export const courtWorkingHoursMonthSchema = z
  .object({
    year: calendarYear,
    month: calendarMonth,
    ...courtWorkingHoursWindowShape,
    updatedAt: z.string().datetime(),
    updatedBy: z.number().int().nullable()
  })
  .strict()
  .refine((value) => isSlotAligned(value.openTime) && isSlotAligned(value.closeTime), {
    message: "Court working hours must use 30-minute aligned HH:mm times."
  })
  .refine((value) => minutesOfDay(value.openTime) < minutesOfDay(value.closeTime), {
    message: "Court working hours openTime must be before closeTime.",
    path: ["closeTime"]
  });
export type CourtWorkingHoursMonth = z.infer<typeof courtWorkingHoursMonthSchema>;

export const courtWorkingHoursDayOverrideSchema = z
  .object({
    date: semanticDateString,
    ...courtWorkingHoursWindowShape,
    updatedAt: z.string().datetime(),
    updatedBy: z.number().int().nullable()
  })
  .strict()
  .refine((value) => isSlotAligned(value.openTime) && isSlotAligned(value.closeTime), {
    message: "Court working hours must use 30-minute aligned HH:mm times."
  })
  .refine((value) => minutesOfDay(value.openTime) < minutesOfDay(value.closeTime), {
    message: "Court working hours openTime must be before closeTime.",
    path: ["closeTime"]
  });
export type CourtWorkingHoursDayOverride = z.infer<typeof courtWorkingHoursDayOverrideSchema>;

export const courtWorkingHoursMonthViewSchema = z
  .object({
    year: calendarYear,
    month: calendarMonth,
    fallback: courtWorkingHoursWindowSchema,
    monthDefault: courtWorkingHoursMonthSchema.nullable(),
    dayOverrides: z.array(courtWorkingHoursDayOverrideSchema)
  })
  .strict();
export type CourtWorkingHoursMonthView = z.infer<typeof courtWorkingHoursMonthViewSchema>;

export const courtWorkingHoursDayViewSchema = z
  .object({
    date: semanticDateString,
    effective: courtWorkingHoursSchema,
    fallback: courtWorkingHoursWindowSchema,
    monthDefault: courtWorkingHoursMonthSchema.nullable(),
    dayOverride: courtWorkingHoursDayOverrideSchema.nullable()
  })
  .strict();
export type CourtWorkingHoursDayView = z.infer<typeof courtWorkingHoursDayViewSchema>;

/** Build a t.me link only for a valid Telegram username/handle; other contacts stay plain text. */
export function managerContactTelegramUrl(contact: string): string | null {
  const username = normalizeUsername(contact);
  if (!/^[a-z0-9_]{5,32}$/.test(username)) {
    return null;
  }
  return `https://t.me/${username}`;
}

function isRealIsoDate(value: string): boolean {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}
