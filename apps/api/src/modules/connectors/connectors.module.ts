import { forwardRef, Module } from "@nestjs/common";
import { ClientsRepository } from "../clients/clients.repository";
import { NotificationsModule } from "../notifications/notifications.module";
import { TrainersRepository } from "../trainers/trainers.repository";
import { TrainingsRepository } from "../trainings/trainings.repository";
import { CalendarController } from "./calendar/calendar.controller";
import { CalendarFeedService } from "./calendar/calendar-feed.service";
import { CalendarLinkService } from "./calendar/calendar-link.service";
import { GoogleCalendarPush } from "./calendar/google-calendar-push.service";
import { ChannelDispatcher } from "./channels/channel-dispatcher.service";
import { EmailChannel } from "./channels/email.channel";
import { SmsChannel } from "./channels/sms.channel";
import { TelegramChannel } from "./channels/telegram.channel";
import { ConnectorRegistry } from "./connector-registry.service";
import { ConnectorsController } from "./connectors.controller";
import { ConnectorsService } from "./connectors.service";
import { DomainEventsService } from "./domain-events.service";
import { CsvExportService } from "./export/csv-export.service";
import { ExportController, SheetsController } from "./export/export.controller";
import { ExportDataRepository } from "./export/export-data.repository";
import { ExportService } from "./export/export.service";
import { SheetsExportService } from "./export/sheets-export.service";
import { WebhookDeliveriesRepository } from "./webhooks/webhook-deliveries.repository";
import { WebhookDispatcher } from "./webhooks/webhook-dispatcher.service";
import { WebhookEndpointsRepository } from "./webhooks/webhook-endpoints.repository";
import { WebhookRetryScheduler } from "./webhooks/webhook-retry.scheduler";
import { WebhooksController } from "./webhooks/webhooks.controller";
import { WebhooksService } from "./webhooks/webhooks.service";

/**
 * The connectors domain module (connectors §3): owns all third-party integration
 * seams. Domain services don't call provider SDKs — they emit typed domain events
 * (DomainEventsService) and send via the ChannelDispatcher, which the connector layer
 * consumes. Slice 0 shipped the foundation (event seam, channel dispatcher, registry);
 * Slice A adds the calendar connector: the signed-token `.ics` feed (CalendarFeedService
 * + CalendarController), admin link/rotate (CalendarLinkService), and the optional
 * Google Calendar push listener (GoogleCalendarPush).
 *
 * The calendar reads live on the trainings/clients/trainers repositories, which only
 * depend on the global DatabaseService; they're provided directly here (rather than
 * importing those domain modules) to avoid a circular import with TrainingsModule,
 * which already imports ConnectorsModule for DomainEventsService.
 */
@Module({
  // forwardRef: NotificationsModule imports ConnectorsModule for the ChannelDispatcher
  // while ConnectorsModule imports NotificationsModule for the wrapped TelegramSender.
  imports: [forwardRef(() => NotificationsModule)],
  controllers: [
    CalendarController,
    ConnectorsController,
    // Slice C: outbound webhook CRUD + delivery log + CSV/Sheets export.
    WebhooksController,
    ExportController,
    SheetsController
  ],
  providers: [
    DomainEventsService,
    ChannelDispatcher,
    TelegramChannel,
    // Slice B: email/sms channels register alongside telegram so domain
    // notifications fan out to walk-ins with an email/phone but no Telegram.
    EmailChannel,
    SmsChannel,
    ConnectorRegistry,
    ConnectorsService,
    // Calendar connector (Slice A).
    CalendarFeedService,
    CalendarLinkService,
    GoogleCalendarPush,
    // Webhooks connector (Slice C): event listener + retry scheduler + admin CRUD.
    WebhookEndpointsRepository,
    WebhookDeliveriesRepository,
    WebhookDispatcher,
    WebhookRetryScheduler,
    WebhooksService,
    // Sheets/CSV export (Slice C): always-on CSV + gated Google Sheets.
    ExportDataRepository,
    CsvExportService,
    SheetsExportService,
    ExportService,
    // DB-access repos the calendar feed reads from (DatabaseService-only deps).
    TrainingsRepository,
    ClientsRepository,
    TrainersRepository
  ],
  exports: [DomainEventsService, ChannelDispatcher, ConnectorRegistry]
})
export class ConnectorsModule {}
