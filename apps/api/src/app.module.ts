import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { ConfigModule } from "./config/config.module";
import { DbModule } from "./db/db.module";
import { HealthModule } from "./health/health.module";
import { AnalyticsModule } from "./modules/analytics/analytics.module";
import { AuthModule } from "./modules/auth/auth.module";
import { BookingsModule } from "./modules/bookings/bookings.module";
import { BroadcastsModule } from "./modules/broadcasts/broadcasts.module";
import { ClientsModule } from "./modules/clients/clients.module";
import { CourtsModule } from "./modules/courts/courts.module";
import { CourtRequestsModule } from "./modules/court-requests/court-requests.module";
import { DiagnosticsModule } from "./modules/diagnostics/diagnostics.module";
import { GroupsModule } from "./modules/groups/groups.module";
import { I18nModule } from "./modules/i18n/i18n.module";
import { LevelsModule } from "./modules/levels/levels.module";
import { NotificationsModule } from "./modules/notifications/notifications.module";
import { TrainersModule } from "./modules/trainers/trainers.module";
import { TrainingsModule } from "./modules/trainings/trainings.module";
import { WaitlistModule } from "./modules/waitlist/waitlist.module";

/**
 * Root module. One module per domain is added under src/modules/* as features
 * land (clients, levels, trainers, groups, trainings, bookings, waitlist,
 * notifications, broadcasts, analytics, courts, court-requests, admin).
 */
@Module({
  imports: [
    ScheduleModule.forRoot(),
    ConfigModule,
    DbModule,
    HealthModule,
    AuthModule,
    LevelsModule,
    TrainersModule,
    GroupsModule,
    TrainingsModule,
    ClientsModule,
    NotificationsModule,
    WaitlistModule,
    BookingsModule,
    BroadcastsModule,
    AnalyticsModule,
    CourtsModule,
    CourtRequestsModule,
    DiagnosticsModule,
    I18nModule
  ]
})
export class AppModule {}
