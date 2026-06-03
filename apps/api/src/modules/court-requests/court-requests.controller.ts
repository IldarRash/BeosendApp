import { BadRequestException, Controller, Get, Query } from "@nestjs/common";
import { courtAvailabilityQuerySchema, type CourtAvailability } from "@beosand/types";
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
}
