import { BadRequestException, Controller, Get, Headers } from "@nestjs/common";
import { z } from "zod";
import type { Court } from "@beosand/types";
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
}
