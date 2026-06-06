import { forwardRef, Module } from "@nestjs/common";
import { CourtsModule } from "../courts/courts.module";
import { GroupsModule } from "../groups/groups.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { TrainersModule } from "../trainers/trainers.module";
import { TrainerTodayController, TrainingsController } from "./trainings.controller";
import { TrainingsRepository } from "./trainings.repository";
import { TrainingsService } from "./trainings.service";

@Module({
  // forwardRef on GroupsModule: GroupsService now depends on TrainingsService and
  // TrainingsModule still needs GroupsRepository — a two-way module dependency.
  imports: [forwardRef(() => GroupsModule), TrainersModule, NotificationsModule, CourtsModule],
  controllers: [TrainingsController, TrainerTodayController],
  providers: [TrainingsService, TrainingsRepository],
  exports: [TrainingsService]
})
export class TrainingsModule {}
