import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Res
} from "@nestjs/common";
import { type CalendarFeedLink, type CalendarSubject, calendarSubject } from "@beosand/types";
import type { ZodSchema } from "zod";
import { z } from "zod";
import { CalendarFeedService } from "./calendar-feed.service";
import { CalendarLinkService } from "./calendar-link.service";

/**
 * The slice of the Express response object the `.ics` route writes — a chainable
 * status/header/send. Declared structurally to avoid an `@types/express` dependency
 * (this app ships no express types) while keeping the controller typed.
 */
interface RawResponse {
  status(code: number): RawResponse;
  header(name: string, value: string): RawResponse;
  send(body: string): RawResponse;
}

/** The feed-id path param is a UUID (a trainer or client primary key). */
const feedId = z.string().uuid();
/** The signed token query param (non-empty; the service does the real verification). */
const feedToken = z.string().min(1);

/**
 * Calendar connector endpoints (connectors §7, Slice A). Thin: parse + Zod-validate,
 * resolve the actor from the header where admin-gated, call one service method.
 *
 * - The `.ics` feed is PUBLIC; its sole auth is the signed token (validated in the
 *   service, 401 on a bad/rotated token). Served as `text/calendar; charset=utf-8`.
 * - `link` and `rotate` are admin-only; the admin gate lives in CalendarLinkService.
 */
@Controller("connectors/calendar")
export class CalendarController {
  constructor(
    private readonly feed: CalendarFeedService,
    private readonly links: CalendarLinkService
  ) {}

  /**
   * Public signed iCal feed. Express treats the literal `.ics` suffix as part of the
   * route, so `:id` carries just the UUID. The service verifies token + version and
   * throws 401 on any mismatch; on success we stream the raw VCALENDAR text.
   */
  @Get(":subject/:id.ics")
  async ics(
    @Param("subject") subjectParam: string,
    @Param("id") idParam: string,
    @Query("token") tokenParam: string | undefined,
    @Res() res: RawResponse
  ): Promise<void> {
    const subject = parseSubject(subjectParam);
    const id = validate(feedId, idParam);
    const token = validate(feedToken, tokenParam ?? "");
    const body = await this.feed.renderFeed(subject, id, token);
    res
      .status(200)
      .header("Content-Type", "text/calendar; charset=utf-8")
      .header("Content-Disposition", `inline; filename="beosand-${subject}.ics"`)
      .send(body);
  }

  /** Admin-only: build the signed feed URL to display for a subject. */
  @Get("link")
  link(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Query("subject") subjectParam: string | undefined,
    @Query("id") idParam: string | undefined
  ): Promise<CalendarFeedLink> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const subject = parseSubject(subjectParam ?? "");
    const id = validate(feedId, idParam ?? "");
    return this.links.buildLink(actorTelegramId, subject, id);
  }

  /** Admin-only: rotate (revoke) a subject's feed; returns the new link. */
  @Post(":subject/:id/rotate")
  rotate(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Param("subject") subjectParam: string,
    @Param("id") idParam: string
  ): Promise<CalendarFeedLink> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const subject = parseSubject(subjectParam);
    const id = validate(feedId, idParam);
    return this.links.rotate(actorTelegramId, subject, id);
  }
}

function parseSubject(value: string): CalendarSubject {
  return validate(calendarSubject, value);
}

/** Resolve the caller's numeric Telegram id (admin-session bridge / bot raw header). */
function parseTelegramId(header: string | undefined): number {
  const value = Number(header);
  if (!header || !Number.isInteger(value)) {
    throw new BadRequestException("Missing or invalid x-telegram-id header");
  }
  return value;
}

/** Zod-validate at the boundary; surface failures as 400 instead of 500. */
function validate<T>(schema: ZodSchema<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new BadRequestException(result.error.issues.map((issue) => issue.message).join("; "));
  }
  return result.data;
}
