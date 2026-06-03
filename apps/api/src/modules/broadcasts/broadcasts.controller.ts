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

  /** Admin: preview the free-slot broadcast for a type. Admin gate is in the service. */
  @Get("preview")
  preview(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Query() query: unknown
  ): Promise<BroadcastPreview> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const { type } = validate(broadcastPreviewQuerySchema, query ?? {});
    return this.broadcasts.preview(actorTelegramId, type);
  }

  /** Admin: send the free-slot broadcast; writes one broadcasts row. Gate in service. */
  @Post("send")
  send(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Body() body: unknown
  ): Promise<Broadcast> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const { type } = validate(sendBroadcastSchema, body ?? {});
    return this.broadcasts.send(actorTelegramId, type);
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

/** Zod-validate at the boundary; surface failures as 400 instead of 500. */
function validate<T>(schema: ZodSchema<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new BadRequestException(result.error.issues.map((issue) => issue.message).join("; "));
  }
  return result.data;
}
