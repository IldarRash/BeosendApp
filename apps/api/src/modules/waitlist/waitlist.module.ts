import { Module } from "@nestjs/common";
import { ClientsRepository } from "../clients/clients.repository";
import { NotificationsModule } from "../notifications/notifications.module";
import { WaitlistController } from "./waitlist.controller";
import { WaitlistRepository } from "./waitlist.repository";
import { WaitlistScheduler } from "./waitlist.scheduler";
import { WaitlistService } from "./waitlist.service";

/**
 * Waitlist domain (T2.1). Exports WaitlistService so the bookings cancel
 * post-commit seam can call promoteNext when a seat frees, without a circular
 * module import (BookingsModule imports WaitlistModule, not vice versa).
 */
@Module({
  imports: [NotificationsModule],
  controllers: [WaitlistController],
  providers: [WaitlistService, WaitlistRepository, ClientsRepository, WaitlistScheduler],
  exports: [WaitlistService]
})
export class WaitlistModule {}
