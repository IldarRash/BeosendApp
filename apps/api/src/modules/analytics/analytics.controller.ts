import { BadRequestException, Controller, Get, Headers, Query } from "@nestjs/common";
import {
  analyticsRangeQuerySchema,
  type AnalyticsSummary,
  type BroadcastEffectiveness,
  type CancellationStats,
  type ClientActivity,
  type FillRate,
  type NoShowStats,
  type PopularSlot,
  type TrainerLoad
} from "@beosand/types";
import type { ZodSchema } from "zod";
import { AnalyticsService } from "./analytics.service";

/** Summary accepts an optional range (service defaults to the last 30 days). */
const summaryQuerySchema = analyticsRangeQuerySchema.partial();

/**
 * Thin: parse + Zod-validate the range, resolve the admin actor from the
 * x-telegram-id header, call one service method. The admin gate and all
 * aggregation live in the service. Every endpoint is GET (read-only).
 */
@Controller("analytics")
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get("popular-slots")
  popularSlots(
    @Headers("x-telegram-id") header: string | undefined,
    @Query() query: unknown
  ): Promise<PopularSlot[]> {
    const actor = parseTelegramId(header);
    const { from, to } = validate(analyticsRangeQuerySchema, query ?? {});
    return this.analytics.popularSlots(actor, from, to);
  }

  @Get("fill-rate")
  fillRate(
    @Headers("x-telegram-id") header: string | undefined,
    @Query() query: unknown
  ): Promise<FillRate> {
    const actor = parseTelegramId(header);
    const { from, to } = validate(analyticsRangeQuerySchema, query ?? {});
    return this.analytics.fillRate(actor, from, to);
  }

  @Get("trainer-load")
  trainerLoad(
    @Headers("x-telegram-id") header: string | undefined,
    @Query() query: unknown
  ): Promise<TrainerLoad[]> {
    const actor = parseTelegramId(header);
    const { from, to } = validate(analyticsRangeQuerySchema, query ?? {});
    return this.analytics.trainerLoad(actor, from, to);
  }

  @Get("cancellations")
  cancellations(
    @Headers("x-telegram-id") header: string | undefined,
    @Query() query: unknown
  ): Promise<CancellationStats> {
    const actor = parseTelegramId(header);
    const { from, to } = validate(analyticsRangeQuerySchema, query ?? {});
    return this.analytics.cancellations(actor, from, to);
  }

  @Get("no-shows")
  noShows(
    @Headers("x-telegram-id") header: string | undefined,
    @Query() query: unknown
  ): Promise<NoShowStats> {
    const actor = parseTelegramId(header);
    const { from, to } = validate(analyticsRangeQuerySchema, query ?? {});
    return this.analytics.noShows(actor, from, to);
  }

  @Get("client-activity")
  clientActivity(
    @Headers("x-telegram-id") header: string | undefined,
    @Query() query: unknown
  ): Promise<ClientActivity> {
    const actor = parseTelegramId(header);
    const { from, to } = validate(analyticsRangeQuerySchema, query ?? {});
    return this.analytics.clientActivity(actor, from, to);
  }

  @Get("broadcast-effectiveness")
  broadcastEffectiveness(
    @Headers("x-telegram-id") header: string | undefined,
    @Query() query: unknown
  ): Promise<BroadcastEffectiveness> {
    const actor = parseTelegramId(header);
    const { from, to } = validate(analyticsRangeQuerySchema, query ?? {});
    return this.analytics.broadcastEffectiveness(actor, from, to);
  }

  /** Composite headline screen for the bot; range optional (default 30 days). */
  @Get("summary")
  summary(
    @Headers("x-telegram-id") header: string | undefined,
    @Query() query: unknown
  ): Promise<AnalyticsSummary> {
    const actor = parseTelegramId(header);
    const range = validate(summaryQuerySchema, query ?? {});
    return this.analytics.summary(actor, range);
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
