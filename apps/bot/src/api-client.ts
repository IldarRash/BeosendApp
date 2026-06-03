import {
  clientSchema,
  groupSchema,
  levelSchema,
  trainerSchema,
  type Client,
  type Group,
  type Level,
  type OnboardClientInput,
  type Trainer
} from "@beosand/types";
import { z } from "zod";

const healthSchema = z.object({ status: z.literal("ok"), service: z.string() });

const levelsSchema = z.array(levelSchema);
const trainersSchema = z.array(trainerSchema);
const groupsSchema = z.array(groupSchema);

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

  /** Like {@link request} but resolves to null on a 404 so callers can branch. */
  private async requestOrNull<T>(
    path: string,
    schema: z.ZodType<T>,
    init?: RequestInit
  ): Promise<T | null> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...init?.headers }
    });
    if (res.status === 404) {
      return null;
    }
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

  /**
   * Active trainer roster (status=active, ordered by name). Reference data
   * consumed by group creation and slot rendering (and the future admin/trainer
   * UI); trainers have no standalone client bot screen of their own.
   */
  listTrainers(): Promise<Trainer[]> {
    return this.request("/trainers", trainersSchema);
  }

  /**
   * Active groups (recurring slots: level, weekdays, time, trainer, capacity,
   * RSD prices). Reference data the client "join a group" flow (T1.9) and the
   * admin authoring UI (A1) will consume; groups have no standalone client bot
   * screen in this slice. Prices are server-computed integer RSD; the bot only
   * displays them.
   */
  listGroups(): Promise<Group[]> {
    return this.request("/groups", groupsSchema);
  }

  /**
   * Look up the client by numeric Telegram id. Resolves to null when the API
   * returns 404 (a not-yet-onboarded user), so the /start handler can branch
   * new-user vs returning-user. Identity is always the numeric telegram_id.
   */
  getClientByTelegramId(telegramId: number): Promise<Client | null> {
    return this.requestOrNull(`/clients/by-telegram/${telegramId}`, clientSchema, {
      headers: { "x-telegram-id": String(telegramId) }
    });
  }

  /**
   * Create (or, idempotently, return the existing) client record. The API owns
   * persistence and enforces idempotency on telegram_id; the bot only forwards
   * the typed onboarding input and renders the result.
   */
  onboardClient(input: OnboardClientInput): Promise<Client> {
    return this.request("/clients/onboard", clientSchema, {
      method: "POST",
      headers: { "x-telegram-id": String(input.telegramId) },
      body: JSON.stringify(input)
    });
  }
}
