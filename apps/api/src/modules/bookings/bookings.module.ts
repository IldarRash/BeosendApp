import { Module } from "@nestjs/common";
import { ClientsRepository } from "../clients/clients.repository";
import { GroupsRepository } from "../groups/groups.repository";
import { NotificationsModule } from "../notifications/notifications.module";
import { BookingsController } from "./bookings.controller";
import { BookingsRepository } from "./bookings.repository";
import { BookingsService } from "./bookings.service";

@Module({
  imports: [NotificationsModule],
  controllers: [BookingsController],
  providers: [BookingsService, BookingsRepository, ClientsRepository, GroupsRepository]
})
export class BookingsModule {}
