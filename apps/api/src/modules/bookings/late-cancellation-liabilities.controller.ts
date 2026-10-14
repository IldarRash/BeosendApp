import { BadRequestException, Body, Controller, Get, Headers, Param, Patch, Query } from "@nestjs/common";
import { listLateCancellationLiabilitiesQuerySchema, markStandaloneLateCancellationPaidSchema, uuid } from "@beosand/types";
import { z, type ZodSchema } from "zod";
import { BookingsService } from "./bookings.service";

/** Admin ledger surface. Domain authorization and payment rules remain in the service. */
@Controller("late-cancellation-liabilities")
export class LateCancellationLiabilitiesController {
  constructor(private readonly bookings: BookingsService) {}

  @Get()
  list(@Headers("x-telegram-id") telegramId: string | undefined, @Query() query: unknown) {
    const actor = parseTelegramId(telegramId);
    const input = listLateCancellationLiabilitiesQuerySchema.safeParse(query ?? {});
    if (!input.success) throw new BadRequestException(input.error.flatten());
    return this.bookings.listLateCancellationLiabilities(actor, input.data);
  }

  @Patch(":id/paid")
  setPaid(@Headers("x-telegram-id") telegramId: string | undefined, @Param("id") id: string, @Body() body: unknown) {
    return this.bookings.setStandaloneLateCancellationPaid(parseTelegramId(telegramId), validate(uuid, id), validate(markStandaloneLateCancellationPaidSchema, body ?? {}));
  }
}

function validate<T>(schema: ZodSchema<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new BadRequestException(result.error.flatten());
  return result.data;
}
function parseTelegramId(value: string | undefined): number { return validate(z.coerce.number().int().positive(), value); }
