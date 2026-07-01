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
  type Client,
  adjustBonusCreditsSchema,
  clientSchema,
  createWalkInSchema,
  listClientsQuerySchema,
  localeSchema,
  onboardClientSchema,
  updateClientSchema,
  uuid
} from "@beosand/types";
import type { ZodSchema } from "zod";
import { z } from "zod";
import { ClientsService, type TelegramDisplayIdentity } from "./clients.service";

/** Bot's set-language body: only the new locale. */
const setLanguageSchema = z.object({ language: localeSchema }).strict();

const telegramDisplayIdentitySchema = z
  .object({
    telegramUsername: z.string().nullable(),
    telegramPhotoUrl: z.string().url().nullable()
  })
  .strict();

/** Response contract for the admin clients list. */
const clientListSchema = z.array(clientSchema);

/** Thin: parse + Zod-validate input, resolve actor, call one service method. */
@Controller("clients")
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

  /**
   * Admin-only clients list (GET /clients?search=&status=). The Bearer admin
   * session is bridged to x-telegram-id upstream; the service enforces the admin
   * gate and normalizes the search. Unknown query fields are rejected (400).
   */
  @Get()
  async list(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Query() query: unknown
  ): Promise<Client[]> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const filters = validate(listClientsQuerySchema, query ?? {});
    const clients = await this.clients.listClients(actorTelegramId, filters);
    return validate(clientListSchema, clients);
  }

  @Get("by-telegram/:telegramId")
  async getByTelegram(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Param("telegramId") telegramId: string,
    @Headers("x-client-telegram-id") clientTelegramIdHeader?: string,
    @Headers("x-client-telegram-username") clientTelegramUsernameHeader?: string,
    @Headers("x-client-telegram-photo-url") clientTelegramPhotoUrlHeader?: string
  ): Promise<Client> {
    const actorTelegramId = parseTelegramId(clientTelegramIdHeader ?? telegramIdHeader);
    const target = parseParamTelegramId(telegramId);
    const displayIdentity = parseTelegramDisplayIdentity(
      clientTelegramIdHeader,
      clientTelegramUsernameHeader,
      clientTelegramPhotoUrlHeader
    );
    const client = displayIdentity
      ? await this.clients.getByTelegramId(actorTelegramId, target, displayIdentity)
      : await this.clients.getByTelegramId(actorTelegramId, target);
    return validate(clientSchema, client);
  }

  /** Admin: create a walk-in client by name (no Telegram). Admin-gated in the service. */
  @Post("walk-in")
  async createWalkIn(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Body() body: unknown
  ): Promise<Client> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const input = validate(createWalkInSchema, body ?? {});
    const client = await this.clients.createWalkIn(actorTelegramId, input);
    return validate(clientSchema, client);
  }

  @Post("onboard")
  async onboard(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Body() body: unknown,
    @Headers("x-client-telegram-id") clientTelegramIdHeader?: string,
    @Headers("x-client-telegram-username") clientTelegramUsernameHeader?: string,
    @Headers("x-client-telegram-photo-url") clientTelegramPhotoUrlHeader?: string
  ): Promise<Client> {
    const actorTelegramId = parseTelegramId(clientTelegramIdHeader ?? telegramIdHeader);
    const input = validate(onboardClientSchema, body ?? {});
    const displayIdentity = parseTelegramDisplayIdentity(
      clientTelegramIdHeader,
      clientTelegramUsernameHeader,
      clientTelegramPhotoUrlHeader
    );
    const client = displayIdentity
      ? await this.clients.onboard(actorTelegramId, input, displayIdentity)
      : await this.clients.onboard(actorTelegramId, input);
    return validate(clientSchema, client);
  }

  @Patch("by-telegram/:telegramId/language")
  async setLanguage(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Param("telegramId") telegramId: string,
    @Body() body: unknown,
    @Headers("x-client-telegram-id") clientTelegramIdHeader?: string
  ): Promise<Client> {
    const actorTelegramId = parseTelegramId(clientTelegramIdHeader ?? telegramIdHeader);
    const target = parseParamTelegramId(telegramId);
    const { language } = validate(setLanguageSchema, body ?? {});
    const client = await this.clients.setLanguage(
      actorTelegramId,
      target,
      language,
      clientTelegramIdHeader !== undefined
    );
    return validate(clientSchema, client);
  }

  /**
   * Admin: adjust a client's bonus-training balance by a signed delta (manual
   * credit/debit). The two-segment `:id/bonus-credits` does not collide with the
   * single-segment `:id` PATCH or the literal POST routes (walk-in/onboard). The
   * service enforces the admin gate, floors the balance at zero, and logs the
   * change; the refreshed client is validated before return.
   */
  @Post(":id/bonus-credits")
  async adjustBonusCredits(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Param("id") id: string,
    @Body() body: unknown
  ): Promise<Client> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const clientId = validate(uuid, id);
    const input = validate(adjustBonusCreditsSchema, body ?? {});
    const client = await this.clients.adjustBonusCredits(actorTelegramId, clientId, input);
    return validate(clientSchema, client);
  }

  /**
   * Admin: edit a client's profile by client PK (so walk-ins are editable). The
   * single-segment `:id` does not collide with the 3-segment
   * `by-telegram/:telegramId/language` PATCH above. Admin-gated in the service.
   */
  @Patch(":id")
  async update(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Param("id") id: string,
    @Body() body: unknown
  ): Promise<Client> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const clientId = validate(uuid, id);
    const input = validate(updateClientSchema, body ?? {});
    const client = await this.clients.updateClient(actorTelegramId, clientId, input);
    return validate(clientSchema, client);
  }
}

/**
 * Resolve the caller's numeric Telegram id. Admin-only endpoints pass the
 * x-telegram-id header (bot raw / admin-session bridge); client/self endpoints
 * pass `x-client-telegram-id ?? x-telegram-id` so a Mini App client session
 * (bridged to x-client-telegram-id only) and the bot both resolve their actor.
 */
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

/**
 * Optional username/photo are trusted only when the bridge has set the client
 * session id header. Missing optional headers then mean "Telegram omitted it",
 * so the service may clear stale stored values. Raw bot/admin paths pass no
 * identity object and therefore never clear photo.
 */
function parseTelegramDisplayIdentity(
  clientTelegramIdHeader: string | undefined,
  usernameHeader: string | undefined,
  photoUrlHeader: string | undefined
): TelegramDisplayIdentity | undefined {
  if (!clientTelegramIdHeader) {
    return undefined;
  }
  return validate(telegramDisplayIdentitySchema, {
    telegramUsername: usernameHeader ?? null,
    telegramPhotoUrl: photoUrlHeader ?? null
  });
}

/** Zod-validate at the boundary; surface failures as 400 instead of 500. */
function validate<T>(schema: ZodSchema<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new BadRequestException(result.error.issues.map((issue) => issue.message).join("; "));
  }
  return result.data;
}
