import { BadRequestException, Body, Controller, Get, Headers, Patch } from "@nestjs/common";
import {
  updateManagerContactSchema,
  updateRequestLoggingSettingsSchema,
  type ManagerContact,
  type RequestLoggingSettings
} from "@beosand/types";
import type { ZodSchema } from "zod";
import { SettingsService } from "./settings.service";

/** Thin: Zod-validate, resolve actor for writes, call one service method. */
@Controller("settings")
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  /** Public read of the manager contact, with env fallback handled in the service. */
  @Get("manager-contact")
  managerContact(): Promise<ManagerContact> {
    return this.settings.managerContact();
  }

  /** Admin-only read of operational API request logging mode. */
  @Get("request-logging")
  requestLoggingSettings(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined
  ): Promise<RequestLoggingSettings> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    return this.settings.requestLoggingSettings(actorTelegramId);
  }

  /** Admin-only update; the admin gate lives in SettingsService. */
  @Patch("manager-contact")
  updateManagerContact(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Body() body: unknown
  ): Promise<ManagerContact> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const input = validate(updateManagerContactSchema, body ?? {});
    return this.settings.updateManagerContact(actorTelegramId, input);
  }

  /** Admin-only update; the admin gate lives in SettingsService. */
  @Patch("request-logging")
  updateRequestLoggingSettings(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Body() body: unknown
  ): Promise<RequestLoggingSettings> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const input = validate(updateRequestLoggingSettingsSchema, body ?? {});
    return this.settings.updateRequestLoggingSettings(actorTelegramId, input);
  }
}

function parseTelegramId(header: string | undefined): number {
  const value = Number(header);
  if (!header || !Number.isInteger(value)) {
    throw new BadRequestException("Missing or invalid x-telegram-id header");
  }
  return value;
}

function validate<T>(schema: ZodSchema<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new BadRequestException(result.error.issues.map((issue) => issue.message).join("; "));
  }
  return result.data;
}
