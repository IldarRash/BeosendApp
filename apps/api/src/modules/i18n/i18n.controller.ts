import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Patch,
  Query
} from "@nestjs/common";
import {
  type LabelCatalog,
  labelCatalogSchema,
  type LabelEntry,
  labelEntrySchema,
  localeSchema,
  updateLabelSchema
} from "@beosand/types";
import type { ZodSchema } from "zod";
import { z } from "zod";
import { I18nService } from "./i18n.service";

const deleteLabelSchema = z.object({ locale: localeSchema, key: z.string().min(1) }).strict();

/** Thin: parse + Zod-validate, resolve actor, call one service method. */
@Controller("i18n")
export class I18nController {
  constructor(private readonly i18n: I18nService) {}

  /** Public UI text: merged catalog for a locale (consumed by admin and bot). */
  @Get("catalog")
  async catalog(@Query("locale") locale: string | undefined): Promise<LabelCatalog> {
    const parsed = validate(localeSchema, locale);
    const merged = await this.i18n.getCatalog(parsed);
    return validate(labelCatalogSchema, merged);
  }

  /** Admin: every registry key with default + current override, for the editor. */
  @Get("labels")
  async labels(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Query("locale") locale: string | undefined
  ): Promise<LabelEntry[]> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const parsed = validate(localeSchema, locale);
    const entries = await this.i18n.listEntries(actorTelegramId, parsed);
    return entries.map((entry) => validate(labelEntrySchema, entry));
  }

  /** Admin: upsert one override. */
  @Patch("labels")
  async upsert(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Body() body: unknown
  ): Promise<LabelEntry> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const { locale, key, value } = validate(updateLabelSchema, body ?? {});
    const entry = await this.i18n.upsertOverride(actorTelegramId, locale, key, value);
    return validate(labelEntrySchema, entry);
  }

  /** Admin: remove one override (reset to default). */
  @Delete("labels")
  async reset(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Body() body: unknown
  ): Promise<LabelEntry> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const { locale, key } = validate(deleteLabelSchema, body ?? {});
    const entry = await this.i18n.resetOverride(actorTelegramId, locale, key);
    return validate(labelEntrySchema, entry);
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
