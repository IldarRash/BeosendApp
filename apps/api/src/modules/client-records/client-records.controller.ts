import { BadRequestException, Controller, Get, Headers, Query } from "@nestjs/common";
import { clientRecordsQuerySchema, type ClientRecordsPage } from "@beosand/types";
import { ClientRecordsService } from "./client-records.service";

@Controller("client-records")
export class ClientRecordsController {
  constructor(private readonly records: ClientRecordsService) {}
  @Get("mine")
  mine(@Headers("x-telegram-id") telegramIdHeader: string | undefined, @Headers("x-client-telegram-id") clientTelegramIdHeader: string | undefined, @Query() query: unknown): Promise<ClientRecordsPage> {
    const parsed = clientRecordsQuerySchema.safeParse(query ?? {});
    if (!parsed.success) throw new BadRequestException(parsed.error.issues.map((issue) => issue.message).join("; "));
    return this.records.mine(parseTelegramId(clientTelegramIdHeader ?? telegramIdHeader), parsed.data);
  }
}
function parseTelegramId(header: string | undefined): number { const value = Number(header); if (!header || !Number.isInteger(value)) throw new BadRequestException("Missing or invalid Telegram identity header"); return value; }
