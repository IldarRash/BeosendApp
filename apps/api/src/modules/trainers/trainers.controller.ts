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
  createTrainerSchema,
  type Trainer,
  updateTrainerSchema,
  uuid
} from "@beosand/types";
import type { ZodSchema } from "zod";
import { TrainersService } from "./trainers.service";

/** Thin: parse + Zod-validate, resolve actor, call one service method. */
@Controller("trainers")
export class TrainersController {
  constructor(private readonly trainers: TrainersService) {}

  /** Reference-facing: active trainers for group creation + slot rendering. */
  @Get()
  list(): Promise<Trainer[]> {
    return this.trainers.listActive();
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
