import {
  analyticsSummarySchema,
  bookingSchema,
  broadcastPreviewSchema,
  broadcastSchema,
  clientSchema,
  groupBookingResultSchema,
  groupSchema,
  levelSchema,
  markAttendanceSchema,
  myBookingItemSchema,
  slotCardSchema,
  trainerSchema,
  trainerTodayItemSchema,
  trainingRosterSchema,
  trainingSchema,
  waitlistEntrySchema,
  type AnalyticsSummary,
  type AvailableSlotsQuery,
  type Booking,
  type Broadcast,
  type BroadcastPreview,
  type BroadcastType,
  type Client,
  type CreateGroupBookingInput,
  type CreateSingleBookingInput,
  type CreateWaitlistInput,
  type GenerateMonthInput,
  type Group,
  type GroupBookingResult,
  type Level,
  type ListTrainingsQuery,
  type MarkAttendanceInput,
  type MyBookingItem,
  type MyBookingScope,
  type OnboardClientInput,
  type SlotCard,
  type Trainer,
  type TrainerTodayItem,
  type Training,
  type TrainingRoster,
  type WaitlistEntry
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

/**
 * Outcome of joining a waitlist. `conflict` maps the API's 409 (the slot is
 * still bookable, or the client is already on the list) to a bot message; any
 * other non-2xx is a real error and throws.
 */
export type JoinWaitlistResult =
  | { ok: true; entry: WaitlistEntry }
  | { ok: false; reason: "conflict" };

/**
 * Outcome of accepting a promoted waitlist slot. `conflict` maps the API's 409
 * (window expired or the freed seat was re-taken) to the bot's "место занято /
 * окно истекло" message; any other non-2xx throws.
 */
export type AcceptWaitlistResult =
  | { ok: true; booking: Booking }
  | { ok: false; reason: "conflict" };

const levelsSchema = z.array(levelSchema);
const trainersSchema = z.array(trainerSchema);
const groupsSchema = z.array(groupSchema);
const trainingsSchema = z.array(trainingSchema);
const slotCardsSchema = z.array(slotCardSchema);
const myBookingsSchema = z.array(myBookingItemSchema);
const trainerTodaySchema = z.array(trainerTodayItemSchema);

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

  /**
   * Cancel one of the caller's bookings (T1.11). The booking is matched by id;
   * ownership, the seat free, status recompute and (later) waitlist promotion are
   * all decided server-side from the caller's telegram_id. Cancelling one date of
   * a monthly group leaves the sibling bookings intact — the API targets the id
   * only. The bot only forwards the id and renders the cancelled booking.
   */
  cancelBooking(bookingId: string, actorTelegramId: number): Promise<Booking> {
    return this.request(`/bookings/${bookingId}/cancel`, bookingSchema, {
      method: "POST",
      headers: { "x-telegram-id": String(actorTelegramId) }
    });
  }

  /**
   * Join a full training's waitlist (T2.1). Eligibility (the slot must be full,
   * one entry per client) is decided server-side from the actor's telegram_id; a
   * 409 (slot still bookable / already on the list) is surfaced as a distinct
   * result so the handler can show a message instead of a generic error. The
   * supplied clientId is re-checked against the caller server-side.
   */
  async joinWaitlist(
    input: CreateWaitlistInput,
    actorTelegramId: number
  ): Promise<JoinWaitlistResult> {
    const res = await fetch(`${this.baseUrl}/waitlist`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-id": String(actorTelegramId)
      },
      body: JSON.stringify(input)
    });
    if (res.status === 409) {
      return { ok: false, reason: "conflict" };
    }
    if (!res.ok) {
      throw new Error(`API /waitlist failed: ${res.status}`);
    }
    return { ok: true, entry: waitlistEntrySchema.parse(await res.json()) };
  }

  /**
   * Accept a promoted waitlist slot (T2.1) — the inline confirm button. Ownership,
   * the window check, and the atomic capacity re-check are all decided server-side
   * from the actor's telegram_id; a 409 (window expired / seat re-taken) is
   * surfaced as a distinct result so the handler can show "место уже занято".
   */
  async acceptWaitlist(entryId: string, actorTelegramId: number): Promise<AcceptWaitlistResult> {
    const res = await fetch(`${this.baseUrl}/waitlist/${entryId}/accept`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-id": String(actorTelegramId)
      }
    });
    if (res.status === 409) {
      return { ok: false, reason: "conflict" };
    }
    if (!res.ok) {
      throw new Error(`API /waitlist/${entryId}/accept failed: ${res.status}`);
    }
    return { ok: true, booking: bookingSchema.parse(await res.json()) };
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

  /**
   * A trainer's own trainings for today, with live headcount (T2.3). Identity is
   * the caller's telegram_id (sent both as the `x-telegram-id` header and the
   * `telegramId` query the API cross-checks); the API resolves the trainer and
   * scopes the list to them. A 403 (caller is not a trainer) resolves to null so
   * the bot can gate the trainer screen instead of erroring — non-trainers never
   * see a roster. The bot only renders the returned items.
   */
  async getTrainerToday(telegramId: number): Promise<TrainerTodayItem[] | null> {
    const res = await fetch(`${this.baseUrl}/trainers/me/today?telegramId=${telegramId}`, {
      headers: {
        "content-type": "application/json",
        "x-telegram-id": String(telegramId)
      }
    });
    if (res.status === 403) {
      // Caller is not a trainer: the bot hides the trainer UI rather than erroring.
      return null;
    }
    if (!res.ok) {
      throw new Error(`API /trainers/me/today failed: ${res.status}`);
    }
    return trainerTodaySchema.parse(await res.json());
  }

  /**
   * A training's roster (T2.3): participants joined to their client names, with
   * each booking's attendance status. Trainer/admin only — the API authorizes by
   * the caller's telegram_id against the training's trainer (admins excepted) and
   * excludes cancelled/waitlist rows. The bot only renders what it returns.
   */
  getTrainingRoster(trainingId: string, actorTelegramId: number): Promise<TrainingRoster> {
    return this.request(`/trainings/${trainingId}/roster`, trainingRosterSchema, {
      headers: { "x-telegram-id": String(actorTelegramId) }
    });
  }

  /**
   * Mark a participant attended / no_show (T2.3). Ownership (the booking's
   * training belongs to the caller's trainer, admins excepted), the today/past
   * date guard and the markable-status check are all decided server-side from the
   * caller's telegram_id. Attendance never touches capacity/status. The bot only
   * forwards the bookingId + status and re-renders the roster from the result.
   */
  markAttendance(
    bookingId: string,
    status: MarkAttendanceInput["status"],
    actorTelegramId: number
  ): Promise<Booking> {
    const body: MarkAttendanceInput = markAttendanceSchema.parse({ status });
    return this.request(`/bookings/${bookingId}/attendance`, bookingSchema, {
      method: "POST",
      headers: { "x-telegram-id": String(actorTelegramId) },
      body: JSON.stringify(body)
    });
  }

  /**
   * Admin-only (T2.4): preview a free-slot broadcast of one type. The API gates
   * the caller via ADMIN_TELEGRAM_IDS, selects only bookable slots, composes the
   * Russian text and counts active recipients — all server-side. A 403 (caller is
   * not an admin) resolves to null so the bot can hide the broadcast UI instead of
   * erroring; non-admins never see a preview. The preview never books and never
   * writes a broadcasts row. The bot only renders what it returns.
   */
  async previewBroadcast(
    type: BroadcastType,
    adminTelegramId: number
  ): Promise<BroadcastPreview | null> {
    const res = await fetch(`${this.baseUrl}/broadcasts/preview?type=${type}`, {
      headers: {
        "content-type": "application/json",
        "x-telegram-id": String(adminTelegramId)
      }
    });
    if (res.status === 403) {
      // Caller is not an admin: the bot hides the broadcast UI rather than erroring.
      return null;
    }
    if (!res.ok) {
      throw new Error(`API /broadcasts/preview failed: ${res.status}`);
    }
    return broadcastPreviewSchema.parse(await res.json());
  }

  /**
   * Admin-only (T2.4): send a free-slot broadcast of one type. The API gates the
   * caller via ADMIN_TELEGRAM_IDS, re-selects bookable slots at send time, fans
   * the send out to active clients via its own bot token, and writes exactly one
   * broadcasts row — all server-side. A 403 (caller is not an admin) resolves to
   * null so the bot can refuse instead of erroring. The bot only renders the
   * resulting row's recipient count; it never sends or books.
   */
  async sendBroadcast(type: BroadcastType, adminTelegramId: number): Promise<Broadcast | null> {
    const res = await fetch(`${this.baseUrl}/broadcasts/send`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-id": String(adminTelegramId)
      },
      body: JSON.stringify({ type })
    });
    if (res.status === 403) {
      return null;
    }
    if (!res.ok) {
      throw new Error(`API /broadcasts/send failed: ${res.status}`);
    }
    return broadcastSchema.parse(await res.json());
  }

  /**
   * Admin-only (T3.1): the composite analytics headline summary for the manager
   * screen. The API gates the caller via ADMIN_TELEGRAM_IDS, derives every figure
   * server-side from the authoritative tables and echoes the resolved range. Both
   * `from`/`to` are optional — omitting them lets the API default to the last 30
   * days. A 403 (caller is not an admin) resolves to null so the bot can show the
   * "managers only" message instead of erroring; non-admins never see the screen.
   * The bot only renders the returned numbers; it never aggregates or computes.
   */
  async getAnalyticsSummary(
    from: string | undefined,
    to: string | undefined,
    adminTelegramId: number
  ): Promise<AnalyticsSummary | null> {
    const params = new URLSearchParams();
    if (from) {
      params.set("from", from);
    }
    if (to) {
      params.set("to", to);
    }
    const qs = params.toString();
    const res = await fetch(`${this.baseUrl}/analytics/summary${qs ? `?${qs}` : ""}`, {
      headers: {
        "content-type": "application/json",
        "x-telegram-id": String(adminTelegramId)
      }
    });
    if (res.status === 403) {
      // Caller is not an admin: the bot hides the stats UI rather than erroring.
      return null;
    }
    if (!res.ok) {
      throw new Error(`API /analytics/summary failed: ${res.status}`);
    }
    return analyticsSummarySchema.parse(await res.json());
  }
}
