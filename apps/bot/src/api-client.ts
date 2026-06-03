import { z } from "zod";
import {
  courtAvailabilitySchema,
  courtRequestAdminViewSchema,
  courtRequestPreviewSchema,
  courtRequestSchema,
  courtSchema,
  type Court,
  type CourtAvailability,
  type CourtDurationHours,
  type CourtRequest,
  type CourtRequestAdminView,
  type CourtRequestPreview
} from "@beosand/types";

/** Header carrying the caller's numeric Telegram id for admin-gated endpoints. */
const TELEGRAM_ID_HEADER = "x-telegram-id";

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

  /**
   * C4 — admin moderation queue (pending court requests, joined with client
   * name/telegram). The API enforces the admin gate by x-telegram-id; the bot
   * only forwards the caller's id and renders the validated rows.
   */
  listPendingCourtRequests(adminId: number): Promise<CourtRequestAdminView[]> {
    return this.request(
      "/court-requests?status=pending",
      z.array(courtRequestAdminViewSchema),
      { headers: { [TELEGRAM_ID_HEADER]: String(adminId) } }
    );
  }

  /**
   * C4 — active courts free for every hour the given request covers. Admin-only
   * (gated server-side); never a client path. The bot renders one button per
   * returned court so the admin can assign one manually.
   */
  freeCourtsForRequest(adminId: number, requestId: string): Promise<Court[]> {
    return this.request(
      `/court-requests/${requestId}/free-courts`,
      z.array(courtSchema),
      { headers: { [TELEGRAM_ID_HEADER]: String(adminId) } }
    );
  }

  /**
   * C4 — confirm a pending request onto the admin-chosen court. The API re-checks
   * the per-hour limit and chosen-court freeness atomically and notifies the
   * client with the court number + total RSD; the bot sends only IDs.
   */
  confirmCourtRequest(adminId: number, requestId: string, courtId: string): Promise<CourtRequest> {
    return this.request(`/court-requests/${requestId}/confirm`, courtRequestSchema, {
      method: "POST",
      headers: { [TELEGRAM_ID_HEADER]: String(adminId) },
      body: JSON.stringify({ requestId, courtId, decidedBy: adminId })
    });
  }

  /** C4 — reject a pending request. The API stamps decided_* and notifies the client. */
  rejectCourtRequest(adminId: number, requestId: string): Promise<CourtRequest> {
    return this.request(`/court-requests/${requestId}/reject`, courtRequestSchema, {
      method: "POST",
      headers: { [TELEGRAM_ID_HEADER]: String(adminId) },
      body: JSON.stringify({ requestId, decidedBy: adminId })
    });
  }
}
