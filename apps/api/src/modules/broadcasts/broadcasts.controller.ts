import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Query
} from "@nestjs/common";
import {
  broadcastPreviewQuerySchema,
  sendBroadcastSchema,
  type Broadcast,
  type BroadcastPreview
} from "@beosand/types";
import type { ZodSchema } from "zod";
import { BroadcastsService } from "./broadcasts.service";

/** Thin: parse + Zod-validate, resolve the admin actor, call one service method. */
@Controller("broadcasts")
export class BroadcastsController {
  constructor(private readonly broadcasts: BroadcastsService) {}

  /** Admin: preview the free-slot broadcast for a type + audience. Gate in service. */
  @Get("preview")
  preview(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Query() query: unknown
  ): Promise<BroadcastPreview> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const { type, audience } = validate(
      broadcastPreviewQuerySchema,
      coerceAudienceQuery(query ?? {})
    );
    return this.broadcasts.preview(actorTelegramId, type, audience);
  }

  /** Admin: send the free-slot broadcast to an audience; writes one broadcasts row. */
  @Post("send")
  send(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Body() body: unknown
  ): Promise<Broadcast> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const { type, audience } = validate(sendBroadcastSchema, body ?? {});
    return this.broadcasts.send(actorTelegramId, type, audience);
  }
}

/** Resolve the caller's numeric Telegram id from the x-telegram-id header. */
function parseTelegramId(header: string | undefined): number {
  const value = Number(header);
  if (!header || !Number.isInteger(value)) {
    throw new BadRequestException("Missing or invalid x-telegram-id header");
  }
  return value;
}

/**
 * On the preview GET the `audience` segment arrives as a JSON-encoded query
 * string (a structured discriminated union can't ride a flat query). Decode it
 * to an object so Zod can validate the union; leave a non-string (e.g. an object
 * from a direct unit-test call) and an absent audience untouched. A malformed
 * JSON string surfaces as a 400.
 */
function coerceAudienceQuery(query: unknown): unknown {
  if (typeof query !== "object" || query === null) {
    return query;
  }
  const record = query as Record<string, unknown>;
  if (typeof record.audience !== "string") {
    return query;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(record.audience);
  } catch {
    throw new BadRequestException("Invalid audience query parameter");
  }
  return { ...record, audience: parsed };
}

/** Zod-validate at the boundary; surface failures as 400 instead of 500. */
function validate<T>(schema: ZodSchema<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new BadRequestException(result.error.issues.map((issue) => issue.message).join("; "));
  }
  return result.data;
}
