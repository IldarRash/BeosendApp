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
  type GroupBookingResult,
  type MyBookingItem,
  createGroupBookingSchema,
  createSingleBookingSchema,
  markAttendanceSchema,
  myBookingsQuerySchema,
  uuid
} from "@beosand/types";
import type { ZodSchema } from "zod";
import { BookingsService } from "./bookings.service";

/** Thin: parse + Zod-validate, resolve actor, call one service method. */
@Controller("bookings")
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  /** Client: book a single training seat (T1.8). Ownership is enforced in the service. */
  @Post("single")
  createSingle(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Body() body: unknown
  ): Promise<Booking> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const input = validate(createSingleBookingSchema, body ?? {});
    return this.bookings.createSingle(actorTelegramId, input);
  }

  /**
   * Admin/trainer: manually book any (existing or walk-in) client onto a training
   * from the console (Feature 5). Distinct from /single: the service authorizes
   * admin-or-trainer-of-the-training, not the bot's self-only ownership.
   */
  @Post("manual")
  createManual(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Body() body: unknown
  ): Promise<Booking> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const input = validate(createSingleBookingSchema, body ?? {});
    return this.bookings.createManual(actorTelegramId, input);
  }

  /** Client: book a whole month into a group as a linked batch (T1.9). */
  @Post("group")
  createGroup(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Body() body: unknown
  ): Promise<GroupBookingResult> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const input = validate(createGroupBookingSchema, body ?? {});
    return this.bookings.createGroupBooking(actorTelegramId, input);
  }

  /** Client: list their own upcoming or past bookings (T1.10). Ownership in the service. */
  @Get("mine")
  listMine(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Query() query: unknown
  ): Promise<MyBookingItem[]> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const { clientId, scope } = validate(myBookingsQuerySchema, query ?? {});
    return this.bookings.listMine(actorTelegramId, clientId, scope);
  }

  /** Client: cancel one of their own bookings (T1.11). Ownership in the service. */
  @Post(":id/cancel")
  cancel(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Param("id") id: string
  ): Promise<Booking> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const bookingId = validate(uuid, id);
    return this.bookings.cancelBooking(actorTelegramId, bookingId);
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
