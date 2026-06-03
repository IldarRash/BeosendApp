import { BadRequestException, Controller, Get, Headers, Query } from "@nestjs/common";
import { z } from "zod";
import { courtAvailabilityQuerySchema, type Court, type CourtLoadGrid } from "@beosand/types";
import { CourtsService } from "./courts.service";

/** Caller identity convention shared across apps: numeric Telegram id in a header. */
const telegramIdHeader = z.coerce.number().int();

@Controller("courts")
export class CourtsController {
  constructor(private readonly service: CourtsService) {}

  /** Admin/internal only. Returns active courts (id, number, status). */
  @Get()
  async list(@Headers("x-telegram-id") rawTelegramId: string | undefined): Promise<Court[]> {
    const parsed = telegramIdHeader.safeParse(rawTelegramId);
    if (!parsed.success) {
      throw new BadRequestException("Missing or invalid x-telegram-id header.");
    }
    return this.service.listActiveCourts(parsed.data);
  }

  /**
   * C6 — admin-only per-day court load grid. Thin: parse the caller header, validate
   * the date query, call one service method. The admin gate (and any DB read) runs
   * server-side in the service.
   */
  @Get("load")
  async load(
    @Headers("x-telegram-id") rawTelegramId: string | undefined,
    @Query() rawQuery: unknown
  ): Promise<CourtLoadGrid> {
    const parsedId = telegramIdHeader.safeParse(rawTelegramId);
    if (!parsedId.success) {
      throw new BadRequestException("Missing or invalid x-telegram-id header.");
    }
    const parsedQuery = courtAvailabilityQuerySchema.safeParse(rawQuery);
    if (!parsedQuery.success) {
      throw new BadRequestException("Missing or invalid date query (YYYY-MM-DD).");
    }
    return this.service.getLoadGrid(parsedId.data, parsedQuery.data.date);
  }
}
