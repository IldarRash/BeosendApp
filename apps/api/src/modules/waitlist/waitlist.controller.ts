import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query
} from "@nestjs/common";
import {
  type Booking,
  type SwapWaitlistResult,
  type WaitlistAdminItem,
  type WaitlistEntry,
  createWaitlistEntrySchema,
  groupWaitlistQuerySchema,
  promoteWaitlistEntrySchema,
  removeWaitlistEntrySchema,
  swapWaitlistEntrySchema,
  uuid
} from "@beosand/types";
import type { ZodSchema } from "zod";
import { WaitlistService } from "./waitlist.service";

/** Thin: parse + Zod-validate, resolve actor, call one service method (T2.1 + admin tools). */
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

  /**
   * Client: the caller's own active queue entries ("my queue"). Identity is resolved
   * server-side exactly like GET /bookings/mine; NOT admin-gated (own data). The
   * caller's client is resolved from the actor telegram id in the service, so no
   * query param is accepted — a client can never read another client's queue.
   */
  @Get("mine")
  listMine(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Headers("x-client-telegram-id") clientTelegramIdHeader?: string
  ): Promise<WaitlistAdminItem[]> {
    const actorTelegramId = parseTelegramId(clientTelegramIdHeader ?? telegramIdHeader);
    return this.waitlist.listMine(actorTelegramId);
  }

  /** Admin: active queue entries for one training, ordered by position. Admin gate in the service. */
  @Get("training/:trainingId")
  listForTraining(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Param("trainingId") trainingId: string
  ): Promise<WaitlistAdminItem[]> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const id = validate(uuid, trainingId);
    return this.waitlist.listForTraining(actorTelegramId, id);
  }

  /** Admin: active queue entries across a group's month (the "group queue"). Admin gate in the service. */
  @Get("group")
  listForGroup(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Query() query: unknown
  ): Promise<WaitlistAdminItem[]> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const { groupId, year, month } = validate(groupWaitlistQuerySchema, query ?? {});
    return this.waitlist.listForGroupMonth(actorTelegramId, groupId, year, month);
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

  /** Admin: promote an entry straight to a booking (needs a free seat). Admin gate in the service. */
  @Post(":entryId/promote")
  promote(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Param("entryId") entryId: string,
    @Body() body: unknown
  ): Promise<Booking> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const id = validate(uuid, entryId);
    validate(promoteWaitlistEntrySchema, body ?? {});
    return this.waitlist.promoteEntry(actorTelegramId, id);
  }

  /** Admin: swap an entry ahead of an existing booking on the same training. Admin gate in the service. */
  @Post(":entryId/swap")
  swap(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Param("entryId") entryId: string,
    @Body() body: unknown
  ): Promise<SwapWaitlistResult> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const id = validate(uuid, entryId);
    const { replacesBookingId } = validate(swapWaitlistEntrySchema, body ?? {});
    return this.waitlist.swapEntry(actorTelegramId, id, replacesBookingId);
  }

  /** Admin: remove (cancel) an entry; a `notified` removal promotes the next head. Admin gate in the service. */
  @Post(":entryId/remove")
  remove(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Param("entryId") entryId: string,
    @Body() body: unknown
  ): Promise<WaitlistEntry> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const id = validate(uuid, entryId);
    validate(removeWaitlistEntrySchema, body ?? {});
    return this.waitlist.removeEntry(actorTelegramId, id);
  }
}

/**
 * Resolve the caller's numeric Telegram id. Admin endpoints pass the x-telegram-id
 * header (bot raw / admin-session bridge); client/self endpoints pass
 * `x-client-telegram-id ?? x-telegram-id` so a Mini App client session (bridged to
 * x-client-telegram-id only) and the bot's raw header both resolve their actor.
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
