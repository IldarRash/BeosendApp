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
  type CreatedWebhookEndpoint,
  createWebhookEndpointSchema,
  type WebhookDelivery,
  type WebhookEndpoint,
  updateWebhookEndpointSchema,
  uuid
} from "@beosand/types";
import type { ZodSchema } from "zod";
import { WebhooksService } from "./webhooks.service";

/**
 * Admin-only webhook CRUD + delivery endpoints (connectors §7). Thin: parse the
 * request, Zod-validate the body/params, resolve the actor from `x-telegram-id` (the
 * admin gate lives in the service), call one service method. The create response is the
 * ONLY place the generated secret is returned; list/get never carry it.
 */
@Controller("connectors/webhooks")
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Post()
  create(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Body() body: unknown
  ): Promise<CreatedWebhookEndpoint> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const input = validate(createWebhookEndpointSchema, body ?? {});
    return this.webhooks.create(actorTelegramId, input);
  }

  @Get()
  list(@Headers("x-telegram-id") telegramIdHeader: string | undefined): Promise<WebhookEndpoint[]> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    return this.webhooks.list(actorTelegramId);
  }

  @Get(":id")
  get(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Param("id") id: string
  ): Promise<WebhookEndpoint> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const endpointId = validate(uuid, id);
    return this.webhooks.get(actorTelegramId, endpointId);
  }

  @Patch(":id")
  update(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Param("id") id: string,
    @Body() body: unknown
  ): Promise<WebhookEndpoint> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const endpointId = validate(uuid, id);
    const patch = validate(updateWebhookEndpointSchema, body ?? {});
    return this.webhooks.update(actorTelegramId, endpointId, patch);
  }

  @Get(":id/deliveries")
  deliveries(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Param("id") id: string
  ): Promise<WebhookDelivery[]> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const endpointId = validate(uuid, id);
    return this.webhooks.listDeliveries(actorTelegramId, endpointId);
  }

  @Post("deliveries/:id/retry")
  retry(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Param("id") id: string
  ): Promise<WebhookDelivery> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const deliveryId = validate(uuid, id);
    return this.webhooks.retryDelivery(actorTelegramId, deliveryId);
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
