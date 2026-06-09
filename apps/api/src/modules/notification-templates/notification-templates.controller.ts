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
import {
  type NotificationTemplate,
  type NotificationTemplateKey,
  notificationTemplateKey,
  notificationTemplateSchema,
  updateNotificationTemplateSchema
} from "@beosand/types";
import type { ZodSchema } from "zod";
import { NotificationTemplatesService } from "./notification-templates.service";

/** Thin: parse + Zod-validate, resolve the admin actor, call one service method. */
@Controller("notification-templates")
export class NotificationTemplatesController {
  constructor(private readonly templates: NotificationTemplatesService) {}

  /** Admin: every editable event with default + override + placeholders. */
  @Get()
  async list(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined
  ): Promise<NotificationTemplate[]> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const entries = await this.templates.list(actorTelegramId);
    return entries.map((entry) => validate(notificationTemplateSchema, entry));
  }

  /** Admin: one event's effective template. */
  @Get(":eventKey")
  async getOne(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Param("eventKey") eventKey: string
  ): Promise<NotificationTemplate> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const key = parseEventKey(eventKey);
    const entry = await this.templates.getOne(actorTelegramId, key);
    return validate(notificationTemplateSchema, entry);
  }

  /** Admin: upsert one event's override body. */
  @Patch(":eventKey")
  async update(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Param("eventKey") eventKey: string,
    @Body() body: unknown
  ): Promise<NotificationTemplate> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const key = parseEventKey(eventKey);
    const { body: text } = validate(updateNotificationTemplateSchema, body ?? {});
    const entry = await this.templates.update(actorTelegramId, key, text);
    return validate(notificationTemplateSchema, entry);
  }

  /** Admin: reset one event's override to the code default. */
  @Post(":eventKey/reset")
  async reset(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Param("eventKey") eventKey: string
  ): Promise<NotificationTemplate> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const key = parseEventKey(eventKey);
    const entry = await this.templates.reset(actorTelegramId, key);
    return validate(notificationTemplateSchema, entry);
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

/** Validate the path param against the contract enum; 400 on an unknown key. */
function parseEventKey(value: string): NotificationTemplateKey {
  return validate(notificationTemplateKey, value);
}

/** Zod-validate at the boundary; surface failures as 400 instead of 500. */
function validate<T>(schema: ZodSchema<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new BadRequestException(result.error.issues.map((issue) => issue.message).join("; "));
  }
  return result.data;
}
