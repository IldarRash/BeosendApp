import { Inject, Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import type { Env } from "@beosand/config";
import {
  type BookingCreatedEvent,
  type ConnectorId,
  type TrainingCancelledEvent,
  BELGRADE_TZ,
  zonedWallClockToUtc
} from "@beosand/types";
import { google } from "googleapis";
import { ENV } from "../../../config/config.module";
import { DOMAIN_EVENT } from "../connector-events";
import type { OutboundConnector } from "../ports/connector.port";

/** A Google Calendar API client (the slice of `calendar.events` we use). */
interface CalendarApi {
  events: {
    list(params: unknown): Promise<{ data: { items?: { id?: string | null }[] } }>;
    insert(params: unknown): Promise<unknown>;
    delete(params: unknown): Promise<unknown>;
  };
}

/**
 * Optional Google Calendar mirror (connectors §6, Slice A). A domain-event listener
 * that, when Google creds are present, reflects training activity into one configured
 * Google Calendar (service account → `GOOGLE_CALENDAR_ID`). It upserts an event when a
 * booking is created (the first time a training becomes user-relevant) and deletes it
 * when the training is cancelled. There is no `training.created` event in v1, so
 * `booking.created` is the create trigger and `training.cancelled` the delete trigger.
 *
 * Gated + best-effort: with creds absent `isEnabled()` is false and every handler
 * no-ops (logged once at boot). It NEVER throws into the committed flow — a Google
 * failure is caught and logged, never propagated. Registered as an OutboundConnector.
 */
@Injectable()
export class GoogleCalendarPush implements OutboundConnector, OnApplicationBootstrap {
  readonly id: ConnectorId = "google-calendar";
  private readonly logger = new Logger(GoogleCalendarPush.name);
  private client: CalendarApi | undefined;

  constructor(@Inject(ENV) private readonly env: Env) {}

  isEnabled(): boolean {
    return (
      this.env.GOOGLE_SERVICE_ACCOUNT_JSON !== undefined &&
      this.env.GOOGLE_CALENDAR_ID !== undefined
    );
  }

  onApplicationBootstrap(): void {
    if (!this.isEnabled()) {
      this.logger.log("Google Calendar push disabled (creds absent); training events not mirrored");
    }
  }

  @OnEvent(DOMAIN_EVENT.BOOKING_CREATED)
  async onBookingCreated(event: BookingCreatedEvent): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }
    await this.safely("upsert", event.data.trainingId, async (api, calendarId) => {
      const eventId = this.eventIdFor(event.data.trainingId);
      const existing = await api.events.list({
        calendarId,
        iCalUID: `${eventId}@beosand`,
        showDeleted: false,
        maxResults: 1
      });
      if (existing.data.items && existing.data.items.length > 0) {
        return; // already mirrored — idempotent
      }
      await api.events.insert({
        calendarId,
        requestBody: {
          iCalUID: `${eventId}@beosand`,
          summary: event.data.clientName
            ? `BeoSand • ${event.data.clientName}`
            : "BeoSand тренировка",
          start: this.dateTime(event.data.date, event.data.startTime),
          end: this.dateTime(event.data.date, event.data.endTime)
        }
      });
    });
  }

  @OnEvent(DOMAIN_EVENT.TRAINING_CANCELLED)
  async onTrainingCancelled(event: TrainingCancelledEvent): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }
    await this.safely("delete", event.data.trainingId, async (api, calendarId) => {
      const eventId = this.eventIdFor(event.data.trainingId);
      const matches = await api.events.list({
        calendarId,
        iCalUID: `${eventId}@beosand`,
        showDeleted: false,
        maxResults: 1
      });
      const gid = matches.data.items?.[0]?.id;
      if (gid) {
        await api.events.delete({ calendarId, eventId: gid });
      }
    });
  }

  /** RFC3339 start/end for a Belgrade wall-clock; Google needs an absolute instant + tz. */
  private dateTime(date: string, time: string): { dateTime: string; timeZone: string } {
    return {
      dateTime: zonedWallClockToUtc(date, time, BELGRADE_TZ).toISOString(),
      timeZone: BELGRADE_TZ
    };
  }

  private eventIdFor(trainingId: string): string {
    return `training-${trainingId}`;
  }

  /**
   * Run a Google API operation, swallowing any failure (best-effort, post-commit).
   * The secret/service-account JSON is never logged — only the operation, the training
   * id, and a sanitized error message.
   */
  private async safely(
    op: string,
    trainingId: string,
    work: (api: CalendarApi, calendarId: string) => Promise<void>
  ): Promise<void> {
    try {
      const api = this.calendar();
      const calendarId = this.env.GOOGLE_CALENDAR_ID;
      if (!api || !calendarId) {
        return;
      }
      await work(api, calendarId);
    } catch (error) {
      this.logger.warn(
        `Google Calendar ${op} for training ${trainingId} failed (committed op stands): ` +
          (error instanceof Error ? error.message : String(error))
      );
    }
  }

  /** Lazily build (and cache) the service-account-authed Calendar client. */
  private calendar(): CalendarApi | undefined {
    if (this.client) {
      return this.client;
    }
    const raw = this.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    if (!raw) {
      return undefined;
    }
    const credentials = parseServiceAccount(raw);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/calendar.events"]
    });
    this.client = google.calendar({ version: "v3", auth }) as unknown as CalendarApi;
    return this.client;
  }
}

/** The service-account JSON may be supplied raw or base64-encoded; accept either. */
function parseServiceAccount(raw: string): Record<string, unknown> {
  const text = raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
  return JSON.parse(text) as Record<string, unknown>;
}
