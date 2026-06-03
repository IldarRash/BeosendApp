import { BadRequestException, Body, Controller, Get, Post, Query } from "@nestjs/common";
import {
  courtAvailabilityQuerySchema,
  createCourtRequestSchema,
  previewCourtRequestSchema,
  type CourtAvailability,
  type CourtRequest,
  type CourtRequestPreview
} from "@beosand/types";
import { CourtRequestsService } from "./court-requests.service";

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
   * C2 — server-computed price + availability for a desired slot. No write. The
   * body carries telegram_id (never a clientId); any client-sent amount is ignored.
   */
  @Post("preview")
  async preview(@Body() body: unknown): Promise<CourtRequestPreview> {
    const parsed = previewCourtRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        "Invalid preview body: expected { telegramId, date, startTime, durationHours: 1|2 }."
      );
    }
    return this.service.previewRequest(parsed.data);
  }

  /**
   * C2 — create a pending court request for the caller's own client (resolved by
   * telegram_id). Price is computed server-side; no court is assigned until admin.
   */
  @Post()
  async create(@Body() body: unknown): Promise<CourtRequest> {
    const parsed = createCourtRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        "Invalid request body: expected { telegramId, date, startTime, durationHours: 1|2 }."
      );
    }
    return this.service.createRequest(parsed.data);
  }
}
