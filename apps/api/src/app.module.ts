import { Module } from "@nestjs/common";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { ScheduleModule } from "@nestjs/schedule";
import { ConfigModule } from "./config/config.module";
import { ConnectorsModule } from "./modules/connectors/connectors.module";
import { DbModule } from "./db/db.module";
import { HealthModule } from "./health/health.module";
import { AnalyticsModule } from "./modules/analytics/analytics.module";
import { AuthModule } from "./modules/auth/auth.module";
import { BookingsModule } from "./modules/bookings/bookings.module";
import { BroadcastsModule } from "./modules/broadcasts/broadcasts.module";
import { ClientsModule } from "./modules/clients/clients.module";
import { CourtsModule } from "./modules/courts/courts.module";
import { CourtRequestsModule } from "./modules/court-requests/court-requests.module";
import { GroupsModule } from "./modules/groups/groups.module";
import { I18nModule } from "./modules/i18n/i18n.module";
import { LevelsModule } from "./modules/levels/levels.module";
import { ManagersModule } from "./modules/managers/managers.module";
import { NotificationsModule } from "./modules/notifications/notifications.module";
import { NotificationTemplatesModule } from "./modules/notification-templates/notification-templates.module";
import { SettingsModule } from "./modules/settings/settings.module";
import { SubscriptionsModule } from "./modules/subscriptions/subscriptions.module";
import { TrainersModule } from "./modules/trainers/trainers.module";
import { TrainingPricingModule } from "./modules/training-pricing/training-pricing.module";
import { TrainingsModule } from "./modules/trainings/trainings.module";
import { WaitlistModule } from "./modules/waitlist/waitlist.module";
import { RequestLoggingInterceptor } from "./request-logging/request-logging.interceptor";

/**
 * Root module. One module per domain is added under src/modules/* as features
 * land (clients, levels, trainers, groups, trainings, bookings, waitlist,
 * notifications, broadcasts, analytics, courts, court-requests, admin).
 */
@Module({
  imports: [
    ScheduleModule.forRoot(),
    EventEmitterModule.forRoot(),
    ConfigModule,
    DbModule,
    ConnectorsModule,
    HealthModule,
    AuthModule,
    LevelsModule,
    TrainersModule,
    TrainingPricingModule,
    ManagersModule,
    GroupsModule,
    TrainingsModule,
    ClientsModule,
    NotificationTemplatesModule,
    NotificationsModule,
    WaitlistModule,
    BookingsModule,
    BroadcastsModule,
    AnalyticsModule,
    CourtsModule,
    CourtRequestsModule,
    SubscriptionsModule,
    SettingsModule,
    I18nModule
  ],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: RequestLoggingInterceptor
    }
  ]
})
export class AppModule {}
