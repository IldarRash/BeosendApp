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
  availableSlotsQuerySchema,
  cancelTrainingSchema,
  changeCapacitySchema,
  generateAllMonthSchema,
  generateMonthSchema,
  generationStatusQuerySchema,
  listTrainingsQuerySchema,
  trainerTodayQuerySchema,
  trainerUpcomingQuerySchema,
  uuid,
  type GenerateAllResult,
  type GenerationStatusItem,
  type SlotCard,
  type Training,
  type TrainerTodayItem,
  type TrainingCalendarItem,
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

  /** Admin: generate the month for all active groups at once (Feature 3). Gated in the service. */
  @Post("generate-all")
  generateAll(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Body() body: unknown
  ): Promise<GenerateAllResult> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const input = validate(generateAllMonthSchema, body ?? {});
    return this.trainings.generateMonthForAll(actorTelegramId, input);
  }

  /**
   * Admin: per-group generation coverage for a year/month, so the generate-month UI
   * can mark already-fully-generated groups. Declared before any `:id` route so the
   * literal segment is never captured as an id. Gated in the service.
   */
  @Get("generation-status")
  generationStatus(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Query() query: unknown
  ): Promise<GenerationStatusItem[]> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const parsed = validate(generationStatusQuerySchema, query ?? {});
    return this.trainings.generationStatus(actorTelegramId, parsed);
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

  /**
   * Admin: calendar view — trainings in a range with group/trainer/court names,
   * optionally filtered by group/trainer. Declared before any `:id` route so the
   * literal "calendar" segment is never captured as an id. Gated in the service.
   */
  @Get("calendar")
  calendar(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Query() query: unknown
  ): Promise<TrainingCalendarItem[]> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const parsed = validate(listTrainingsQuerySchema, query ?? {});
    return this.trainings.listCalendar(actorTelegramId, parsed);
  }

  /** Admin: a single training's calendar detail (group/trainer/court names). Gated in the service. */
  @Get(":id/detail")
  detail(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Param("id") id: string
  ): Promise<TrainingCalendarItem> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const trainingId = validate(uuid, id);
    return this.trainings.getCalendarItem(actorTelegramId, trainingId);
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

  /** Admin: cancel a training and notify its booked clients. Gated in the service. */
  @Post(":id/cancel")
  cancel(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Param("id") id: string,
    @Body() body: unknown
  ): Promise<Training> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const trainingId = validate(uuid, id);
    validate(cancelTrainingSchema, body ?? {});
    return this.trainings.cancelTraining(actorTelegramId, trainingId);
  }

  /** Admin: change a training's capacity (recomputes open/full). Gated in the service. */
  @Patch(":id/capacity")
  changeCapacity(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Param("id") id: string,
    @Body() body: unknown
  ): Promise<Training> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const trainingId = validate(uuid, id);
    const input = validate(changeCapacitySchema, body ?? {});
    return this.trainings.changeCapacity(actorTelegramId, trainingId, input);
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

  /**
   * Trainer: their own upcoming trainings over a horizon (default ~14 days), the
   * confirmation-queue feed. Same trainer-self-or-admin scoping as /me/today; the
   * response reuses TrainerTodayItem[]. Scoping/horizon in the service.
   */
  @Get("me/upcoming")
  upcoming(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Query() query: unknown
  ): Promise<TrainerTodayItem[]> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const parsed = validate(trainerUpcomingQuerySchema, query ?? {});
    return this.trainings.listTrainerUpcoming(actorTelegramId, parsed);
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
