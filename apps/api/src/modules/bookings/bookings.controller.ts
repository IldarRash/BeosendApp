import { BadRequestException, Body, Controller, Headers, Post } from "@nestjs/common";
import {
  type Booking,
  type GroupBookingResult,
  createGroupBookingSchema,
  createSingleBookingSchema
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
