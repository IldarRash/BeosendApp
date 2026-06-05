import { BadRequestException, Body, Controller, Headers, Param, Post } from "@nestjs/common";
import {
  type Booking,
  type WaitlistEntry,
  createWaitlistEntrySchema,
  uuid
} from "@beosand/types";
import type { ZodSchema } from "zod";
import { WaitlistService } from "./waitlist.service";

/** Thin: parse + Zod-validate, resolve actor, call one service method (T2.1). */
@Controller("waitlist")
export class WaitlistController {
  constructor(private readonly waitlist: WaitlistService) {}

  /** Client: join a full training's waitlist. Eligibility/ownership enforced in the service. */
  @Post()
  join(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Body() body: unknown,
    @Headers("x-client-telegram-id") clientTelegramIdHeader?: string
  ): Promise<WaitlistEntry> {
    const actorTelegramId = parseTelegramId(clientTelegramIdHeader ?? telegramIdHeader);
    const input = validate(createWaitlistEntrySchema, body ?? {});
    return this.waitlist.join(actorTelegramId, input);
  }

  /** Client: accept a promoted slot (the inline confirm button). Ownership in the service. */
  @Post(":id/accept")
  accept(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Param("id") id: string,
    @Headers("x-client-telegram-id") clientTelegramIdHeader?: string
  ): Promise<Booking> {
    const actorTelegramId = parseTelegramId(clientTelegramIdHeader ?? telegramIdHeader);
    const entryId = validate(uuid, id);
    return this.waitlist.accept(actorTelegramId, entryId);
  }
}

/**
 * Resolve the caller's numeric Telegram id. Client/self endpoints pass
 * `x-client-telegram-id ?? x-telegram-id` so a Mini App client session (bridged
 * to x-client-telegram-id only) and the bot's raw header both resolve their actor.
 */
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
