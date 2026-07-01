import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  Inject,
  Param,
  Patch,
  Post,
  Query
} from "@nestjs/common";
import { isAdmin, type Env } from "@beosand/config";
import {
  assignCourtSchema,
  autoAssignCourtsSchema,
  availableSlotsQuerySchema,
  changeCapacitySchema,
  generateAllMonthSchema,
  generateIndividualMonthSchema,
  generateMonthSchema,
  generationStatusQuerySchema,
  listTrainingsQuerySchema,
  rescheduleTrainingSchema,
  trainingScheduleQuerySchema,
  trainerTodayQuerySchema,
  trainerUpcomingQuerySchema,
  updateIndividualPriceSchema,
  uuid,
  type AutoAssignResult,
  type DeleteTrainingSeriesResult,
  type GenerateAllResult,
  type GenerateIndividualResult,
  type GenerationStatusItem,
  type SlotCard,
  type Training,
  type TrainerTodayItem,
  type TrainingCalendarItem,
  type TrainingParticipants,
  type TrainingRoster,
  type TrainingScheduleSlot
} from "@beosand/types";
import type { ZodSchema } from "zod";
import { ENV } from "../../config/config.module";
import { TrainingsService } from "./trainings.service";

/** Thin: parse + Zod-validate, resolve actor, call one service method. */
@Controller("trainings")
export class TrainingsController {
  constructor(
    private readonly trainings: TrainingsService,
    @Inject(ENV) private readonly env: Pick<Env, "ADMIN_TELEGRAM_IDS"> = {
      ADMIN_TELEGRAM_IDS: []
    }
  ) {}

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
   * Admin: generate a month of individual (1-on-1) trainings for one client with one
   * trainer. A literal route declared before any `:id` route so "generate-individual"
   * is never captured as an id. Gated in the service.
   */
  @Post("generate-individual")
  generateIndividual(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Body() body: unknown
  ): Promise<GenerateIndividualResult> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const input = validate(generateIndividualMonthSchema, body ?? {});
    return this.trainings.generateIndividualMonth(actorTelegramId, input);
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

  /** Public visible group schedule. Includes full rows; `available` stays bookable-only. */
  @Get("schedule")
  schedule(@Query() query: unknown): Promise<TrainingScheduleSlot[]> {
    const parsed = validate(trainingScheduleQuerySchema, query ?? {});
    return this.trainings.listSchedule(parsed);
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

  /**
   * Client-facing "кто записан": a training's participants. Admin (x-telegram-id ∈
   * ADMIN_TELEGRAM_IDS) gets full members (clientId + fullName); a Mini App client
   * (bridged to x-client-telegram-id) gets only firstName + avatarInitial +
   * telegramPhotoUrl. Raw x-telegram-id is accepted only on the admin path.
   */
  @Get(":id/participants")
  participants(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Param("id") id: string,
    @Headers("x-client-telegram-id") clientTelegramIdHeader?: string
  ): Promise<TrainingParticipants> {
    const trainingId = validate(uuid, id);
    if (clientTelegramIdHeader !== undefined) {
      const actorTelegramId = parseTelegramId(clientTelegramIdHeader, "x-client-telegram-id");
      return this.trainings.listParticipants(actorTelegramId, trainingId, {
        allowAdmin: false
      });
    }

    const actorTelegramId = parseTelegramId(telegramIdHeader);
    if (!isAdmin(this.env, actorTelegramId)) {
      throw new ForbiddenException("Admin privileges required");
    }
    return this.trainings.listParticipants(actorTelegramId, trainingId, {
      allowAdmin: true
    });
  }

  /** Admin: hard-delete a training (purges its rows) and notify its booked clients. Gated in the service. */
  @Delete(":id")
  delete(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Param("id") id: string
  ): Promise<{ id: string }> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const trainingId = validate(uuid, id);
    return this.trainings.deleteTraining(actorTelegramId, trainingId);
  }

  /** Admin: soft-cancel this individual training plus its future series siblings. */
  @Delete(":id/series")
  deleteSeries(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Param("id") id: string
  ): Promise<DeleteTrainingSeriesResult> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const trainingId = validate(uuid, id);
    return this.trainings.deleteIndividualSeries(actorTelegramId, trainingId);
  }

  /** Admin: auto-place every orphaned training on a date onto a free court. Gated in the service. */
  @Post("assign-courts-auto")
  autoAssignCourts(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Body() body: unknown
  ): Promise<AutoAssignResult> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const input = validate(autoAssignCourtsSchema, body ?? {});
    return this.trainings.autoAssignOrphans(actorTelegramId, input);
  }

  /** Admin: reserve a court for an unassigned ("orphan") training. Gated in the service. */
  @Post(":id/assign-court")
  assignCourt(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Param("id") id: string,
    @Body() body: unknown
  ): Promise<Training> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const trainingId = validate(uuid, id);
    const input = validate(assignCourtSchema, body ?? {});
    return this.trainings.assignCourt(actorTelegramId, trainingId, input);
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

  /** Admin: change the price of ONE individual training instance. Gated in the service. */
  @Patch(":id/price")
  updatePrice(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Param("id") id: string,
    @Body() body: unknown
  ): Promise<Training> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const trainingId = validate(uuid, id);
    const input = validate(updateIndividualPriceSchema, body ?? {});
    return this.trainings.updateIndividualPrice(actorTelegramId, trainingId, input, {
      series: false
    });
  }

  /** Admin: change the price of this individual instance plus future series siblings. */
  @Patch(":id/price-series")
  updatePriceSeries(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Param("id") id: string,
    @Body() body: unknown
  ): Promise<Training[]> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const trainingId = validate(uuid, id);
    const input = validate(updateIndividualPriceSchema, body ?? {});
    return this.trainings.updateIndividualPrice(actorTelegramId, trainingId, input, {
      series: true
    });
  }

  /** Admin: reschedule the time of ONE training instance. Gated in the service. */
  @Patch(":id/time")
  rescheduleOne(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Param("id") id: string,
    @Body() body: unknown
  ): Promise<Training> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const trainingId = validate(uuid, id);
    const input = validate(rescheduleTrainingSchema, body ?? {});
    return this.trainings.rescheduleTraining(actorTelegramId, trainingId, input, {
      series: false
    });
  }

  /**
   * Admin: reschedule the time of this instance plus all FUTURE non-cancelled siblings
   * of its individual series. Individual-only (400 otherwise). Gated in the service.
   */
  @Patch(":id/time-series")
  rescheduleSeries(
    @Headers("x-telegram-id") telegramIdHeader: string | undefined,
    @Param("id") id: string,
    @Body() body: unknown
  ): Promise<Training[]> {
    const actorTelegramId = parseTelegramId(telegramIdHeader);
    const trainingId = validate(uuid, id);
    const input = validate(rescheduleTrainingSchema, body ?? {});
    return this.trainings.rescheduleTraining(actorTelegramId, trainingId, input, {
      series: true
    });
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

/** Resolve the caller's numeric Telegram id from a trusted bridge or raw bot/admin header. */
function parseTelegramId(
  header: string | undefined,
  headerName: "x-telegram-id" | "x-client-telegram-id" = "x-telegram-id"
): number {
  const trimmed = header?.trim();
  const value = Number(trimmed);
  if (!trimmed || !Number.isInteger(value)) {
    throw new BadRequestException(`Missing or invalid ${headerName} header`);
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
