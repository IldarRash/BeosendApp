import { Module } from "@nestjs/common";
import { ConfigModule } from "./config/config.module";
import { DbModule } from "./db/db.module";
import { HealthModule } from "./health/health.module";
import { BookingsModule } from "./modules/bookings/bookings.module";
import { ClientsModule } from "./modules/clients/clients.module";
import { GroupsModule } from "./modules/groups/groups.module";
import { LevelsModule } from "./modules/levels/levels.module";
import { TrainersModule } from "./modules/trainers/trainers.module";
import { TrainingsModule } from "./modules/trainings/trainings.module";

/**
 * Root module. One module per domain is added under src/modules/* as features
 * land (clients, levels, trainers, groups, trainings, bookings, waitlist,
 * notifications, broadcasts, analytics, courts, court-requests, admin).
 */
@Module({
  imports: [
    ConfigModule,
    DbModule,
    HealthModule,
    LevelsModule,
    TrainersModule,
    GroupsModule,
    TrainingsModule,
    ClientsModule,
    BookingsModule
  ]
})
export class AppModule {}
