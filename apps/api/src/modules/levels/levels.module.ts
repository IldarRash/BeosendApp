import { Module } from "@nestjs/common";
import { LevelsController } from "./levels.controller";
import { LevelsRepository } from "./levels.repository";
import { LevelsService } from "./levels.service";

@Module({
  controllers: [LevelsController],
  providers: [LevelsService, LevelsRepository]
})
export class LevelsModule {}
