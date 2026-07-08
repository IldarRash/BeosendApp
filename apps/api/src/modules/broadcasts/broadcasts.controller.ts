import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query
} from "@nestjs/common";
import {
  broadcastTemplateBroadcastType,
  broadcastTemplateSchema,
  broadcastTemplateVariableSchema,
  broadcastPreviewQuerySchema,
  createBroadcastTemplateSchema,
  sendBroadcastSchema,
  type Broadcast,
  type BroadcastPreview,
  type BroadcastTemplate,
  type BroadcastTemplateVariable,
  updateBroadcastTemplateSchema
} from "@beosand/types";
import { z } from "zod";
import type { ZodSchema } from "zod";
import { BroadcastsService } from "./broadcasts.service";

/** Thin: parse + Zod-validate, resolve the admin actor, call one service method. */
@Controller("broadcasts")
export class BroadcastsController {
  constructor(private readonly broadcasts: BroadcastsService) {}

  /** Admin: preview the free-slot broadcast for a type + audience. Gate in service. */
  @Get("preview")
  preview(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Query() query: unknown
  ): Promise<BroadcastPreview> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const { type, audience, templateId } = validate(
      broadcastPreviewQuerySchema,
      coerceAudienceQuery(query ?? {})
    );
    return this.broadcasts.preview(actorTelegramId, type, audience, templateId);
  }

  /** Admin: send the free-slot broadcast to an audience; writes one broadcasts row. */
  @Post("send")
  send(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Body() body: unknown
  ): Promise<Broadcast> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const { type, audience, templateId, previewToken } = validate(sendBroadcastSchema, body ?? {});
    return this.broadcasts.send(actorTelegramId, type, audience, templateId, previewToken);
  }
}

/** Thin CRUD surface for admin-managed free-slot broadcast templates. */
@Controller("broadcast-templates")
export class BroadcastTemplatesController {
  constructor(private readonly broadcasts: BroadcastsService) {}

  /** Admin: active templates for one free-slot broadcast type. */
  @Get()
  async list(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Query("type") type: string | undefined
  ): Promise<BroadcastTemplate[]> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const parsedType = validate(broadcastTemplateBroadcastType, type);
    const templates = await this.broadcasts.listTemplates(actorTelegramId, parsedType);
    return templates.map((template) => validate(broadcastTemplateSchema, template));
  }

  /** Admin: curated server variables available for this broadcast type. */
  @Get("variables")
  variables(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Query("type") type: string | undefined
  ): BroadcastTemplateVariable[] {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const parsedType = validate(broadcastTemplateBroadcastType, type);
    return this.broadcasts
      .variables(actorTelegramId, parsedType)
      .map((variable) => validate(broadcastTemplateVariableSchema, variable));
  }

  /** Admin: create one reusable template. */
  @Post()
  async create(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Body() body: unknown
  ): Promise<BroadcastTemplate> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const input = validate(createBroadcastTemplateSchema, body ?? {});
    return validate(broadcastTemplateSchema, await this.broadcasts.createTemplate(actorTelegramId, input));
  }

  /** Admin: patch a template and bump version. */
  @Patch(":id")
  async update(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Param("id") id: string,
    @Body() body: unknown
  ): Promise<BroadcastTemplate> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const parsedId = validate(z.string().uuid(), id);
    const input = validate(updateBroadcastTemplateSchema, body ?? {});
    return validate(
      broadcastTemplateSchema,
      await this.broadcasts.updateTemplate(actorTelegramId, parsedId, input)
    );
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

/**
 * On the preview GET the `audience` segment arrives as a JSON-encoded query
 * string (a structured discriminated union can't ride a flat query). Decode it
 * to an object so Zod can validate the union; leave a non-string (e.g. an object
 * from a direct unit-test call) and an absent audience untouched. A malformed
 * JSON string surfaces as a 400.
 */
function coerceAudienceQuery(query: unknown): unknown {
  if (typeof query !== "object" || query === null) {
    return query;
  }
  const record = query as Record<string, unknown>;
  if (typeof record.audience !== "string") {
    return query;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(record.audience);
  } catch {
    throw new BadRequestException("Invalid audience query parameter");
  }
  return { ...record, audience: parsed };
}

/** Zod-validate at the boundary; surface failures as 400 instead of 500. */
function validate<T>(schema: ZodSchema<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new BadRequestException(result.error.issues.map((issue) => issue.message).join("; "));
  }
  return result.data;
}
