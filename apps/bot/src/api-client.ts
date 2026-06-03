import {
  analyticsSummarySchema,
  bookingSchema,
  broadcastPreviewSchema,
  broadcastSchema,
  changeCapacitySchema,
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
  type BroadcastAudience,
  type BroadcastPreview,
  type BroadcastType,
  type ChangeCapacityInput,
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
import {
  courtAvailabilitySchema,
  courtLoadGridSchema,
  courtRequestAdminViewSchema,
  courtRequestPreviewSchema,
  courtRequestSchema,
  courtSchema,
  type Court,
  type CourtAvailability,
  type CourtDurationHours,
  type CourtLoadGrid,
  type CourtRequest,
  type CourtRequestAdminView,
  type CourtRequestPreview
} from "@beosand/types";

/** Header carrying the caller's numeric Telegram id for admin-gated endpoints. */
const TELEGRAM_ID_HEADER = "x-telegram-id";

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

/**
 * Outcome of an admin capacity change (A1). `forbidden` maps the API's 403
 * (caller not an admin) so the bot hides the manager action; `belowBooked` maps
 * the 400 the service raises when the requested capacity is under the training's
 * current bookedCount, so the handler can show a distinct guidance message
 * instead of a generic error. The below-booked guard and the open↔full recompute
 * are decided server-side; the bot only renders the result.
 */
export type ChangeCapacityResult =
  | { ok: true; training: Training }
  | { ok: false; reason: "forbidden" | "belowBooked" };

/**
 * Outcome of an admin training cancel (A1). `forbidden` maps the 403 (caller not
 * an admin); `notFound` maps the 404 (no such training); `alreadyCancelled` maps
 * the 409 the service raises for an idempotent re-cancel, so the handler can show
 * a distinct message. The status flip to `cancelled`, the move of booked bookings
 * to `cancelled`, and the client notifications all happen server-side.
 */
export type CancelTrainingResult =
  | { ok: true; training: Training }
  | { ok: false; reason: "forbidden" | "notFound" | "alreadyCancelled" };

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

  /** Admin-only (A1): list trainings in a date range (fill overview). */
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
   * Admin-only (A1): cancel a training. The API gates the caller via
   * ADMIN_TELEGRAM_IDS, flips the training to `cancelled`, moves its still-booked
   * bookings to `cancelled` (never deletes them) and notifies the affected
   * clients — all server-side. A 403 (not an admin) → `forbidden` so the bot can
   * hide the action; a 404 → `notFound`; a 409 (already cancelled) →
   * `alreadyCancelled`. The bot only forwards the id and renders the result.
   */
  async cancelTraining(
    trainingId: string,
    adminTelegramId: number
  ): Promise<CancelTrainingResult> {
    const res = await fetch(`${this.baseUrl}/trainings/${trainingId}/cancel`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-id": String(adminTelegramId)
      },
      body: JSON.stringify({})
    });
    if (res.status === 403) {
      return { ok: false, reason: "forbidden" };
    }
    if (res.status === 404) {
      return { ok: false, reason: "notFound" };
    }
    if (res.status === 409) {
      return { ok: false, reason: "alreadyCancelled" };
    }
    if (!res.ok) {
      throw new Error(`API /trainings/${trainingId}/cancel failed: ${res.status}`);
    }
    return { ok: true, training: trainingSchema.parse(await res.json()) };
  }

  /**
   * Admin-only (A1): change a training's capacity. The API gates the caller via
   * ADMIN_TELEGRAM_IDS, rejects a value below the current bookedCount (400) and
   * recomputes open/full from the new capacity — all server-side. A 403 (not an
   * admin) → `forbidden` so the bot can hide the action; a 400 → `belowBooked`
   * so the handler shows the guidance message. The capacity is re-validated with
   * the shared contract before the request; the bot does no seat math.
   */
  async changeTrainingCapacity(
    trainingId: string,
    capacity: number,
    adminTelegramId: number
  ): Promise<ChangeCapacityResult> {
    const body: ChangeCapacityInput = changeCapacitySchema.parse({ capacity });
    const res = await fetch(`${this.baseUrl}/trainings/${trainingId}/capacity`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-telegram-id": String(adminTelegramId)
      },
      body: JSON.stringify(body)
    });
    if (res.status === 403) {
      return { ok: false, reason: "forbidden" };
    }
    if (res.status === 400) {
      // The service rejects capacity < bookedCount; surfaced distinctly so the bot
      // can guide the manager instead of showing a generic error.
      return { ok: false, reason: "belowBooked" };
    }
    if (!res.ok) {
      throw new Error(`API /trainings/${trainingId}/capacity failed: ${res.status}`);
    }
    return { ok: true, training: trainingSchema.parse(await res.json()) };
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
   *
   * T3.2: an optional `audience` segment (`all`/`level`/`active`/`lapsed`)
   * narrows the recipient set. Absent ⇒ the API defaults to `{ kind: "all" }`
   * (T2.4 behaviour). The bot only forwards the chosen segment; the API resolves
   * it to active clients and reports the exact `recipientsCount`.
   */
  async previewBroadcast(
    type: BroadcastType,
    adminTelegramId: number,
    audience?: BroadcastAudience
  ): Promise<BroadcastPreview | null> {
    const params = new URLSearchParams({ type });
    if (audience) {
      params.set("audience", JSON.stringify(audience));
    }
    const res = await fetch(`${this.baseUrl}/broadcasts/preview?${params.toString()}`, {
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
   *
   * T3.2: an optional `audience` segment narrows the recipient set (absent ⇒ the
   * API defaults to `{ kind: "all" }`, preserving T2.4). The bot only forwards
   * the chosen segment; the API re-resolves it to active clients server-side and
   * records the dispatched count. Admin gating stays in the service.
   */
  async sendBroadcast(
    type: BroadcastType,
    adminTelegramId: number,
    audience?: BroadcastAudience
  ): Promise<Broadcast | null> {
    const res = await fetch(`${this.baseUrl}/broadcasts/send`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-id": String(adminTelegramId)
      },
      body: JSON.stringify(audience ? { type, audience } : { type })
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

  /**
   * C6 — read-only court load grid (confirmed requests + blocks) for one date.
   * Admin-only: the response carries court ids/numbers, so the API gates the read
   * by x-telegram-id (403 for non-admins) before any DB access; the bot only
   * forwards the caller's id and renders the validated grid.
   */
  getCourtLoad(adminId: number, date: string): Promise<CourtLoadGrid> {
    const query = new URLSearchParams({ date }).toString();
    return this.request(`/courts/load?${query}`, courtLoadGridSchema, {
      headers: { [TELEGRAM_ID_HEADER]: String(adminId) }
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
