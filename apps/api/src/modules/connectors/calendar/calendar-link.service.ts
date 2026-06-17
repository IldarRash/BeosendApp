import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import type { Env } from "@beosand/config";
import { isAdmin } from "@beosand/config";
import { type CalendarFeedLink, type CalendarSubject, calendarFeedLinkSchema } from "@beosand/types";
import { ENV } from "../../../config/config.module";
import { ClientsRepository } from "../../clients/clients.repository";
import { TrainersRepository } from "../../trainers/trainers.repository";
import { CalendarFeedService } from "./calendar-feed.service";
import { signFeedToken } from "./calendar-token";

/**
 * Admin-gated calendar-feed management (connectors §7, Slice A): build a subject's
 * signed feed URL ("give me the link") and rotate it (bump `calendarFeedVersion`,
 * revoking old URLs). The admin gate lives here, not in the controller. Building a
 * link requires the connector be configured (`CALENDAR_FEED_SECRET` +
 * `PUBLIC_BASE_URL`); absent → 409 so the admin UI shows a clear "not configured"
 * state. The public `.ics` feed itself has no admin gate — its signed token is the auth.
 */
@Injectable()
export class CalendarLinkService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly feed: CalendarFeedService,
    private readonly clients: ClientsRepository,
    private readonly trainers: TrainersRepository
  ) {}

  /** Admin-only: the subject's signed feed URL at its current version. */
  async buildLink(
    actorTelegramId: number,
    subject: CalendarSubject,
    id: string
  ): Promise<CalendarFeedLink> {
    this.assertAdmin(actorTelegramId);
    return this.linkFor(subject, id);
  }

  /** Admin-only: bump the subject's feed version (revoke old URLs), return the new link. */
  async rotate(
    actorTelegramId: number,
    subject: CalendarSubject,
    id: string
  ): Promise<CalendarFeedLink> {
    this.assertAdmin(actorTelegramId);
    this.assertConfigured();
    const bumped =
      subject === "trainer"
        ? await this.trainers.bumpCalendarFeedVersion(id)
        : await this.clients.bumpCalendarFeedVersion(id);
    if (bumped === undefined) {
      throw new NotFoundException(`No ${subject} ${id}`);
    }
    return this.buildLinkAtVersion(subject, id, bumped);
  }

  /** Build the signed link at the subject's current version (shared by link + rotate). */
  private async linkFor(subject: CalendarSubject, id: string): Promise<CalendarFeedLink> {
    this.assertConfigured();
    const version = await this.feed.currentVersion(subject, id);
    if (version === undefined) {
      throw new NotFoundException(`No ${subject} ${id}`);
    }
    return this.buildLinkAtVersion(subject, id, version);
  }

  private buildLinkAtVersion(
    subject: CalendarSubject,
    id: string,
    version: number
  ): CalendarFeedLink {
    const secret = this.env.CALENDAR_FEED_SECRET;
    const base = this.env.PUBLIC_BASE_URL;
    // assertConfigured already ran; narrow the optional env for the type checker.
    if (secret === undefined || base === undefined) {
      throw new ConflictException("Calendar feed is not configured");
    }
    const token = signFeedToken({ sub: subject, id, v: version }, secret);
    const url = `${base.replace(/\/+$/, "")}/connectors/calendar/${subject}/${id}.ics?token=${token}`;
    return calendarFeedLinkSchema.parse({ subject, url });
  }

  private assertConfigured(): void {
    if (!this.feed.isEnabled()) {
      throw new ConflictException(
        "Calendar feed is not configured (CALENDAR_FEED_SECRET and PUBLIC_BASE_URL required)"
      );
    }
  }

  private assertAdmin(actorTelegramId: number): void {
    if (!isAdmin(this.env, actorTelegramId)) {
      throw new ForbiddenException("Admin privileges required");
    }
  }
}
