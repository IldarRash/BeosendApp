import {
  bookingSchema,
  clientSchema,
  groupBookingResultSchema,
  groupSchema,
  individualRequestDecisionResultSchema,
  individualRequestResultSchema,
  individualRequestSchema,
  labelCatalogSchema,
  levelSchema,
  managerContactSchema,
  markAttendanceSchema,
  myBookingItemSchema,
  singleBookingResultSchema,
  slotCardSchema,
  trainerSchema,
  trainerTodayItemSchema,
  trainingRosterSchema,
  trainingSchema,
  waitlistEntrySchema,
  type AvailableSlotsQuery,
  type Booking,
  type Client,
  type CreateGroupBookingInput,
  type CreateSingleBookingInput,
  type CreateWaitlistInput,
  type GenerateMonthInput,
  type Group,
  type GroupBookingResult,
  type IndividualRequestInput,
  type IndividualRequestResult,
  type LabelCatalog,
  type Level,
  type Locale,
  type MarkAttendanceInput,
  type ManagerContact,
  type MyBookingItem,
  type MyBookingScope,
  type OnboardClientInput,
  type SingleBookingResult,
  type SlotCard,
  type Trainer,
  type TrainerTodayItem,
  type Training,
  type TrainingRoster,
  type WaitlistEntry
} from "@beosand/types";
import { z } from "zod";

/** Header carrying the caller's numeric Telegram id for admin-gated endpoints. */
const TELEGRAM_ID_HEADER = "x-telegram-id";

const healthSchema = z.object({ status: z.literal("ok"), service: z.string() });

/**
 * Result of requesting an individual session. A 2xx response is the shared
 * durable request contract; a 404 is kept as the existing soft unavailable path
 * because no durable request id exists when the API cannot resolve the trainer
 * or client.
 */
export type RequestIndividualSessionResult =
  | IndividualRequestResult
  | { delivered: false; reason: "trainer-unavailable" };

/**
 * Outcome of joining a waitlist. `conflict` maps the API's 409 (the slot is
 * still bookable, or the client is already on the list) to a bot message; any
 * other non-2xx is a real error and throws.
 */
export type JoinWaitlistResult =
  | { ok: true; entry: WaitlistEntry }
  | { ok: false; reason: "conflict" };

/**
 * Outcome of a trainer confirm/decline action (trainer-confirmation). `ok` maps
 * a 2xx (the pending booking — or subscription batch — was confirmed/declined);
 * `alreadyDecided` maps the API's 409 (the row is no longer `pending`, e.g. a
 * double-tap or another device already handled it) and `notAuthorized` maps a 403
 * (the caller is not this batch's trainer/admin) so the bot can edit the DM to a
 * soft outcome instead of erroring. The authorization (trainer/admin against the
 * training's trainer), the status transition and the client/waitlist notifications
 * all happen server-side; the bot only forwards the id.
 */
