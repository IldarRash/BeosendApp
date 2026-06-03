import { z } from "zod";
import {
  courtBlockSchema,
  type CourtBlock,
  type CreateCourtBlock
} from "@beosand/types";

const healthSchema = z.object({ status: z.literal("ok"), service: z.string() });
const courtBlocksSchema = z.array(courtBlockSchema);

export type Health = z.infer<typeof healthSchema>;

/**
 * Thin typed client the admin SPA uses to reach apps/api. The console is an
 * interaction layer only: it never owns domain logic or money/availability math.
 * Every response is validated against a shared @beosand/types contract before the
 * UI renders it.
 *
 * Future admin endpoints (groups, trainings, broadcasts, analytics) hang off this
 * class the same way — add a method, validate with the matching contract. Those
 * endpoints, and the admin auth they require, are a separate feature: this client
 * is the seam, not the implementation.
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

  health(): Promise<Health> {
    return this.request("/health", healthSchema);
  }

  /** C5 — admin blocks a court for a whole-hour range. Identity via telegram id header. */
  createCourtBlock(telegramId: number, input: CreateCourtBlock): Promise<CourtBlock> {
    return this.request("/court-blocks", courtBlockSchema, {
      method: "POST",
      headers: adminHeader(telegramId),
      body: JSON.stringify(input)
    });
  }

  /** C5/C6 — admin lists all court blocks for a date. */
  listCourtBlocks(telegramId: number, date: string): Promise<CourtBlock[]> {
    const query = new URLSearchParams({ date }).toString();
    return this.request(`/court-blocks?${query}`, courtBlocksSchema, {
      headers: adminHeader(telegramId)
    });
  }

  /** C5 — admin removes a block, restoring availability (204, no body). */
  async deleteCourtBlock(telegramId: number, id: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/court-blocks/${id}`, {
      method: "DELETE",
      headers: adminHeader(telegramId)
    });
    if (!res.ok) {
      throw new Error(`API /court-blocks/${id} failed: ${res.status}`);
    }
  }
}

/** Caller identity convention shared across apps: numeric Telegram id in a header. */
function adminHeader(telegramId: number): Record<string, string> {
  return { "x-telegram-id": String(telegramId) };
}

/** Resolve the API base URL from browser env, defaulting to local dev. */
export function createApiClient(): ApiClient {
  return new ApiClient(import.meta.env.VITE_API_URL ?? "http://localhost:3000");
}
