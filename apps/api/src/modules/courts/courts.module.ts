import { Module } from "@nestjs/common";
import { CourtBlocksController } from "./court-blocks.controller";
import { CourtBlocksRepository } from "./court-blocks.repository";
import { CourtBlocksService } from "./court-blocks.service";
import { CourtsController } from "./courts.controller";
import { CourtsRepository } from "./courts.repository";
import { CourtsService } from "./courts.service";

@Module({
  controllers: [CourtsController, CourtBlocksController],
  providers: [CourtsService, CourtsRepository, CourtBlocksService, CourtBlocksRepository],
  exports: [CourtBlocksRepository]
})
export class CourtsModule {}
