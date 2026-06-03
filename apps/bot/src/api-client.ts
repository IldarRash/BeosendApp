import { z } from "zod";
import {
  courtAvailabilitySchema,
  courtRequestPreviewSchema,
  courtRequestSchema,
  type CourtAvailability,
  type CourtDurationHours,
  type CourtRequest,
  type CourtRequestPreview
} from "@beosand/types";

const healthSchema = z.object({ status: z.literal("ok"), service: z.string() });

/**
 * Thin typed client the bot uses to reach apps/api. The bot is an interaction
 * layer only: it never touches the database directly — every read/write goes
 * through the API, and responses are validated with the shared contracts.
 */
export class ApiClient {
  constructor(private readonly baseUrl: string) {}

  private async request<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...init?.headers }
    });
    if (!res.ok) {
      throw new Error(`API ${path} failed: ${res.status}`);
    }
    return schema.parse(await res.json());
  }

  health(): Promise<z.infer<typeof healthSchema>> {
    return this.request("/health", healthSchema);
  }

  /**
   * Offerable court start times + free-court counts for one date (C3). The API
   * computes the per-hour limit; the bot only renders the returned hours and
   * never sees a court number. Response is validated against the shared contract.
   */
  getCourtAvailability(date: string): Promise<CourtAvailability> {
    const query = new URLSearchParams({ date }).toString();
    return this.request(`/court-requests/availability?${query}`, courtAvailabilitySchema);
  }

  /**
   * C2 — server-computed RSD price + availability preview for a desired slot. No
   * write. The bot only displays the returned price; it never computes money.
   */
  previewCourtRequest(
    telegramId: number,
    date: string,
    startTime: string,
    durationHours: CourtDurationHours
  ): Promise<CourtRequestPreview> {
    return this.request("/court-requests/preview", courtRequestPreviewSchema, {
      method: "POST",
      body: JSON.stringify({ telegramId, date, startTime, durationHours })
    });
  }

  /**
   * C2 — submit a pending court request. The API resolves the caller by
   * telegram_id, computes the price, and creates the request with no court
   * assigned. The bot never sends a clientId, court id, or amount.
   */
  createCourtRequest(
    telegramId: number,
    date: string,
    startTime: string,
    durationHours: CourtDurationHours
  ): Promise<CourtRequest> {
    return this.request("/court-requests", courtRequestSchema, {
      method: "POST",
      body: JSON.stringify({ telegramId, date, startTime, durationHours })
    });
  }
}
