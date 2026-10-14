import { Module } from "@nestjs/common";
import { BroadcastAutomationsModule } from "../broadcast-automations/broadcast-automations.module";
import { ClientsRepository } from "../clients/clients.repository";
import { ConnectorsModule } from "../connectors/connectors.module";
import { GroupsRepository } from "../groups/groups.repository";
import { NotificationsModule } from "../notifications/notifications.module";
import { TrainersModule } from "../trainers/trainers.module";
import { TrainingPricingModule } from "../training-pricing/training-pricing.module";
import { SettingsModule } from "../settings/settings.module";
import { WaitlistModule } from "../waitlist/waitlist.module";
import { BookingsController } from "./bookings.controller";
import { BookingsRepository } from "./bookings.repository";
import { BookingsService } from "./bookings.service";
import { LateCancellationLiabilitiesController } from "./late-cancellation-liabilities.controller";

@Module({
  imports: [
    NotificationsModule,
    WaitlistModule,
    TrainersModule,
    TrainingPricingModule,
    SettingsModule,
    ConnectorsModule,
    BroadcastAutomationsModule
  ],
  controllers: [BookingsController, LateCancellationLiabilitiesController],
  providers: [BookingsService, BookingsRepository, ClientsRepository, GroupsRepository]
})
export class BookingsModule {}
