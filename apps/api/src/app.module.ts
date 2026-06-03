import { Module } from "@nestjs/common";
import { ConfigModule } from "./config/config.module";
import { DbModule } from "./db/db.module";
import { HealthModule } from "./health/health.module";
import { LevelsModule } from "./modules/levels/levels.module";

/**
 * Root module. One module per domain is added under src/modules/* as features
 * land (clients, levels, trainers, groups, trainings, bookings, waitlist,
 * notifications, broadcasts, analytics, courts, court-requests, admin).
 */
@Module({
  imports: [ConfigModule, DbModule, HealthModule, LevelsModule]
})
export class AppModule {}
