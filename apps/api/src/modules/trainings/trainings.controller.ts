import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query
} from "@nestjs/common";
import {
  availableSlotsQuerySchema,
  generateMonthSchema,
  listTrainingsQuerySchema,
  trainerTodayQuerySchema,
  uuid,
  type SlotCard,
  type Training,
  type TrainerTodayItem,
  type TrainingRoster
} from "@beosand/types";
import type { ZodSchema } from "zod";
import { TrainingsService } from "./trainings.service";

/** Thin: parse + Zod-validate, resolve actor, call one service method. */
@Controller("trainings")
export class TrainingsController {
  constructor(private readonly trainings: TrainingsService) {}

  /** Admin: generate one training per group weekday across a month (15.1). */
  @Post("generate")
  generate(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Body() body: unknown
  ): Promise<Training[]> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const input = validate(generateMonthSchema, body ?? {});
    return this.trainings.generateMonth(actorTelegramId, input);
  }

  /** Client: bookable slot cards (section 5). Public — same catalogue for every client. */
  @Get("available")
  available(@Query() query: unknown): Promise<SlotCard[]> {
    const parsed = validate(availableSlotsQuerySchema, query ?? {});
    return this.trainings.listAvailable(parsed);
  }

  /** Admin: trainings in a date range, optionally for one group. */
  @Get()
  list(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Query() query: unknown
  ): Promise<Training[]> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const parsed = validate(listTrainingsQuerySchema, query ?? {});
    return this.trainings.list(actorTelegramId, parsed);
  }

  /** Trainer/admin: a training's roster (T2.3). Ownership enforced in the service. */
  @Get(":id/roster")
  roster(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Param("id") id: string
  ): Promise<TrainingRoster> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const trainingId = validate(uuid, id);
    return this.trainings.getRoster(actorTelegramId, trainingId);
  }
}

/** Trainer-scoped reads keyed off `/trainers` (T2.3); logic lives in TrainingsService. */
@Controller("trainers")
export class TrainerTodayController {
  constructor(private readonly trainings: TrainingsService) {}

  /** Trainer: their own trainings for today with headcount. Scoping in the service. */
  @Get("me/today")
  today(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Query() query: unknown
  ): Promise<TrainerTodayItem[]> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const { telegramId } = validate(trainerTodayQuerySchema, query ?? {});
    return this.trainings.listTrainerToday(actorTelegramId, telegramId);
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
