import { BadRequestException, Body, Controller, Get, Headers, Post } from "@nestjs/common";
import {
  type ConnectorStatus,
  type TestSendInput,
  type TestSendResult,
  testSendSchema
} from "@beosand/types";
import type { ZodSchema } from "zod";
import { ConnectorsService } from "./connectors.service";

/**
 * Admin-only connector endpoints (connectors §7): the status list for the settings
 * screen and the per-channel test-send. Thin — parse the request, Zod-validate, resolve
 * the actor from the `x-telegram-id` header (admin gate enforced in the service), call
 * one service method. The signed calendar feed lives on its own controller (public).
 */
@Controller("connectors")
export class ConnectorsController {
  constructor(private readonly connectors: ConnectorsService) {}

  /** Admin-only: connector status list for the settings screen. */
  @Get()
  status(@Headers("x-telegram-id") telegramIdHeader: string | undefined): ConnectorStatus[] {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    return this.connectors.status(actorTelegramId);
  }

  /** Admin-only: send a fixed test message over the chosen channel to a given target. */
  @Post("test-send")
  testSend(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Body() body: unknown
  ): Promise<TestSendResult> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const input: TestSendInput = validate(testSendSchema, body ?? {});
    return this.connectors.testSend(actorTelegramId, input);
  }
}

/** Resolve the caller's numeric Telegram id (admin-session bridge / bot raw header). */
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
