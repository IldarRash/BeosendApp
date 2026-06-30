import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query
} from "@nestjs/common";
import {
  createTrainerSchema,
  individualRequestSchema,
  type IndividualRequestResult,
  type Trainer,
  updateTrainerSchema,
  uuid
} from "@beosand/types";
import { z, type ZodSchema } from "zod";
import { TrainersService } from "./trainers.service";

const trainersListQuerySchema = z.object({
  scope: z.enum(["individual"]).optional()
}).strict();

/** Thin: parse + Zod-validate, resolve actor, call one service method. */
@Controller("trainers")
export class TrainersController {
  constructor(private readonly trainers: TrainersService) {}

  /** Reference-facing: active trainers for group creation + slot rendering. */
  @Get()
  list(@Query() query: Record<string, unknown> = {}): Promise<Trainer[]> {
    const parsed = validate(trainersListQuerySchema, query ?? {});
    return this.trainers.listActive(parsed.scope);
  }

  @Post()
  create(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Body() body: unknown
  ): Promise<Trainer> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const input = validate(createTrainerSchema, body ?? {});
    return this.trainers.create(actorTelegramId, input);
  }

  @Patch(":id")
  update(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Param("id") id: string,
    @Body() body: unknown
  ): Promise<Trainer> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const trainerId = validate(uuid, id);
    const patch = validate(updateTrainerSchema, body ?? {});
    return this.trainers.update(actorTelegramId, trainerId, patch);
  }

  /**
   * Client-facing, self-only (Feature 8): the caller requests an individual
   * session with this trainer. The actor is resolved from the verified session
   * (`x-client-telegram-id ?? x-telegram-id`) so a Mini App client (bridged to
   * x-client-telegram-id only, no x-telegram-id) and the bot both work. The body
   * `telegramId` must equal the resolved actor — the requester acts only as
   * themselves; a mismatched body id is rejected (no impersonation). Not
   * admin-gated. The service notifies admin/manager staff with the requested
   * trainer named and returns a typed result (soft `trainer-unavailable` rather
   * than a 500 when no staff notification can be delivered).
   */
  @Post(":id/individual-request")
  requestIndividual(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Param("id") id: string,
    @Body() body: unknown,
    @Headers("x-client-telegram-id") clientTelegramIdHeader?: string
  ): Promise<IndividualRequestResult> {
    const actorTelegramId = parseTelegramId(clientTelegramIdHeader ?? telegramIdHeader);
    const trainerId = validate(uuid, id);
    const input = validate(individualRequestSchema, body ?? {});
    if (input.telegramId !== actorTelegramId) {
      throw new ForbiddenException("Individual requests may only be made for yourself");
    }
    return this.trainers.requestIndividual(trainerId, actorTelegramId);
  }
}

/**
 * Resolve the caller's numeric Telegram id. Admin endpoints pass the
 * x-telegram-id header (bot raw / admin-session bridge); the client/self
 * individual-request endpoint passes `x-client-telegram-id ?? x-telegram-id` so
 * a Mini App client session (bridged to x-client-telegram-id only) and the bot
 * both resolve their actor.
 */
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
