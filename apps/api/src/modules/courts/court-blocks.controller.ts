import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query
} from "@nestjs/common";
import { z } from "zod";
import {
  courtAvailabilityQuerySchema,
  createCourtBlockSchema,
  uuid,
  type CourtBlock
} from "@beosand/types";
import { CourtBlocksService } from "./court-blocks.service";

/** Caller identity convention shared across apps: numeric Telegram id in a header. */
const telegramIdHeader = z.coerce.number().int();

@Controller("court-blocks")
export class CourtBlocksController {
  constructor(private readonly service: CourtBlocksService) {}

  /** Admin-only. Block a court for a whole-hour range; reduces C3 availability. */
  @Post()
  async create(
    @Headers("x-telegram-id") rawTelegramId: string | undefined,
    @Body() body: unknown
  ): Promise<CourtBlock> {
    const telegramId = parseTelegramId(rawTelegramId);
    const parsed = createCourtBlockSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        "Invalid block body: expected { courtId, date, startTime, endTime, reason }."
      );
    }
    return this.service.createBlock(telegramId, parsed.data);
  }

  /** Admin-only. Blocks for a single date (C6 grid). */
  @Get()
  async list(
    @Headers("x-telegram-id") rawTelegramId: string | undefined,
    @Query() query: Record<string, unknown>
  ): Promise<CourtBlock[]> {
    const telegramId = parseTelegramId(rawTelegramId);
    const parsed = courtAvailabilityQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException("Invalid query: expected date=YYYY-MM-DD.");
    }
    return this.service.listBlocks(telegramId, parsed.data.date);
  }

  /** Admin-only. Remove a block, restoring availability. */
  @Delete(":id")
  @HttpCode(204)
  async remove(
    @Headers("x-telegram-id") rawTelegramId: string | undefined,
    @Param("id") rawId: string
  ): Promise<void> {
    const telegramId = parseTelegramId(rawTelegramId);
    const parsed = uuid.safeParse(rawId);
    if (!parsed.success) {
      throw new BadRequestException("Invalid block id.");
    }
    await this.service.deleteBlock(telegramId, parsed.data);
  }
}

function parseTelegramId(raw: string | undefined): number {
  const parsed = telegramIdHeader.safeParse(raw);
  if (!parsed.success) {
    throw new BadRequestException("Missing or invalid x-telegram-id header.");
  }
  return parsed.data;
}
