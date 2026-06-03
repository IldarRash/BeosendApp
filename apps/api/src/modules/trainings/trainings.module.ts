import { Module } from "@nestjs/common";
import { GroupsModule } from "../groups/groups.module";
import { TrainingsController } from "./trainings.controller";
import { TrainingsRepository } from "./trainings.repository";
import { TrainingsService } from "./trainings.service";

@Module({
  imports: [GroupsModule],
  controllers: [TrainingsController],
  providers: [TrainingsService, TrainingsRepository]
})
export class TrainingsModule {}
