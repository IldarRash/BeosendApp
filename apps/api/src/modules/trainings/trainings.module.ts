import { forwardRef, Module } from "@nestjs/common";
import { ClientsRepository } from "../clients/clients.repository";
import { ConnectorsModule } from "../connectors/connectors.module";
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
  imports: [
    forwardRef(() => GroupsModule),
    TrainersModule,
    NotificationsModule,
    CourtsModule,
    ConnectorsModule
  ],
  controllers: [TrainingsController, TrainerTodayController],
  // ClientsRepository (only deps DatabaseService) is provided directly so
  // listParticipants can resolve a non-admin caller's client, mirroring GroupsModule.
  providers: [TrainingsService, TrainingsRepository, ClientsRepository],
  exports: [TrainingsService]
})
export class TrainingsModule {}