export type TrainerDecisionResult =
  | { ok: true }
  | { ok: false; reason: "alreadyDecided" | "notAuthorized" };

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
   * Public manager contact setting shown by the bot. The API owns the editable
   * setting, env fallback, and URL derivation; the bot validates then renders.
   */
  getManagerContact(): Promise<ManagerContact> {
    return this.request("/settings/manager-contact", managerContactSchema);
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
   * Client-facing trainer roster for individual requests. The API applies the
   * individual visibility scope; the bot renders the returned list as-is.
   */
  listIndividualTrainers(): Promise<Trainer[]> {
    return this.request("/trainers?scope=individual", trainersSchema);
  }

  /**
   * Feature 8 — request an individual training with a trainer. Client-facing and
   * self-only: the caller's numeric telegram id is sent both as the
   * `x-telegram-id` header and the body, and the API DMs the chosen trainer with
   * a clickable link to the client (server-composed, never the bot). The bot only
   * forwards the trainerId + its own id and renders the typed result. A 404
   * (unknown/inactive trainer or not-onboarded client) resolves to the soft
   * `trainer-unavailable` result so the bot shows the "тренер пока недоступен"
   * message instead of erroring. No money/availability math here.
   */
  async requestIndividualSession(
    trainerId: string,
    input: IndividualRequestInput
  ): Promise<RequestIndividualSessionResult> {
    const body = individualRequestSchema.parse(input);
    const res = await fetch(`${this.baseUrl}/trainers/${trainerId}/individual-request`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [TELEGRAM_ID_HEADER]: String(body.telegramId)
      },
      body: JSON.stringify(body)
    });
    if (res.status === 404) {
      // Unknown/inactive trainer or not-onboarded client: surfaced softly.
      return { delivered: false, reason: "trainer-unavailable" };
    }
    if (!res.ok) {
      throw new Error(`API /trainers/${trainerId}/individual-request failed: ${res.status}`);
    }
    return individualRequestResultSchema.parse(await res.json());
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
   * Merged UI catalog for one locale (i18n): static defaults overlaid with the
   * admin's DB overrides, served by the API as a flat dotted-key → string map.
   * Public read (no admin gate). The bot hydrates this at startup and refreshes
   * it periodically; the bundled @beosand/i18n static catalog is the offline
   * fallback. The bot only renders these strings — it never composes domain text.
   */
  getLabelCatalog(locale: Locale): Promise<LabelCatalog> {
    const query = new URLSearchParams({ locale }).toString();
    return this.request(`/i18n/catalog?${query}`, labelCatalogSchema);
  }

  /**
   * Set a client's bot UI language (i18n). The API authorizes the write — a
   * caller may set only their own record (actor telegram id === path id), admins
   * any — so the bot forwards the caller's id as the `x-telegram-id` header and
   * the path id. The language is re-validated server-side; the bot only forwards
   * the chosen locale and renders the updated client.
   */
  setClientLanguage(telegramId: number, language: Locale): Promise<Client> {
    return this.request(`/clients/by-telegram/${telegramId}/language`, clientSchema, {
      method: "PATCH",
      headers: { [TELEGRAM_ID_HEADER]: String(telegramId) },
      body: JSON.stringify({ language })
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
   *
   * T3.2: the query may also carry `weekday`, `timeOfDay` and `trainerId`
   * filters (on top of `levelId`/`from`/`to`). The bot only forwards the chosen
   * filters; the API applies them server-side and can only ever *narrow* the
   * bookable set — a filter never surfaces a non-bookable slot. No filtering
   * math runs here.
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
    if (query.weekday !== undefined) {
      params.set("weekday", String(query.weekday));
    }
    if (query.timeOfDay) {
      params.set("timeOfDay", query.timeOfDay);
    }
    if (query.trainerId) {
      params.set("trainerId", query.trainerId);
    }
    const qs = params.toString();
    return this.request(`/trainings/available${qs ? `?${qs}` : ""}`, slotCardsSchema);
  }

  /**
   * Book a single training seat (T1.8). Ownership and capacity are enforced
   * server-side; the bot only forwards the IDs and renders the typed result.
   * A full group slot may come back as a server-created waitlist result with the
   * queue position. The actor's telegram_id is the identity the API re-resolves
   * the client from; clientId/trainingId are never trusted on their own.
   */
  async createSingleBooking(
    input: CreateSingleBookingInput,
    actorTelegramId: number
  ): Promise<SingleBookingResult> {
    const res = await fetch(`${this.baseUrl}/bookings/single`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-id": String(actorTelegramId)
      },
      body: JSON.stringify(input)
    });
    if (!res.ok) {
      throw new Error(`API /bookings/single failed: ${res.status}`);
    }
    return singleBookingResultSchema.parse(await res.json());
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
   * A trainer's own upcoming trainings (trainer-confirmation queue). Identity is
   * the caller's telegram_id (sent both as the `x-telegram-id` header and the
   * `telegramId` query the API cross-checks); the API resolves the trainer and
   * scopes the list to them, defaulting the horizon server-side. A 403 (caller is
   * not a trainer) resolves to null so the bot can gate the screen instead of
   * erroring — mirroring {@link getTrainerToday}. The response reuses the
   * today-item contract; the bot only renders the returned items.
   */
  async getTrainerUpcoming(telegramId: number): Promise<TrainerTodayItem[] | null> {
    const res = await fetch(`${this.baseUrl}/trainers/me/upcoming?telegramId=${telegramId}`, {
      headers: {
        "content-type": "application/json",
        [TELEGRAM_ID_HEADER]: String(telegramId)
      }
    });
    if (res.status === 403) {
      // Caller is not a trainer: the bot hides the trainer UI rather than erroring.
      return null;
    }
    if (!res.ok) {
      throw new Error(`API /trainers/me/upcoming failed: ${res.status}`);
    }
    return trainerTodaySchema.parse(await res.json());
  }

  /**
   * Confirm a pending single booking (trainer-confirmation). The booking is
   * matched by id; authorization (the booking's training belongs to the caller's
   * trainer, admins excepted), the `pending → booked` transition and the client
   * confirmation DM are all decided server-side from the caller's telegram_id. A
   * 409 (the booking is no longer pending — a double-tap or another device) is
   * surfaced as `alreadyDecided` so the handler edits the DM to "уже обработано"
   * instead of erroring. The bot only forwards the id and renders the outcome.
   */
  confirmBooking(bookingId: string, actorTelegramId: number): Promise<TrainerDecisionResult> {
    return this.trainerDecision(`/bookings/${bookingId}/confirm`, actorTelegramId, bookingSchema);
  }

  /**
   * Decline a pending single booking (trainer-confirmation). Authorization, the
   * `pending → cancelled` transition, the client decline DM and any waitlist
   * promotion are all decided server-side from the caller's telegram_id. A 409
   * (no longer pending) is surfaced as `alreadyDecided`. The bot only forwards
   * the id and renders the outcome.
   */
  declineBooking(bookingId: string, actorTelegramId: number): Promise<TrainerDecisionResult> {
    return this.trainerDecision(`/bookings/${bookingId}/decline`, actorTelegramId, bookingSchema);
  }

  /**
   * Confirm every pending booking of a monthly group subscription batch
   * (trainer-confirmation). The API acts only on that batch's `pending` rows,
   * authorizes against the training's trainer, transitions them to `booked` and
   * DMs the client — all server-side. A 409 is surfaced as `alreadyDecided`. The
   * bot only forwards the subscription id and renders the outcome.
   */
  confirmSubscription(
    groupSubscriptionId: string,
    actorTelegramId: number
  ): Promise<TrainerDecisionResult> {
    return this.trainerDecision(
      `/bookings/subscription/${groupSubscriptionId}/confirm`,
      actorTelegramId,
      groupBookingResultSchema
    );
  }

  /**
   * Decline every pending booking of a monthly group subscription batch
   * (trainer-confirmation). Authorization, the `pending → cancelled` transition,
   * the client decline DM and waitlist promotion are all server-side. A 409 is
   * surfaced as `alreadyDecided`. The bot only forwards the subscription id.
   */
  declineSubscription(
    groupSubscriptionId: string,
    actorTelegramId: number
  ): Promise<TrainerDecisionResult> {
    return this.trainerDecision(
      `/bookings/subscription/${groupSubscriptionId}/decline`,
      actorTelegramId,
      groupBookingResultSchema
    );
  }

  /**
   * Confirm one pending individual-session request. The API owns trainer/admin
   * authorization and creates the individual training + owner booking on success;
   * the bot validates the typed decision response, then renders only the outcome.
   */
  confirmIndividualRequest(
    requestId: string,
    actorTelegramId: number
  ): Promise<TrainerDecisionResult> {
    return this.trainerDecision(
      `/trainers/individual-requests/${requestId}/confirm`,
      actorTelegramId,
      individualRequestDecisionResultSchema
    );
  }

  /**
   * Decline one pending individual-session request. No training/booking is
   * created server-side; the bot validates the typed decision response and
   * renders the outcome.
   */
  declineIndividualRequest(
    requestId: string,
    actorTelegramId: number
  ): Promise<TrainerDecisionResult> {
    return this.trainerDecision(
      `/trainers/individual-requests/${requestId}/decline`,
      actorTelegramId,
      individualRequestDecisionResultSchema
    );
  }

  /**
   * Shared POST for the four trainer confirm/decline endpoints: empty body,
   * caller's telegram id in the header, a 409 mapped to the soft `alreadyDecided`
   * result, a 403 to the soft `notAuthorized` result and any other non-2xx thrown.
   * The API owns the decision; the bot only forwards the id.
   */
  private async trainerDecision<T>(
    path: string,
    actorTelegramId: number,
    schema: z.ZodType<T>
  ): Promise<TrainerDecisionResult> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [TELEGRAM_ID_HEADER]: String(actorTelegramId)
      },
      body: JSON.stringify({})
    });
    if (res.status === 409) {
      // Row is no longer pending (double-tap / handled elsewhere): edit the DM.
      return { ok: false, reason: "alreadyDecided" };
    }
    if (res.status === 403) {
      // Caller is not this batch's trainer/admin: soft outcome, not an error.
      return { ok: false, reason: "notAuthorized" };
    }
    if (!res.ok) {
      throw new Error(`API ${path} failed: ${res.status}`);
    }
    schema.parse(await res.json());
    return { ok: true };
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

}
