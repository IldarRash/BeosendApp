import { describe, expect, it } from "vitest";
import type { Env } from "@beosand/config";
import { connectorStatusListSchema } from "@beosand/types";
import { CalendarFeedService } from "./calendar/calendar-feed.service";
import { GoogleCalendarPush } from "./calendar/google-calendar-push.service";
import { ChannelDispatcher } from "./channels/channel-dispatcher.service";
import { ConnectorRegistry } from "./connector-registry.service";
import { SheetsExportService } from "./export/sheets-export.service";
import type { TelegramChannel } from "./channels/telegram.channel";

function telegramAdapter(enabled: boolean): TelegramChannel {
  return {
    id: "telegram",
    isEnabled: () => enabled,
    canReach: () => true,
    send: async () => undefined
  } as unknown as TelegramChannel;
}

/** Only the connector-relevant env fields; the rest is irrelevant to status(). */
function makeEnv(over: Partial<Env> = {}): Env {
  return { TELEGRAM_BOT_TOKEN: "123:abc", ...over } as unknown as Env;
}

/** The calendar connectors read only env in isEnabled(); construct them off makeEnv. */
function buildRegistry(env: Env): ConnectorRegistry {
  const dispatcher = new ChannelDispatcher(telegramAdapter(true));
  const feed = new CalendarFeedService(
    env,
    {} as never,
    {} as never,
    {} as never
  );
  const google = new GoogleCalendarPush(env);
  // Reads only env in isEnabled(); the data repo is unused for status().
  const sheets = new SheetsExportService(env, {} as never);
  return new ConnectorRegistry(dispatcher, env, feed, google, sheets);
}

describe("ConnectorRegistry.status", () => {
  it("reports telegram enabled and absent providers as disabled+unconfigured", () => {
    const registry = buildRegistry(makeEnv());

    const status = connectorStatusListSchema.parse(registry.status());
    const byId = new Map(status.map((s) => [s.id, s]));

    expect(byId.get("telegram")).toEqual({ id: "telegram", enabled: true, configured: true });
    // Email/SMS providers absent → not configured, not enabled (no error).
    expect(byId.get("email")).toEqual({ id: "email", enabled: false, configured: false });
    expect(byId.get("sms")).toEqual({ id: "sms", enabled: false, configured: false });
    // Calendar/google-calendar/sheets gated on their env; absent → unconfigured.
    expect(byId.get("calendar-ics")?.configured).toBe(false);
    expect(byId.get("google-sheets")?.configured).toBe(false);
    // CSV export is always on (no creds).
    expect(byId.get("csv-export")).toEqual({ id: "csv-export", enabled: true, configured: true });
  });

  it("marks calendar configured once its env vars are present", () => {
    const env = makeEnv({
      CALENDAR_FEED_SECRET: "0123456789abcdef",
      PUBLIC_BASE_URL: "https://example.com"
    });
    const registry = buildRegistry(env);

    const status = registry.status();
    const calendar = status.find((s) => s.id === "calendar-ics");
    expect(calendar).toEqual({ id: "calendar-ics", enabled: true, configured: true });
  });
});
