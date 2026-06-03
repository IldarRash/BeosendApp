import { z } from "zod";

const healthSchema = z.object({ status: z.literal("ok"), service: z.string() });

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
}

/** Resolve the API base URL from browser env, defaulting to local dev. */
export function createApiClient(): ApiClient {
  return new ApiClient(import.meta.env.VITE_API_URL ?? "http://localhost:3000");
}
