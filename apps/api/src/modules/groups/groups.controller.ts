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
import { createGroupSchema, type Group, updateGroupSchema, uuid } from "@beosand/types";
import type { ZodSchema } from "zod";
import { GroupsService } from "./groups.service";

/** Thin: parse + Zod-validate, resolve actor, call one service method. */
@Controller("groups")
export class GroupsController {
  constructor(private readonly groups: GroupsService) {}

  /** Reference-facing: active groups for the client "join a group" list. */
  @Get()
  list(): Promise<Group[]> {
    return this.groups.listActive();
  }

  @Post()
  create(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Body() body: unknown
  ): Promise<Group> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const input = validate(createGroupSchema, body ?? {});
    return this.groups.create(actorTelegramId, input);
  }

  @Patch(":id")
  update(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Param("id") id: string,
    @Body() body: unknown
  ): Promise<Group> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const groupId = validate(uuid, id);
    const patch = validate(updateGroupSchema, body ?? {});
    return this.groups.update(actorTelegramId, groupId, patch);
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
