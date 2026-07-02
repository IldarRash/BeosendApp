import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query
} from "@nestjs/common";
import {
  createGroupSchema,
  type BookableMonth,
  type Group,
  type GroupMembers,
  groupMembersQuerySchema,
  updateGroupSchema,
  uuid
} from "@beosand/types";
import type { ZodSchema } from "zod";
import { GroupsService } from "./groups.service";

/** Thin: parse + Zod-validate, resolve actor, call one service method. */
@Controller("groups")
export class GroupsController {
  constructor(private readonly groups: GroupsService) {}

  /**
   * Reference-facing list. Shared by the Mini App "join a group" list and the admin
   * Groups table, so it is role-aware: an admin (x-telegram-id ∈ ADMIN_TELEGRAM_IDS,
   * bridged from the admin session) sees hidden groups too — so a hidden group can be
   * un-hidden — while clients (no admin header) never see them. The header is optional
   * and parsed leniently: absent or non-numeric means anonymous/non-admin, never a 400.
   */
  @Get()
  list(@Headers("x-telegram-id") telegramIdHeader?: string): Promise<Group[]> {
    return this.groups.listActive(parseOptionalTelegramId(telegramIdHeader));
  }

  /**
   * Client-safe subscription-month offer read. No auth required: it returns only
   * `{year, month}` for current+next month candidates with generated future group
   * trainings, and never exposes members, bookings, courts, or client data.
   */
  @Get(":id/bookable-months")
  bookableMonths(@Param("id") id: string): Promise<BookableMonth[]> {
    const groupId = validate(uuid, id);
    return this.groups.listBookableMonths(groupId);
  }

  /**
   * Group monthly roster. Admin (x-telegram-id ∈ ADMIN_TELEGRAM_IDS) gets full
   * members (clientId + fullName); a Mini App client (bridged to
   * x-client-telegram-id) gets only firstName + avatarInitial + telegramPhotoUrl.
   * The actor resolves from `x-client-telegram-id ?? x-telegram-id`; the role split
   * lives in the service.
   */
  @Get(":id/members")
  members(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Param("id") id: string,
    @Query() query: unknown,
    @Headers("x-client-telegram-id") clientTelegramIdHeader?: string
  ): Promise<GroupMembers> {
    const actor = resolveClientActor(telegramIdHeader, clientTelegramIdHeader);
    const groupId = validate(uuid, id);
    const { year, month } = validate(groupMembersQuerySchema, query ?? {});
    return this.groups.listMembers(actor.telegramId, groupId, year, month, {
      allowAdmin: actor.allowAdmin
    });
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

  /**
   * Admin: soft-delete a group (set inactive + cancel its future trainings, notifying
   * members). Gated in the service.
   */
  @Delete(":id")
  remove(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Param("id") id: string
  ): Promise<Group> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const groupId = validate(uuid, id);
    return this.groups.deleteGroup(actorTelegramId, groupId);
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
 * Members is shared by trusted raw admin callers and Mini App clients. The Mini
 * App bridge is client-scoped, so it must not unlock the admin roster shape.
 */
function resolveClientActor(
  telegramIdHeader: string | undefined,
  clientTelegramIdHeader: string | undefined
): { telegramId: number; allowAdmin: boolean } {
  const clientScoped = clientTelegramIdHeader !== undefined;
  return {
    telegramId: parseTelegramId(clientScoped ? clientTelegramIdHeader : telegramIdHeader),
    allowAdmin: !clientScoped
  };
}

/**
 * Lenient variant for the public list: an absent or non-numeric x-telegram-id is
 * treated as anonymous (undefined), never a 400, so the endpoint keeps working for
 * clients that send no admin header. Only a well-formed admin id is surfaced.
 */
function parseOptionalTelegramId(header: string | undefined): number | undefined {
  const value = Number(header);
  return header && Number.isInteger(value) ? value : undefined;
}

/** Zod-validate at the boundary; surface failures as 400 instead of 500. */
function validate<T>(schema: ZodSchema<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new BadRequestException(result.error.issues.map((issue) => issue.message).join("; "));
  }
  return result.data;
}
