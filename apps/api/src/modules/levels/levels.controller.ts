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
  createLevelSchema,
  type Level,
  updateLevelSchema,
  uuid
} from "@beosand/types";
import type { ZodSchema } from "zod";
import { LevelsService } from "./levels.service";

/** Thin: parse + Zod-validate, resolve actor, call one service method. */
@Controller("levels")
export class LevelsController {
  constructor(private readonly levels: LevelsService) {}

  /** Client-facing: active levels for onboarding + group creation. */
  @Get()
  list(): Promise<Level[]> {
    return this.levels.listActive();
  }

  @Post()
  create(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Body() body: unknown
  ): Promise<Level> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const { name } = validate(createLevelSchema, body ?? {});
    return this.levels.create(actorTelegramId, name);
  }

  @Patch(":id")
  update(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Param("id") id: string,
    @Body() body: unknown
  ): Promise<Level> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const levelId = validate(uuid, id);
    const patch = validate(updateLevelSchema, body ?? {});
    return this.levels.update(actorTelegramId, levelId, patch);
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
