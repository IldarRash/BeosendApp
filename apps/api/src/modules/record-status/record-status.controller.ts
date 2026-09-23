import { BadRequestException, Controller, ForbiddenException, Get, Headers, Inject, Query } from "@nestjs/common";
import { isAdmin, type Env } from "@beosand/config";
import { z } from "zod";
import { ENV } from "../../config/config.module";
import { RecordStatusService } from "./record-status.service";

const failureQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) }).strict();

/** Delivery diagnostics are an admin audit surface, never a client-owned endpoint. */
@Controller("record-status")
export class RecordStatusController {
  constructor(private readonly records: RecordStatusService, @Inject(ENV) private readonly env: Env) {}

  @Get("delivery-failures")
  async failures(@Headers("x-telegram-id") header: string | undefined, @Query() query: unknown) {
    const telegramId = Number(header);
    if (!header || !Number.isInteger(telegramId)) throw new BadRequestException("Missing or invalid x-telegram-id header");
    if (!isAdmin(this.env, telegramId)) throw new ForbiddenException("Admin privileges required");
    const parsed = failureQuery.safeParse(query ?? {});
    if (!parsed.success) throw new BadRequestException(parsed.error.issues.map((issue) => issue.message).join("; "));
    return this.records.listFailures(parsed.data.limit);
  }
}
