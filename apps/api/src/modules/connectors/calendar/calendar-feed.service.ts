import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Env } from "@beosand/config";
import { type CalendarSubject, BELGRADE_TZ, zonedWallClockToUtc } from "@beosand/types";
import ical from "ical-generator";
import { ENV } from "../../../config/config.module";
import { ClientsRepository } from "../../clients/clients.repository";
import { TrainersRepository } from "../../trainers/trainers.repository";
import { type CalendarFeedItem, TrainingsRepository } from "../../trainings/trainings.repository";
import { verifyFeedToken } from "./calendar-token";

/** Today's date (Belgrade) as "YYYY-MM-DD" — the feed's lower bound (only upcoming). */
function todayInBelgrade(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BELGRADE_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

/**
 * Builds the signed-token iCal (.ics) feed for a subject's upcoming trainings
 * (connectors §6, Slice A). Account-light: the feed's only auth is the signed token,
 * whose version must match the subject's current `calendarFeedVersion` (rotate bumps
 * it, 401-ing old URLs). A trainer's feed is their upcoming trainings; a client's feed
 * is the trainings they're actively booked into (booked/attended, never cancelled).
 * Empty feeds are still valid VCALENDARs. No domain math here beyond reading decided
 * rows — capacity/status/money live in their own services.
 */
@Injectable()
export class CalendarFeedService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly trainings: TrainingsRepository,
    private readonly clients: ClientsRepository,
    private readonly trainers: TrainersRepository
  ) {}

  /** The calendar connector is live only when both its env vars are present. */
  isEnabled(): boolean {
    return this.feedSecret !== undefined && this.publicBaseUrl !== undefined;
  }

  /**
   * Verify a feed token (signature + current version) and render the subject's
   * upcoming trainings as `.ics` text. Throws `UnauthorizedException` on a missing
   * secret, a bad signature, an unknown subject, or a version mismatch — the
   * controller maps this to 401. The token IS the auth; no admin header is involved.
   */
  async renderFeed(subject: CalendarSubject, id: string, token: string): Promise<string> {
    const secret = this.feedSecret;
    if (secret === undefined) {
      throw new UnauthorizedException("Calendar feed is not configured");
    }
    const payload = verifyFeedToken(token, secret);
    if (!payload || payload.sub !== subject || payload.id !== id) {
      throw new UnauthorizedException("Invalid calendar feed token");
    }
    const currentVersion = await this.currentVersion(subject, id);
    if (currentVersion === undefined || currentVersion !== payload.v) {
      // Subject gone or token rotated out: old URLs must stop working.
      throw new UnauthorizedException("Calendar feed token has been revoked");
    }

    const items = await this.upcomingFor(subject, id);
    return this.buildIcs(subject, items);
  }

  /** The subject's current feed version, or undefined if the subject doesn't exist. */
  async currentVersion(subject: CalendarSubject, id: string): Promise<number | undefined> {
    return subject === "trainer"
      ? this.trainers.findCalendarFeedVersion(id)
      : this.clients.findCalendarFeedVersion(id);
  }

  private async upcomingFor(subject: CalendarSubject, id: string): Promise<CalendarFeedItem[]> {
    const fromDate = todayInBelgrade();
    return subject === "trainer"
      ? this.trainings.listUpcomingForTrainerFeed(id, fromDate)
      : this.trainings.listUpcomingForClientFeed(id, fromDate);
  }

  /** Render the VCALENDAR; empty `items` still yields a valid (event-less) calendar. */
  private buildIcs(subject: CalendarSubject, items: CalendarFeedItem[]): string {
    const calendar = ical({
      name: subject === "trainer" ? "BeoSand — тренировки тренера" : "BeoSand — мои тренировки",
      prodId: { company: "BeoSand", product: "calendar-feed", language: "RU" },
      timezone: BELGRADE_TZ
    });

    for (const item of items) {
      const event = calendar.createEvent({
        // Stable UID per training id so re-syncs update (not duplicate) the event.
        // Suffixed by subject so a trainer and a client subscribing to the same
        // training don't collide if both feeds are imported into one calendar.
        id: `training-${item.trainingId}-${subject}@beosand`,
        start: zonedWallClockToUtc(item.date, item.startTime, BELGRADE_TZ),
        end: zonedWallClockToUtc(item.date, item.endTime, BELGRADE_TZ),
        summary: summaryOf(item)
      });
      event.timezone(BELGRADE_TZ);
      if (item.courtNumber !== null) {
        event.location(`Корт ${item.courtNumber}`);
      }
    }

    return calendar.toString();
  }

  private get feedSecret(): string | undefined {
    return this.env.CALENDAR_FEED_SECRET;
  }

  private get publicBaseUrl(): string | undefined {
    return this.env.PUBLIC_BASE_URL;
  }
}

/** Event title: level/group name + trainer; falls back gracefully when a name is null. */
function summaryOf(item: CalendarFeedItem): string {
  const label = item.levelName ?? item.groupName ?? "Тренировка";
  return `${label} • ${item.trainerName}`;
}
