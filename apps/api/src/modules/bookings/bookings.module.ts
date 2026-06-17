import { Module } from "@nestjs/common";
import { ClientsRepository } from "../clients/clients.repository";
import { ConnectorsModule } from "../connectors/connectors.module";
import { GroupsRepository } from "../groups/groups.repository";
import { NotificationsModule } from "../notifications/notifications.module";
import { TrainersModule } from "../trainers/trainers.module";
import { WaitlistModule } from "../waitlist/waitlist.module";
import { BookingsController } from "./bookings.controller";
import { BookingsRepository } from "./bookings.repository";
import { BookingsService } from "./bookings.service";

@Module({
  imports: [NotificationsModule, WaitlistModule, TrainersModule, ConnectorsModule],
  controllers: [BookingsController],
  providers: [BookingsService, BookingsRepository, ClientsRepository, GroupsRepository]
})
export class BookingsModule {}
