import { Module } from "@nestjs/common";
import { ClientsRepository } from "../clients/clients.repository";
import { BookingsController } from "./bookings.controller";
import { BookingsRepository } from "./bookings.repository";
import { BookingsService } from "./bookings.service";

@Module({
  controllers: [BookingsController],
  providers: [BookingsService, BookingsRepository, ClientsRepository]
})
export class BookingsModule {}
