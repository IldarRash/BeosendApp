import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post
} from "@nestjs/common";
import { type Client, clientSchema, localeSchema, onboardClientSchema } from "@beosand/types";
import type { ZodSchema } from "zod";
import { z } from "zod";
import { ClientsService } from "./clients.service";

/** Bot's set-language body: only the new locale. */
const setLanguageSchema = z.object({ language: localeSchema }).strict();

/** Thin: parse + Zod-validate input, resolve actor, call one service method. */
@Controller("clients")
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

  @Get("by-telegram/:telegramId")
  async getByTelegram(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Param("telegramId") telegramId: string
  ): Promise<Client> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const target = parseParamTelegramId(telegramId);
    const client = await this.clients.getByTelegramId(actorTelegramId, target);
    return validate(clientSchema, client);
  }

  @Post("onboard")
  async onboard(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Body() body: unknown
  ): Promise<Client> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const input = validate(onboardClientSchema, body ?? {});
    const client = await this.clients.onboard(actorTelegramId, input);
    return validate(clientSchema, client);
  }

  @Patch("by-telegram/:telegramId/language")
  async setLanguage(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Param("telegramId") telegramId: string,
    @Body() body: unknown
  ): Promise<Client> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const target = parseParamTelegramId(telegramId);
    const { language } = validate(setLanguageSchema, body ?? {});
    const client = await this.clients.setLanguage(actorTelegramId, target, language);
    return validate(clientSchema, client);
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

/** Reject a non-integer telegram id path param before any DB read. */
function parseParamTelegramId(raw: string): number {
  const value = Number(raw);
  if (!raw || !Number.isInteger(value)) {
    throw new BadRequestException("telegramId must be an integer");
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
