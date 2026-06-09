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
  createManagerSchema,
  type Manager,
  updateManagerSchema,
  uuid
} from "@beosand/types";
import type { ZodSchema } from "zod";
import { ManagersService } from "./managers.service";

/** Thin: parse + Zod-validate, resolve actor from header, call one service method. */
@Controller("managers")
export class ManagersController {
  constructor(private readonly managers: ManagersService) {}

  /** Admin-only: list every manager (active + inactive) for the console. */
  @Get()
  list(@Headers("x-telegram-id") telegramIdHeader: string | undefined): Promise<Manager[]> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    return this.managers.listAll(actorTelegramId);
  }

  @Post()
  create(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Body() body: unknown
  ): Promise<Manager> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const input = validate(createManagerSchema, body ?? {});
    return this.managers.create(actorTelegramId, input);
  }

  @Patch(":id")
  update(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Param("id") id: string,
    @Body() body: unknown
  ): Promise<Manager> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const managerId = validate(uuid, id);
    const patch = validate(updateManagerSchema, body ?? {});
    return this.managers.update(actorTelegramId, managerId, patch);
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
