import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query
} from "@nestjs/common";
import { z } from "zod";
import {
  courtBlocksListQuerySchema,
  createCourtBlockSchema,
  createRecurringCourtBlocksSchema,
  updateCourtBlockSchema,
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
        "Invalid block body: expected { courtId, date, startTime, endTime, reason, description? }."
      );
    }
    return this.service.createBlock(telegramId, parsed.data);
  }

  /** Admin-only. Create a repeated manual block over an inclusive date range. */
  @Post("recurring")
  async createRecurring(
    @Headers("x-telegram-id") rawTelegramId: string | undefined,
    @Body() body: unknown
  ): Promise<CourtBlock[]> {
    const telegramId = parseTelegramId(rawTelegramId);
    const parsed = createRecurringCourtBlocksSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        "Invalid recurring block body: expected { courtId, from, to, daysOfWeek, startTime, endTime, reason, description? }."
      );
    }
    return this.service.createRecurringBlocks(telegramId, parsed.data);
  }

  /**
   * Admin-only. Blocks for a single date (`date=`, the C6 grid) or an inclusive
   * multi-day range (`from=&to=`). Returns a flat `CourtBlock[]` ordered by date
   * then start time; the admin groups by date client-side.
   */
  @Get()
  async list(
    @Headers("x-telegram-id") rawTelegramId: string | undefined,
    @Query() query: Record<string, unknown>
  ): Promise<CourtBlock[]> {
    const telegramId = parseTelegramId(rawTelegramId);
    const parsed = courtBlocksListQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException(
        "Invalid query: expected date=YYYY-MM-DD or from=YYYY-MM-DD&to=YYYY-MM-DD."
      );
    }
    // The refinement guarantees a single `date` or a complete `from`+`to` pair;
    // a single date is the degenerate range from === to === date.
    const { date, from, to } = parsed.data;
    if (from !== undefined && to !== undefined) {
      return this.service.listBlocks(telegramId, from, to);
    }
    const single = date as string;
    return this.service.listBlocks(telegramId, single, single);
  }

  /** Admin-only. Edit block notes and/or move to another court. */
  @Patch(":id")
  async reassign(
    @Headers("x-telegram-id") rawTelegramId: string | undefined,
    @Param("id") rawId: string,
    @Body() body: unknown
  ): Promise<CourtBlock> {
    const telegramId = parseTelegramId(rawTelegramId);
    const idParsed = uuid.safeParse(rawId);
    if (!idParsed.success) {
      throw new BadRequestException("Invalid block id.");
    }
    const bodyParsed = updateCourtBlockSchema.safeParse(body);
    if (!bodyParsed.success) {
      throw new BadRequestException(
        "Invalid body: expected at least one of { courtId, description }."
      );
    }
    return this.service.reassignCourt(telegramId, idParsed.data, bodyParsed.data);
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
