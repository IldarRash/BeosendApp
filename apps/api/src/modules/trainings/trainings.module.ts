import { forwardRef, Module } from "@nestjs/common";
import { BookingsRepository } from "../bookings/bookings.repository";
import { ClientsRepository } from "../clients/clients.repository";
import { ConnectorsModule } from "../connectors/connectors.module";
import { CourtsModule } from "../courts/courts.module";
import { GroupsModule } from "../groups/groups.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { SettingsModule } from "../settings/settings.module";
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
    ConnectorsModule,
    SettingsModule
  ],
  controllers: [TrainingsController, TrainerTodayController],
  // ClientsRepository and BookingsRepository (each only deps DatabaseService) are
  // provided directly — listParticipants resolves a non-admin caller's client and the
  // individual-month generator reuses the bookings seat-write path — mirroring how
  // GroupsModule provides repos directly to avoid a module cycle.
  providers: [
    TrainingsService,
    TrainingsRepository,
    ClientsRepository,
    BookingsRepository
  ],
  exports: [TrainingsService]
})
export class TrainingsModule {}
