import { levelSchema, type Level } from "@beosand/types";
import { z } from "zod";

const healthSchema = z.object({ status: z.literal("ok"), service: z.string() });
const levelsSchema = z.array(levelSchema);

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
   * Active level catalogue (client-facing; inactive levels are filtered by the
   * API). Reference data consumed by onboarding (T1.6) and group creation (A1);
   * levels have no standalone bot screen of their own.
   */
  listLevels(): Promise<Level[]> {
    return this.request("/levels", levelsSchema);
  }
}
