import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Param,
  Post,
  Query
} from "@nestjs/common";
import { z } from "zod";
import {
  confirmCourtRequestSchema,
  courtAvailabilityQuerySchema,
  courtRequestQueueQuerySchema,
  createCourtRequestSchema,
  previewCourtRequestSchema,
  rejectCourtRequestSchema,
  uuid,
  type Court,
  type CourtAvailability,
  type CourtRequest,
  type CourtRequestAdminView,
  type CourtRequestPreview
} from "@beosand/types";
import { CourtRequestsService } from "./court-requests.service";

/** Caller identity convention shared across apps: numeric Telegram id in a header. */
const telegramIdHeader = z.coerce.number().int();

@Controller("court-requests")
export class CourtRequestsController {
  constructor(private readonly service: CourtRequestsService) {}

  /**
   * Offerable start times + free-court counts for a date. Read-only; never
   * returns a court id/number. The bot renders only the returned hours.
   */
  @Get("availability")
  async availability(@Query() query: Record<string, unknown>): Promise<CourtAvailability> {
    const parsed = courtAvailabilityQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException("Invalid availability query: expected date=YYYY-MM-DD.");
    }
    return this.service.getAvailability(parsed.data.date);
  }

  /**
   * C2 — server-computed price + availability for a desired slot. No write. Any
   * client-sent amount is ignored (price is computed server-side). The actor is
   * resolved from the verified session (`x-client-telegram-id ?? x-telegram-id`);
   * the body still carries telegramId for the bot's server-to-server path, but it
   * must match the verified actor — a mismatched id is rejected (no impersonation).
   */
  @Post("preview")
  async preview(
    @Body() body: unknown,
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Headers("x-client-telegram-id") clientTelegramIdHeader?: string
  ): Promise<CourtRequestPreview> {
    const actorTelegramId = parseTelegramId(clientTelegramIdHeader ?? telegramIdHeader);
    const parsed = previewCourtRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        "Invalid preview body: expected { telegramId, date, startTime, durationHours: 1|1.5|2 }."
      );
    }
    assertSelf(parsed.data.telegramId, actorTelegramId);
    return this.service.previewRequest({ ...parsed.data, telegramId: actorTelegramId });
  }

  /**
   * C2 — create a pending court request for the caller's own client (resolved from
   * the verified session: `x-client-telegram-id ?? x-telegram-id`). Price is
   * computed server-side; no court is assigned until admin. The body telegramId
   * must match the verified actor — a mismatched id is rejected (no impersonation).
   */
  @Post()
  async create(
    @Body() body: unknown,
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Headers("x-client-telegram-id") clientTelegramIdHeader?: string
  ): Promise<CourtRequest> {
    const actorTelegramId = parseTelegramId(clientTelegramIdHeader ?? telegramIdHeader);
    const parsed = createCourtRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        "Invalid request body: expected { telegramId, date, startTime, durationHours: 1|1.5|2 }."
      );
    }
    assertSelf(parsed.data.telegramId, actorTelegramId);
    return this.service.createRequest({ ...parsed.data, telegramId: actorTelegramId });
  }

  /**
   * C4 — admin moderation queue (default status=pending), joined with client
   * name/telegram. Admin-only (enforced in the service by x-telegram-id).
   */
  @Get()
  async queue(
    @Headers("x-telegram-id") rawTelegramId: string | undefined,
    @Query() query: Record<string, unknown>
  ): Promise<CourtRequestAdminView[]> {
    const telegramId = parseTelegramId(rawTelegramId);
    const parsed = courtRequestQueueQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException(
        "Invalid queue query: status must be pending|confirmed|rejected|cancelled."
      );
    }
    return this.service.listQueue(telegramId, parsed.data.status);
  }

  /**
   * C4 — active courts free for every hour the request covers. Admin-only; never
   * exposed to a client path (the court number is only learned on confirmation).
   */
  @Get(":id/free-courts")
  async freeCourts(
    @Headers("x-telegram-id") rawTelegramId: string | undefined,
    @Param("id") rawId: string
  ): Promise<Court[]> {
    const telegramId = parseTelegramId(rawTelegramId);
    const id = parseRequestId(rawId);
    return this.service.freeCourts(telegramId, id);
  }

  /**
   * Admin-only detail for a single request (joined with client name/telegram and
   * the derived end time). Backs the court-load grid's "who booked this?" popup.
   * Declared after `availability` and `:id/free-courts` so those match first.
   */
  @Get(":id")
  async detail(
    @Headers("x-telegram-id") rawTelegramId: string | undefined,
    @Param("id") rawId: string
  ): Promise<CourtRequestAdminView> {
    const telegramId = parseTelegramId(rawTelegramId);
    const id = parseRequestId(rawId);
    return this.service.getRequestDetail(telegramId, id);
  }

  /**
   * C4 — confirm a pending request onto a chosen court. Admin-only; re-checks the
   * per-hour limit and chosen-court freeness atomically before assigning.
   */
  @Post(":id/confirm")
  async confirm(
    @Headers("x-telegram-id") rawTelegramId: string | undefined,
    @Param("id") rawId: string,
    @Body() body: unknown
  ): Promise<CourtRequest> {
    const telegramId = parseTelegramId(rawTelegramId);
    const id = parseRequestId(rawId);
    const parsed = confirmCourtRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        "Invalid confirm body: expected { requestId, courtId, decidedBy }."
      );
    }
    if (parsed.data.requestId !== id) {
      throw new BadRequestException("Path id and body requestId must match.");
    }
    return this.service.confirmRequest(telegramId, parsed.data);
  }

  /** C4 — reject a pending request. Admin-only; notifies the client to retry. */
  @Post(":id/reject")
  async reject(
    @Headers("x-telegram-id") rawTelegramId: string | undefined,
    @Param("id") rawId: string,
    @Body() body: unknown
  ): Promise<CourtRequest> {
    const telegramId = parseTelegramId(rawTelegramId);
    const id = parseRequestId(rawId);
    const parsed = rejectCourtRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException("Invalid reject body: expected { requestId, decidedBy }.");
    }
    if (parsed.data.requestId !== id) {
      throw new BadRequestException("Path id and body requestId must match.");
    }
    return this.service.rejectRequest(telegramId, parsed.data);
  }
}

function parseTelegramId(raw: string | undefined): number {
  const parsed = telegramIdHeader.safeParse(raw);
  if (!parsed.success) {
    throw new BadRequestException("Missing or invalid x-telegram-id header.");
  }
  return parsed.data;
}

/**
 * Self-only guard: the body telegramId must equal the actor resolved from the
 * verified session header. Blocks a forged/foreign body telegramId from acting on
 * another client's behalf (no impersonation); the bot keeps working because it
 * sends a body telegramId that matches its x-telegram-id header.
 */
function assertSelf(bodyTelegramId: number, actorTelegramId: number): void {
  if (bodyTelegramId !== actorTelegramId) {
    throw new ForbiddenException("Body telegramId does not match the authenticated caller.");
  }
}

function parseRequestId(raw: string): string {
  const parsed = uuid.safeParse(raw);
  if (!parsed.success) {
    throw new BadRequestException("Invalid court request id.");
  }
  return parsed.data;
}
