import { BELGRADE_TZ } from "@beosand/types";
import ical from "ical-generator";

export interface TrainingIcsItem {
  trainingId: string;
  date: string;
  startTime: string;
  endTime: string;
  levelName: string | null;
  groupName: string | null;
  trainerName: string;
  courtNumber: number | null;
}

export interface TrainingIcsOptions {
  name?: string;
  uidSuffix?: string;
  summaryFallback?: string;
  summarySeparator?: string;
  courtLabel?: (courtNumber: number) => string;
}

export function renderTrainingIcs(
  subject: "trainer" | "client",
  items: TrainingIcsItem[],
  options: TrainingIcsOptions = {}
): string {
  const calendar = ical({
    name:
      options.name ??
      (subject === "trainer" ? "BeoSand — тренировки тренера" : "BeoSand — мои тренировки"),
    prodId: { company: "BeoSand", product: "calendar-feed", language: "RU" },
    timezone: BELGRADE_TZ
  });

  for (const item of items) {
    const event = calendar.createEvent({
      id: `training-${item.trainingId}-${options.uidSuffix ?? subject}@beosand`,
      start: belgradeWallClock(item.date, item.startTime),
      end: belgradeWallClock(item.date, item.endTime),
      summary: summaryOf(item, options)
    });
    event.timezone(BELGRADE_TZ);
    if (item.courtNumber !== null) {
      event.location((options.courtLabel ?? defaultCourtLabel)(item.courtNumber));
    }
  }

  return calendar.toString();
}

/**
 * A Date whose local fields equal the Belgrade wall-clock for `date`/`time`.
 * ical-generator renders TZID events from local components, not absolute instants.
 */
function belgradeWallClock(date: string, time: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

function summaryOf(item: TrainingIcsItem, options: TrainingIcsOptions): string {
  const label = item.levelName ?? item.groupName ?? options.summaryFallback ?? "Тренировка";
  return `${label}${options.summarySeparator ?? " • "}${item.trainerName}`;
}

function defaultCourtLabel(courtNumber: number): string {
  return `Корт ${courtNumber}`;
}
