import { Module } from "@nestjs/common";
import { GroupsModule } from "../groups/groups.module";
import { TrainersModule } from "../trainers/trainers.module";
import { TrainerTodayController, TrainingsController } from "./trainings.controller";
import { TrainingsRepository } from "./trainings.repository";
import { TrainingsService } from "./trainings.service";

@Module({
  imports: [GroupsModule, TrainersModule],
  controllers: [TrainingsController, TrainerTodayController],
  providers: [TrainingsService, TrainingsRepository]
})
export class TrainingsModule {}
