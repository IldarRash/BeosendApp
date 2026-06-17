import { Inject, Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import type { Env } from "@beosand/config";
import { type ConnectorId, type ConnectorStatus, connectorStatusListSchema } from "@beosand/types";
import { ENV } from "../../config/config.module";
import { CalendarFeedService } from "./calendar/calendar-feed.service";
import { GoogleCalendarPush } from "./calendar/google-calendar-push.service";
import { ChannelDispatcher } from "./channels/channel-dispatcher.service";
import { SheetsExportService } from "./export/sheets-export.service";
import type { OutboundConnector } from "./ports/connector.port";

/**
 * Collects every connector (notification channels + outbound connectors) and reports
 * each one's runtime state — `id`, `enabled`, `configured` — for the admin settings
 * screen and the test-send (connectors §3.4). On boot it logs exactly one line per
 * connector: `enabled` or `disabled (missing X)`, so an operator can see at a glance
 * which integrations are live. Secrets are never logged — only the connector id and
 * the names of the missing env vars.
 *
 * `configured` = required env vars present; `enabled` = wired in AND configured. In
 * Slice 0 the channels' enablement comes from the dispatcher's adapters (only
 * TelegramChannel); the other connector ids (calendar/webhooks/sheets/csv) report
 * their config-gated state from env so the status list is complete before Slices A–C
 * register their concrete adapters.
 */
@Injectable()
export class ConnectorRegistry implements OnApplicationBootstrap {
  private readonly logger = new Logger(ConnectorRegistry.name);

  constructor(
    private readonly channels: ChannelDispatcher,
    @Inject(ENV) private readonly env: Env,
    private readonly calendarFeed: CalendarFeedService,
    private readonly googleCalendar: GoogleCalendarPush,
    private readonly sheetsExport: SheetsExportService
  ) {}

  onApplicationBootstrap(): void {
    for (const status of this.status()) {
      const missing = this.missingFor(status.id);
      if (status.enabled) {
        this.logger.log(`Connector ${status.id}: enabled`);
      } else {
        this.logger.log(
          `Connector ${status.id}: disabled${missing.length ? ` (missing ${missing.join(", ")})` : ""}`
        );
      }
    }
  }

  /** Every connector's id + enabled/configured state, validated against the contract. */
  status(): ConnectorStatus[] {
    const list: ConnectorStatus[] = [
      // Notification channels. Telegram is registered; email/sms register in Slice B,
      // so until then they report their config-gated state from env.
      this.channelStatus("telegram"),
      this.channelStatus("email"),
      this.channelStatus("sms"),
      // Outbound connectors. Calendar (Slice A) reports from its live adapters; the
      // others land in Slice C and report their config gate from env until then.
      this.connectorStatus("calendar-ics", this.calendarFeed, this.calendarConfigured()),
      this.connectorStatus("google-calendar", this.googleCalendar, this.googleCalendarConfigured()),
      // Webhooks/CSV are always on (no creds); Sheets reports from its live adapter.
      this.configuredStatus("webhooks", true),
      this.connectorStatus("google-sheets", this.sheetsExport, this.sheetsConfigured()),
      this.configuredStatus("csv-export", true)
    ];
    return connectorStatusListSchema.parse(list);
  }

  /**
   * A channel's status. If a concrete adapter is registered in the dispatcher, use
   * its `isEnabled()`; otherwise fall back to the env config gate (so email/sms show
   * the right `configured` before Slice B wires their adapters).
   */
  private channelStatus(id: "telegram" | "email" | "sms"): ConnectorStatus {
    const adapter = this.channels.channel(id);
    const configured = this.channelConfigured(id);
    const enabled = adapter ? adapter.isEnabled() : false;
    return { id, enabled, configured };
  }

  private configuredStatus(id: ConnectorId, configured: boolean): ConnectorStatus {
    return { id, enabled: configured, configured };
  }

  /**
   * A registered outbound connector's status: `enabled` from its live `isEnabled()`,
   * `configured` from the env gate (they agree, but `configured` stays env-derived for
   * the boot log's "missing X" line).
   */
  private connectorStatus(
    id: ConnectorId,
    connector: Pick<OutboundConnector, "isEnabled">,
    configured: boolean
  ): ConnectorStatus {
    return { id, enabled: connector.isEnabled(), configured };
  }

  private channelConfigured(id: "telegram" | "email" | "sms"): boolean {
    switch (id) {
      case "telegram":
        return this.env.TELEGRAM_BOT_TOKEN.length > 0;
      case "email":
        return this.env.EMAIL_PROVIDER !== undefined;
      case "sms":
        return (
          this.env.TWILIO_ACCOUNT_SID !== undefined &&
          this.env.TWILIO_AUTH_TOKEN !== undefined &&
          this.env.TWILIO_FROM_NUMBER !== undefined
        );
    }
  }

  private calendarConfigured(): boolean {
    return this.env.CALENDAR_FEED_SECRET !== undefined && this.env.PUBLIC_BASE_URL !== undefined;
  }

  private googleCalendarConfigured(): boolean {
    return (
      this.env.GOOGLE_SERVICE_ACCOUNT_JSON !== undefined &&
      this.env.GOOGLE_CALENDAR_ID !== undefined
    );
  }

  private sheetsConfigured(): boolean {
    return (
      this.env.GOOGLE_SERVICE_ACCOUNT_JSON !== undefined && this.env.GOOGLE_SHEETS_ID !== undefined
    );
  }

  /** The env var names a disabled connector is waiting on (for the boot log only). */
  private missingFor(id: ConnectorId): string[] {
    switch (id) {
      case "telegram":
        return this.env.TELEGRAM_BOT_TOKEN.length > 0 ? [] : ["TELEGRAM_BOT_TOKEN"];
      case "email":
        return this.env.EMAIL_PROVIDER ? [] : ["EMAIL_PROVIDER"];
      case "sms":
        return [
          ...(this.env.TWILIO_ACCOUNT_SID ? [] : ["TWILIO_ACCOUNT_SID"]),
          ...(this.env.TWILIO_AUTH_TOKEN ? [] : ["TWILIO_AUTH_TOKEN"]),
          ...(this.env.TWILIO_FROM_NUMBER ? [] : ["TWILIO_FROM_NUMBER"])
        ];
      case "calendar-ics":
        return [
          ...(this.env.CALENDAR_FEED_SECRET ? [] : ["CALENDAR_FEED_SECRET"]),
          ...(this.env.PUBLIC_BASE_URL ? [] : ["PUBLIC_BASE_URL"])
        ];
      case "google-calendar":
        return [
          ...(this.env.GOOGLE_SERVICE_ACCOUNT_JSON ? [] : ["GOOGLE_SERVICE_ACCOUNT_JSON"]),
          ...(this.env.GOOGLE_CALENDAR_ID ? [] : ["GOOGLE_CALENDAR_ID"])
        ];
      case "google-sheets":
        return [
          ...(this.env.GOOGLE_SERVICE_ACCOUNT_JSON ? [] : ["GOOGLE_SERVICE_ACCOUNT_JSON"]),
          ...(this.env.GOOGLE_SHEETS_ID ? [] : ["GOOGLE_SHEETS_ID"])
        ];
      case "webhooks":
      case "csv-export":
        return [];
    }
  }
}
