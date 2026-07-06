import { BadRequestException, Body, Controller, Get, Headers, Put } from "@nestjs/common";
import {
  type TrainingPricingTiers,
  replaceTrainingPricingTiersSchema
} from "@beosand/types";
import type { ZodSchema } from "zod";
import { TrainingPricingService } from "./training-pricing.service";

@Controller("training-pricing-tiers")
export class TrainingPricingController {
  constructor(private readonly pricing: TrainingPricingService) {}

  @Get()
  list(@Headers("x-telegram-id") header: string | undefined): Promise<TrainingPricingTiers> {
    return this.pricing.list(parseTelegramId(header));
  }

  @Put()
  replace(
    @Headers("x-telegram-id") header: string | undefined,
    @Body() body: unknown
  ): Promise<TrainingPricingTiers> {
    const input = validate(replaceTrainingPricingTiersSchema, body ?? {});
    return this.pricing.replace(parseTelegramId(header), input);
  }
}

function parseTelegramId(header: string | undefined): number {
  const value = Number(header);
  if (!header || !Number.isInteger(value)) {
    throw new BadRequestException("Missing or invalid x-telegram-id header");
  }
  return value;
}

function validate<T>(schema: ZodSchema<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new BadRequestException(result.error.issues.map((issue) => issue.message).join("; "));
  }
  return result.data;
}
