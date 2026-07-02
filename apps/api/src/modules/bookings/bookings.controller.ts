import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Res
} from "@nestjs/common";
import {
  type Booking,
  type GroupBookingResult,
  type MyBookingItem,
  type SingleBookingResult,
  type TransferGroupResult,
  calendarExportMonthQuerySchema,
  confirmBookingSchema,
  createGroupBookingSchema,
  createManualBookingSchema,
  createSingleBookingSchema,
  declineBookingSchema,
  markAttendanceSchema,
  myBookingsQuerySchema,
  transferGroupSchema,
  uuid
} from "@beosand/types";
import type { ZodSchema } from "zod";
import { BookingsService } from "./bookings.service";

interface RawResponse {
  status(code: number): RawResponse;
  header(name: string, value: string): RawResponse;
  send(body: string): RawResponse;
}

/** Thin: parse + Zod-validate, resolve actor, call one service method. */
@Controller("bookings")
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  /** Client: book a single training seat (T1.8). Ownership is enforced in the service. */
  @Post("single")
  createSingle(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Body() body: unknown,
    @Headers("x-client-telegram-id") clientTelegramIdHeader?: string
  ): Promise<SingleBookingResult> {
    const actor = resolveClientActor(telegramIdHeader, clientTelegramIdHeader);
    const input = validate(createSingleBookingSchema, body ?? {});
    return this.bookings.createSingle(actor.telegramId, input, { allowAdmin: actor.allowAdmin });
  }

  /**
   * Admin/trainer: manually book any (existing or walk-in) client onto a training
   * from the console (Feature 5). Distinct from /single: the service authorizes
   * admin-or-trainer-of-the-training, not the bot's self-only ownership. The body
   * may opt in to redeem one of the client's bonus-training credits for this seat
   * (admin-only flag); the service performs the redemption server-side.
   */
  @Post("manual")
  createManual(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Body() body: unknown
  ): Promise<Booking> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const input = validate(createManualBookingSchema, body ?? {});
    // The contract defaults useBonusCredit to false; pin it to a concrete boolean so
    // the service receives the parsed output shape (CreateManualBookingInput), not the
    // optional input shape.
    return this.bookings.createManual(actorTelegramId, {
      ...input,
      useBonusCredit: input.useBonusCredit ?? false
    });
  }

  /** Client: book a whole month into a group as a linked batch (T1.9). */
  @Post("group")
  createGroup(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Body() body: unknown,
    @Headers("x-client-telegram-id") clientTelegramIdHeader?: string
  ): Promise<GroupBookingResult> {
    const actor = resolveClientActor(telegramIdHeader, clientTelegramIdHeader);
    const input = validate(createGroupBookingSchema, body ?? {});
    return this.bookings.createGroupBooking(actor.telegramId, input, {
      allowAdmin: actor.allowAdmin
    });
  }

  /**
   * Admin: move a client between groups for a month (Item C) — cancel their future
   * bookings on the source group and re-book onto the target as one atomic batch.
   * Admin-only (x-telegram-id); the service enforces it.
   */
  @Post("transfer-group")
  transferGroup(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Body() body: unknown
  ): Promise<TransferGroupResult> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const input = validate(transferGroupSchema, body ?? {});
    return this.bookings.transferGroup(actorTelegramId, input);
  }

  /** Mini App: download the caller's own confirmed bookings for one month as ICS. */
  @Get("mine/calendar-export")
  async calendarExportMine(
    @Headers("x-client-telegram-id") clientTelegramIdHeader: string | undefined,
    @Query() query: unknown,
    @Res() res: RawResponse
  ): Promise<void> {
    const actorTelegramId = parseTelegramId(clientTelegramIdHeader, "x-client-telegram-id");
    const input = validate(calendarExportMonthQuerySchema, query ?? {});
    const body = await this.bookings.calendarExportMine(actorTelegramId, input);
    const monthLabel = `${input.year}-${String(input.month).padStart(2, "0")}`;
    res
      .status(200)
      .header("Content-Type", "text/calendar; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="beosand-trainings-${monthLabel}.ics"`)
      .send(body);
  }

  /** Client: list their own upcoming or past bookings (T1.10). Ownership in the service. */
  @Get("mine")
  listMine(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Query() query: unknown,
    @Headers("x-client-telegram-id") clientTelegramIdHeader?: string
  ): Promise<MyBookingItem[]> {
    const actor = resolveClientActor(telegramIdHeader, clientTelegramIdHeader);
    const { clientId, scope } = validate(myBookingsQuerySchema, query ?? {});
    return this.bookings.listMine(actor.telegramId, clientId, scope, {
      allowAdmin: actor.allowAdmin
    });
  }

  /** Client: cancel one of their own bookings (T1.11). Ownership in the service. */
  @Post(":id/cancel")
  cancel(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Param("id") id: string,
    @Headers("x-client-telegram-id") clientTelegramIdHeader?: string
  ): Promise<Booking> {
    const actor = resolveClientActor(telegramIdHeader, clientTelegramIdHeader);
    const bookingId = validate(uuid, id);
    return this.bookings.cancelBooking(actor.telegramId, bookingId, {
      allowAdmin: actor.allowAdmin
    });
  }

  /**
   * Trainer/admin: confirm a monthly-subscription batch of pending requests
   * (booked). The literal "subscription/" prefix disambiguates from `:id/confirm`.
   * Authorization (admin or the batch's trainer) is enforced in the service.
   */
  @Post("subscription/:groupSubscriptionId/confirm")
  confirmSubscription(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Param("groupSubscriptionId") groupSubscriptionId: string,
    @Body() body: unknown
  ): Promise<GroupBookingResult> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const subscriptionId = validate(uuid, groupSubscriptionId);
    validate(confirmBookingSchema, body ?? {});
    return this.bookings.confirmSubscription(actorTelegramId, subscriptionId);
  }

  /**
   * Trainer/admin: decline a monthly-subscription batch of pending requests
   * (cancelled, seats freed). The literal "subscription/" prefix disambiguates from
   * `:id/decline`. Authorization is enforced in the service.
   */
  @Post("subscription/:groupSubscriptionId/decline")
  declineSubscription(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Param("groupSubscriptionId") groupSubscriptionId: string,
    @Body() body: unknown
  ): Promise<GroupBookingResult> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const subscriptionId = validate(uuid, groupSubscriptionId);
    validate(declineBookingSchema, body ?? {});
    return this.bookings.declineSubscription(actorTelegramId, subscriptionId);
  }

  /** Trainer/admin: confirm a single pending booking (pending → booked). Ownership in the service. */
  @Post(":id/confirm")
  confirm(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Param("id") id: string,
    @Body() body: unknown
  ): Promise<Booking> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const bookingId = validate(uuid, id);
    validate(confirmBookingSchema, body ?? {});
    return this.bookings.confirmBooking(actorTelegramId, bookingId);
  }

  /** Trainer/admin: decline a single pending booking (pending → cancelled). Ownership in the service. */
  @Post(":id/decline")
  decline(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Param("id") id: string,
    @Body() body: unknown
  ): Promise<Booking> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const bookingId = validate(uuid, id);
    validate(declineBookingSchema, body ?? {});
    return this.bookings.declineBooking(actorTelegramId, bookingId);
  }

  /** Trainer/admin: mark a booking attended / no_show (T2.3). Ownership in the service. */
  @Post(":id/attendance")
  markAttendance(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Param("id") id: string,
    @Body() body: unknown
  ): Promise<Booking> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const bookingId = validate(uuid, id);
    const input = validate(markAttendanceSchema, body ?? {});
    return this.bookings.markAttendance(actorTelegramId, bookingId, input);
  }
}

