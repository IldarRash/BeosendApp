import { Module } from "@nestjs/common";
import { TrainingPricingController } from "./training-pricing.controller";
import { TrainingPricingRepository } from "./training-pricing.repository";
import { TrainingPricingService } from "./training-pricing.service";

@Module({
  controllers: [TrainingPricingController],
  providers: [TrainingPricingService, TrainingPricingRepository],
  exports: [TrainingPricingService]
})
export class TrainingPricingModule {}
