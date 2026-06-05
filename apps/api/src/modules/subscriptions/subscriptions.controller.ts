import { BadRequestException, Body, Controller, Get, Headers, Param, Patch, Query } from "@nestjs/common";
import {
  type SubscriptionSummary,
  listSubscriptionsQuerySchema,
  markSubscriptionPaidSchema,
  uuid
} from "@beosand/types";
import type { ZodSchema } from "zod";
import { SubscriptionsService } from "./subscriptions.service";

/**
 * Subscription payments (admin console only). Thin: parse + Zod-validate, resolve
 * the admin actor from the x-telegram-id header, call one service method. The
 * admin gate, money, and payment-state logic all live in the service.
 */
@Controller("subscriptions")
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  /** Admin: list monthly subscriptions, optionally filtered by payment state / client. */
  @Get()
  list(
    @Headers("x-telegram-id") header: string | undefined,
    @Query() query: unknown
  ): Promise<SubscriptionSummary[]> {
    const actor = parseTelegramId(header);
    const parsed = validate(listSubscriptionsQuerySchema, query ?? {});
    return this.subscriptions.list(actor, parsed);
  }

  /** Admin: mark every non-cancelled booking of one subscription paid/unpaid. */
  @Patch(":id/paid")
  setPaid(
    @Headers("x-telegram-id") header: string | undefined,
    @Param("id") id: string,
    @Body() body: unknown
  ): Promise<SubscriptionSummary> {
    const actor = parseTelegramId(header);
    const groupSubscriptionId = validate(uuid, id);
    const { paid } = validate(markSubscriptionPaidSchema, body ?? {});
    return this.subscriptions.setPaid(actor, groupSubscriptionId, paid);
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