/**
 * Resolve the caller's numeric Telegram id. Admin/trainer endpoints pass the
 * x-telegram-id header (bot raw / admin-session bridge); client/self endpoints
 * pass `x-client-telegram-id ?? x-telegram-id` so a Mini App client session
 * (bridged to x-client-telegram-id only) and the bot both resolve their actor.
 */
function parseTelegramId(header: string | undefined, headerName = "x-telegram-id"): number {
  const value = Number(header);
  if (!header || !Number.isInteger(value)) {
    throw new BadRequestException(`Missing or invalid ${headerName} header`);
  }
  return value;
}

/**
 * Client/self endpoints accept either the trusted raw Telegram id or the Mini App
 * client-session bridge. A client-session actor never receives admin fallback,
 * even when the numeric id is also configured as an admin.
 */
function resolveClientActor(
  telegramIdHeader: string | undefined,
  clientTelegramIdHeader: string | undefined
): { telegramId: number; allowAdmin: boolean } {
  const clientScoped = clientTelegramIdHeader !== undefined;
  return {
    telegramId: parseTelegramId(clientScoped ? clientTelegramIdHeader : telegramIdHeader),
    allowAdmin: !clientScoped
  };
}

/** Zod-validate at the boundary; surface failures as 400 instead of 500. */
function validate<T>(schema: ZodSchema<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new BadRequestException(result.error.issues.map((issue) => issue.message).join("; "));
  }
  return result.data;
}
