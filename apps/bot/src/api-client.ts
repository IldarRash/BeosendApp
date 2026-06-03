import {
  bookingSchema,
  clientSchema,
  groupBookingResultSchema,
  groupSchema,
  levelSchema,
  myBookingItemSchema,
  slotCardSchema,
  trainerSchema,
  trainingSchema,
  type AvailableSlotsQuery,
  type Booking,
  type Client,
  type CreateGroupBookingInput,
  type CreateSingleBookingInput,
  type GenerateMonthInput,
  type Group,
  type GroupBookingResult,
  type Level,
  type ListTrainingsQuery,
  type MyBookingItem,
  type MyBookingScope,
  type OnboardClientInput,
  type SlotCard,
  type Trainer,
  type Training
} from "@beosand/types";
import { z } from "zod";

const healthSchema = z.object({ status: z.literal("ok"), service: z.string() });

/**
 * Discriminated outcome of a single-booking attempt. `conflict` maps the API's
 * 409 (slot full/cancelled, or already booked) to the bot's waitlist/full
 * branch; any other non-2xx is a real error and throws.
 */
export type CreateSingleBookingResult =
  | { ok: true; booking: Booking }
  | { ok: false; reason: "conflict" };

const levelsSchema = z.array(levelSchema);
const trainersSchema = z.array(trainerSchema);
const groupsSchema = z.array(groupSchema);
const trainingsSchema = z.array(trainingSchema);
const slotCardsSchema = z.array(slotCardSchema);
const myBookingsSchema = z.array(myBookingItemSchema);

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

  /**
   * Admin-only (A1, deferred to the admin UI): generate one training per group
   * weekday across a month. The API authorizes via ADMIN_TELEGRAM_IDS, copies
   * the group's capacity/trainer/times, and is idempotent; the bot only renders
   * the count of created trainings it returns.
   */
  generateMonth(input: GenerateMonthInput, actorTelegramId: number): Promise<Training[]> {
    return this.request("/trainings/generate", trainingsSchema, {
      method: "POST",
      headers: { "x-telegram-id": String(actorTelegramId) },
      body: JSON.stringify(input)
    });
  }

  /**
   * Client-facing bookable-slot catalogue (T1.5). The API returns only
   * `isBookable` slots (status `open` + free seats), defaulting to a 14-day
   * window, with server-computed free seats and RSD prices. Public read — same
   * catalogue for every client, no per-user data — so no auth header is sent.
   * The bot only displays these cards; it never computes seats or price.
   */
  listAvailableSlots(query: AvailableSlotsQuery = {}): Promise<SlotCard[]> {
    const params = new URLSearchParams();
    if (query.from) {
      params.set("from", query.from);
    }
    if (query.to) {
      params.set("to", query.to);
    }
    if (query.levelId) {
      params.set("levelId", query.levelId);
    }
    const qs = params.toString();
    return this.request(`/trainings/available${qs ? `?${qs}` : ""}`, slotCardsSchema);
  }

  /**
   * Book a single training seat (T1.8). Ownership and capacity are enforced
   * server-side; the bot only forwards the IDs and renders the outcome. A 409
   * (slot full/cancelled, or already booked) is surfaced as a distinct result so
   * the handler can branch to the waitlist/full message instead of a generic
   * error. The actor's telegram_id is the identity the API re-resolves the
   * client from; clientId/trainingId are never trusted on their own.
   */
  async createSingleBooking(
    input: CreateSingleBookingInput,
    actorTelegramId: number
  ): Promise<CreateSingleBookingResult> {
    const res = await fetch(`${this.baseUrl}/bookings/single`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-id": String(actorTelegramId)
      },
      body: JSON.stringify(input)
    });
    if (res.status === 409) {
      // Slot is full/cancelled or already booked: the caller offers the waitlist.
      return { ok: false, reason: "conflict" };
    }
    if (!res.ok) {
      throw new Error(`API /bookings/single failed: ${res.status}`);
    }
    return { ok: true, booking: bookingSchema.parse(await res.json()) };
  }

  /**
   * Book a client into a group for a whole month (T1.9): one booking per bookable
   * training instance, linked by a shared group_subscription_id. Ownership,
   * capacity and the linked batch are decided server-side from the actor's
   * telegram_id; the bot only forwards the IDs and renders the created/skipped
   * result. The supplied clientId is re-checked against the caller server-side.
   */
  createGroupBooking(
    input: CreateGroupBookingInput,
    actorTelegramId: number
  ): Promise<GroupBookingResult> {
    return this.request("/bookings/group", groupBookingResultSchema, {
      method: "POST",
      headers: { "x-telegram-id": String(actorTelegramId) },
      body: JSON.stringify(input)
    });
  }

  /**
   * A client's own bookings for one scope (T1.10): `upcoming` or `past`, already
   * split, ordered and `canCancel`-flagged server-side. Identity is the caller's
   * telegram_id (sent as the `x-telegram-id` header); the API re-resolves the
   * client and rejects a `clientId` that isn't the caller's (admins excepted).
   * The bot only renders these items — it never decides scope or cancellability.
   */
  listMyBookings(
    clientId: string,
    scope: MyBookingScope,
    actorTelegramId: number
  ): Promise<MyBookingItem[]> {
    const params = new URLSearchParams({ clientId, scope });
    return this.request(`/bookings/mine?${params.toString()}`, myBookingsSchema, {
      headers: { "x-telegram-id": String(actorTelegramId) }
    });
  }

  /** Admin-only (deferred to the admin UI): list trainings in a date range. */
  listTrainings(query: ListTrainingsQuery, actorTelegramId: number): Promise<Training[]> {
    const params = new URLSearchParams({ from: query.from, to: query.to });
    if (query.groupId) {
      params.set("groupId", query.groupId);
    }
    return this.request(`/trainings?${params.toString()}`, trainingsSchema, {
      headers: { "x-telegram-id": String(actorTelegramId) }
    });
  }
}
