import { z } from "zod";
import {
  bookingSchema,
  clientSchema,
  courtAvailabilitySchema,
  courtRequestPreviewSchema,
  courtRequestSchema,
  createCourtRequestSchema,
  freeCourtNumbersSchema,
  calendarExportMonthQuerySchema,
  clientTrainingDetailSchema,
  createGroupBookingSchema,
  createSingleBookingSchema,
  createWaitlistEntrySchema,
  groupBookingResultSchema,
  groupMembersSchema,
  groupSchema,
  individualRequestResultSchema,
  individualRequestSchema,
  levelSchema,
  miniappSessionSchema,
  myBookingItemSchema,
  myCourtRequestItemSchema,
  previewCourtRequestSchema,
  singleBookingResultSchema,
  slotCardSchema,
  trainerSchema,
  trainingScheduleSlotSchema,
  trainingParticipantsSchema,
  waitlistAdminItemSchema,
  waitlistEntrySchema,
  type AvailableSlotsQuery,
  type Booking,
  type Client,
  type ClientTrainingDetail,
  type CourtAvailability,
  type CourtDurationHours,
  type CourtRequest,
  type CourtRequestPreview,
  type FreeCourtNumbers,
  type CreateGroupBookingInput,
  type CreateSingleBookingInput,
  type CreateWaitlistInput,
  type Group,
  type GroupBookingResult,
  type GroupMembers,
  type IndividualRequestResult,
  type Level,
  type MiniappMe,
  type MiniappSession,
  type MyBookingItem,
  type MyBookingScope,
  type MyCourtRequestItem,
  type OnboardClientInput,
  type SingleBookingResult,
  type SlotCard,
  type Trainer,
  type TrainingScheduleQuery,
  type TrainingScheduleSlot,
  type TrainingParticipants,
  type WaitlistAdminItem,
  type WaitlistEntry
} from "@beosand/types";
import type { Locale } from "@beosand/i18n";

const levelsSchema = z.array(levelSchema);
const slotCardsSchema = z.array(slotCardSchema);
const trainingScheduleSlotsSchema = z.array(trainingScheduleSlotSchema);
const trainersSchema = z.array(trainerSchema);
const myBookingItemsSchema = z.array(myBookingItemSchema);
const myCourtRequestItemsSchema = z.array(myCourtRequestItemSchema);
const myWaitlistItemsSchema = z.array(waitlistAdminItemSchema);
const groupsSchema = z.array(groupSchema);

/**
 * Thrown when the API rejects the session (401). The ApiClient handles this by
 * re-authenticating once with fresh initData and retrying; if that still 401s it
 * surfaces so a screen can show "open this from Telegram".
 */
export class AuthError extends Error {
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "AuthError";
  }
}

/**
 * Thrown when the API returns 404 for a resource asked for by id — notably a
 * client that hasn't onboarded yet (`GET /clients/by-telegram/:id`). A typed
 * signal so the boot flow can branch to onboarding without sniffing messages.
 */
export class NotFoundError extends Error {
  constructor(message = "Not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

/** Thrown when the API refuses a read/write for the verified caller (403). */
export class ForbiddenError extends Error {
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/**
 * Thrown when the API returns 409 for a write whose precondition no longer holds
 * (e.g. a slot filled meanwhile). Carries the server's message so the screen can
 * show it verbatim and refetch, instead of treating it as a generic failure.
 */
export class ConflictError extends Error {
  constructor(message = "Conflict") {
    super(message);
    this.name = "ConflictError";
  }
}

/**
 * Thin typed client the Mini App uses to reach apps/api. Like the bot and the
 * admin console, the Mini App is an interaction layer only: it never owns domain
 * logic or money/availability math. Every response is validated against a shared
 * @beosand/types contract before the UI renders it.
 *
 * Identity is a verified Mini App session JWT (Telegram `initData` →
 * POST /auth/miniapp, always `scope:"client"`) sent as `Authorization: Bearer
 * <token>`. The token is cached IN MEMORY only — it is re-mintable from `initData`
 * on every launch, so nothing is persisted to storage (and a `scope:"client"`
 * token can never satisfy an admin endpoint server-side).
 */
export class MiniappApiClient {
  private token: string | null = null;
  private identity: MiniappMe | null = null;
  /** The raw initData used to mint the current token, for transparent re-auth on 401. */
  private initDataRaw: string | null = null;
  /** De-dupes concurrent authenticate() calls during boot/retry into one request. */
  private authInFlight: Promise<MiniappSession> | null = null;

  constructor(private readonly baseUrl: string) {}

  /**
   * Exchange a Telegram `initData` string for a client session. Caches the token
   * and identity in memory and remembers the initData so a later 401 can re-mint
   * transparently. Concurrent calls share one in-flight request.
   */
  authenticate(initDataRaw: string): Promise<MiniappSession> {
    this.initDataRaw = initDataRaw;
    if (this.authInFlight) {
      return this.authInFlight;
    }
    const pending = this.postSession(initDataRaw)
      .then((session) => {
        this.token = session.token;
        this.identity = session.user;
        return session;
      })
      .finally(() => {
        this.authInFlight = null;
      });
    this.authInFlight = pending;
    return pending;
  }

  /** POST the initData to mint a session (no auth header — this is the mint step). */
  private async postSession(initDataRaw: string): Promise<MiniappSession> {
    const res = await fetch(`${this.baseUrl}/auth/miniapp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ initData: initDataRaw })
    });
    if (res.status === 401) {
      throw new AuthError("POST /auth/miniapp rejected the initData");
    }
    if (!res.ok) {
      throw await errorFromResponse(res, "/auth/miniapp");
    }
    return miniappSessionSchema.parse(await res.json());
  }

  /** The current session JWT, or null before authenticate() succeeds. */
  getSession(): string | null {
    return this.token;
  }

  /**
   * The signed-in client identity from the verified session (the `user` field of
   * POST /auth/miniapp), or null before authenticate(). There is no client-facing
   * `/auth/me` endpoint — the identity rides the session response, so this is the
   * foundation `getMe()`.
   */
  getMe(): MiniappMe | null {
    return this.identity;
  }

  private async request<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
    const res = await this.fetchWithAuth(path, init);
    if (res.status === 401 && this.initDataRaw) {
      // The session expired/was rejected mid-session: re-mint once from the
      // remembered initData and retry the same call exactly once (no further
      // re-auth on the retry leg, to avoid a loop).
      await this.authenticate(this.initDataRaw);
      return this.handle(await this.fetchWithAuth(path, init), path, schema);
    }
    return this.handle(res, path, schema);
  }

  private async requestText(path: string, init?: RequestInit): Promise<string> {
    const res = await this.fetchWithAuth(path, init);
    if (res.status === 401 && this.initDataRaw) {
      await this.authenticate(this.initDataRaw);
      return this.handleText(await this.fetchWithAuth(path, init), path);
    }
    return this.handleText(res, path);
  }

  /** One authed fetch with the JSON + Bearer headers; the single fetch contract. */
  private fetchWithAuth(path: string, init?: RequestInit): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...this.authHeader(), ...init?.headers }
    });
  }

  /** Map an HTTP response to a typed error or the Zod-parsed body. */
  private async handle<T>(res: Response, path: string, schema: z.ZodType<T>): Promise<T> {
    if (res.status === 401) {
      throw new AuthError(`API ${path} rejected the session`);
    }
    if (res.status === 404) {
      throw new NotFoundError(`API ${path} not found`);
    }
    if (res.status === 403) {
      throw new ForbiddenError(`API ${path} is not visible to this session`);
    }
    if (!res.ok) {
      throw await errorFromResponse(res, path);
    }
    return schema.parse(await res.json());
  }

  private async handleText(res: Response, path: string): Promise<string> {
    if (res.status === 401) {
      throw new AuthError(`API ${path} rejected the session`);
    }
    if (res.status === 404) {
      throw new NotFoundError(`API ${path} not found`);
    }
    if (res.status === 403) {
      throw new ForbiddenError(`API ${path} is not visible to this session`);
    }
    if (!res.ok) {
      throw await errorFromResponse(res, path);
    }
    return res.text();
  }

  /** Bearer header for authed calls; empty before authenticate() (public endpoints). */
  private authHeader(): Record<string, string> {
    return this.token ? { authorization: `Bearer ${this.token}` } : {};
  }

  /**
   * The client record for a Telegram id (GET /clients/by-telegram/:id). A 404
   * surfaces as {@link NotFoundError} — the boot flow reads that as "not onboarded
   * yet" and routes to onboarding. Identity is enforced server-side from the
   * session; the path id is the caller's own.
   */
  getClientByTelegramId(telegramId: number): Promise<Client> {
    return this.request(`/clients/by-telegram/${telegramId}`, clientSchema);
  }

  /** Register the client (POST /clients/onboard); idempotent on telegram_id. */
  onboardClient(input: OnboardClientInput): Promise<Client> {
    return this.request("/clients/onboard", clientSchema, {
      method: "POST",
      body: JSON.stringify(input)
    });
  }

  /**
   * Active levels for the onboarding picker (GET /levels). Client-facing and
   * unauthenticated server-side, but routed through the authed request path so a
   * stale session is transparently re-minted like any other call. The response is
   * validated against the shared level contract before render.
   */
  listLevels(): Promise<Level[]> {
    return this.request("/levels", levelsSchema);
  }

  /**
   * Persist the caller's UI locale (PATCH /clients/by-telegram/:id/language). The
   * server resolves the actor from the verified session and enforces self-only, so
   * the path id is the caller's own; it returns the updated client record, which we
   * validate before render. Idempotent when the locale is unchanged.
   */
  setLanguage(telegramId: number, language: Locale): Promise<Client> {
    return this.request(`/clients/by-telegram/${telegramId}/language`, clientSchema, {
      method: "PATCH",
      body: JSON.stringify({ language })
    });
  }

  /**
   * Bookable slots for the browse screen (GET /trainings/available). The server
   * returns ONLY bookable slots (status `open` with free seats) and owns sort,
   * availability, capacity, and price — the Mini App never computes any of it. The
   * optional filters (date window / level / weekday / time-of-day / trainer) are
   * serialised to a query string, omitting any absent field; the response is
   * validated against the shared slot-card contract before render.
   */
  listAvailableSlots(query: AvailableSlotsQuery): Promise<SlotCard[]> {
    return this.request(`/trainings/available${toQueryString(query)}`, slotCardsSchema);
  }

  /**
   * Visible group schedule for the browse/calendar surface (GET /trainings/schedule).
   * Unlike /available, the server may include full rows with `bookable=false`; the
   * Mini App still calls the same booking endpoint and lets the API return the
   * waitlisted result for a full group session.
   */
  listTrainingSchedule(query: TrainingScheduleQuery): Promise<TrainingScheduleSlot[]> {
    return this.request(
      `/trainings/schedule${toQueryString(query)}`,
      trainingScheduleSlotsSchema
    );
  }

  /**
   * Trainers for the browse filter picker (GET /trainers), validated against the
   * shared trainer contract. Client-facing reference data, routed through the authed
   * request path so a stale session re-mints transparently like any other call.
   */
  listTrainers(): Promise<Trainer[]> {
    return this.request("/trainers", trainersSchema);
  }

  /**
   * Trainers for the individual-training picker (GET /trainers?scope=individual).
   * This intentionally does not change the default /trainers reference read used by
   * group filters and browse screens.
   */
  listIndividualTrainers(): Promise<Trainer[]> {
    return this.request("/trainers?scope=individual", trainersSchema);
  }

  /**
   * Request a one-on-one training with a trainer (POST /trainers/:id/individual-request).
   * Notification-only: the unchanged route/result lets the server own
   * trainer-first delivery through `trainer.telegramId`, with admin/manager
   * fallback when the trainer cannot be reached. `trainerUsername` alone is not a
   * DM target, and no booking is persisted. The body still carries the caller's
   * OWN Telegram id (from the verified session via {@link getMe}) for
   * bot back-compat, but the server now authoritatively resolves the requester from the
   * verified Mini App session and REJECTS a mismatch (no impersonation) — the body id is
   * never trusted as identity. The response is the {@link IndividualRequestResult}, validated
   * before render: `delivered:true` is success, `delivered:false`
   * (reason `trainer-unavailable`) is a calm 200 informational state, NOT an error.
   */
  requestIndividualSession(input: IndividualSessionRequestInput): Promise<IndividualRequestResult> {
    const telegramId = this.identity?.telegramId;
    if (telegramId == null) {
      return Promise.reject(new AuthError("No verified Telegram identity to request a trainer"));
    }
    const { trainerId, date, startTime, endTime } = input;
    return this.request(
      `/trainers/${trainerId}/individual-request`,
      individualRequestResultSchema,
      {
        method: "POST",
        body: JSON.stringify(individualRequestSchema.parse({ telegramId, date, startTime, endTime }))
      }
    );
  }

  /**
   * Book a single training (POST /bookings/single). The body is validated against
   * the shared contract before send; the `clientId` is the caller's own resolved
   * Client id (never a client-asserted value — the server re-checks ownership from
   * the verified session). The response is the created booking, validated before
   * use. A 409 (slot filled meanwhile) surfaces as {@link ConflictError} so the
   * screen can show the server message verbatim and refetch the list.
   */
  createSingleBooking(input: CreateSingleBookingInput): Promise<SingleBookingResult> {
    return this.request("/bookings/single", singleBookingResultSchema, {
      method: "POST",
      body: JSON.stringify(createSingleBookingSchema.parse(input))
    });
  }

  /**
   * Join a training's waitlist (POST /waitlist). The body is validated against the
   * shared contract before send; `clientId` is the caller's own resolved Client id
   * (never a client-asserted value — the server re-checks ownership, eligibility, and
   * the slot's full state from the verified session). The response is the created
   * {@link WaitlistEntry} (incl. the server-assigned `position`), validated before
   * use. A 409 surfaces as {@link ConflictError} — the slot became bookable again or
   * the caller is already on the list — so the screen shows the server message verbatim.
   */
  joinWaitlist(input: CreateWaitlistInput): Promise<WaitlistEntry> {
    return this.request("/waitlist", waitlistEntrySchema, {
      method: "POST",
      body: JSON.stringify(createWaitlistEntrySchema.parse(input))
    });
  }

  /**
   * The caller's own bookings for one scope (GET /bookings/mine). `clientId` is the
   * caller's resolved Client id (never a client-asserted value — the server re-checks
   * ownership from the verified session) and `scope` selects upcoming vs past; both
   * ride the query string. The server owns the split, the per-item `canCancel` flag,
   * and the outcome — the Mini App does no date/status math. The response is validated
   * against the shared {@link myBookingItemSchema} array contract before render.
   */
  listMyBookings(clientId: string, scope: MyBookingScope): Promise<MyBookingItem[]> {
    const qs = new URLSearchParams({ clientId, scope }).toString();
    return this.request(`/bookings/mine?${qs}`, myBookingItemsSchema);
  }

  /**
   * Client-scoped detail for one visible training (GET /trainings/:id/client-detail).
   * The API owns relation, cancelability, export eligibility, court visibility, and
   * privacy-narrowed roster rows; the Mini App only validates and renders.
   */
  getClientTrainingDetail(trainingId: string): Promise<ClientTrainingDetail> {
    return this.request(
      `/trainings/${trainingId}/client-detail`,
      clientTrainingDetailSchema
    );
  }

  /**
   * Text/calendar export for the caller's own booked trainings in one month. The
   * query is validated by the shared contract before send; the response is an ICS
   * payload, not JSON, so callers hand it to a browser download/navigation path.
   */
  async exportMyBookingsCalendar(year: number, month: number): Promise<string> {
    const query = calendarExportMonthQuerySchema.parse({ year, month });
    const qs = new URLSearchParams({
      year: String(query.year),
      month: String(query.month)
    }).toString();
    return this.requestText(`/bookings/mine/calendar-export?${qs}`);
  }

  /**
   * The caller's own active waitlist entries (GET /waitlist/mine) — the `waiting`
   * and `notified` dates they are queued on, each with its server-assigned position.
   * Identity is resolved server-side from the verified session exactly like
   * {@link listMyBookings} (no clientId in the call). The response is validated against
   * the shared {@link waitlistAdminItemSchema} array contract before render; the joined
   * date/time/group fields are display-only and the Mini App does no queue math.
   */
  getMyWaitlist(): Promise<WaitlistAdminItem[]> {
    return this.request("/waitlist/mine", myWaitlistItemsSchema);
  }

  /**
   * Cancel one of the caller's bookings (POST /bookings/:id/cancel; no body). The
   * server enforces ownership from the verified session, recomputes the training's
   * capacity (`full → open`), and keeps a monthly batch's sibling bookings intact —
   * the Mini App only calls and re-renders. The response is the updated
   * {@link Booking}, validated before use. A 409 (already cancelled / no longer
   * cancellable) surfaces as {@link ConflictError} so the screen shows the server
   * message verbatim and refetches; a 403 (not the owner) surfaces as a generic error.
   */
  cancelBooking(bookingId: string): Promise<Booking> {
    return this.request(`/bookings/${bookingId}/cancel`, bookingSchema, {
      method: "POST"
    });
  }

  /**
   * Active groups for the monthly-subscription picker (GET /groups), validated
   * against the shared group contract. Each group carries its recurring schedule
   * (days/times), trainer name, level, capacity, and the server-computed RSD prices
   * — the Mini App displays them and never computes a price or which dates exist.
   * Client-facing reference data, routed through the authed request path so a stale
   * session re-mints transparently like any other call.
   */
  listGroups(): Promise<Group[]> {
    return this.request("/groups", groupsSchema);
  }

  /**
   * The roster of a group for one month (GET /groups/:id/members?year&month) —
   * "who signed up". Sent with the client Bearer token like every authed call; the
   * API bridges the session to `x-client-telegram-id`, so a Mini App caller receives
   * the CLIENT-NARROWED shape: only `firstName` + `avatarInitial` per member plus the
   * `memberCount` — never another client's `clientId` or `fullName`. The response is
   * validated against the shared {@link GroupMembers} contract before render; the
   * Mini App does no counting or identity math, it just shows what the server returned.
   */
  getGroupMembers(groupId: string, year: number, month: number): Promise<GroupMembers> {
    const qs = new URLSearchParams({ year: String(year), month: String(month) }).toString();
    return this.request(`/groups/${groupId}/members?${qs}`, groupMembersSchema);
  }

  /**
   * The participants of a single training (GET /trainings/:id/participants) — "кто
   * записан" for one slot, the per-training counterpart to {@link getGroupMembers}.
   * Sent with the client Bearer token like every authed call; the API bridges the
   * session to `x-client-telegram-id`, so a Mini App caller receives the
   * CLIENT-NARROWED shape: only `firstName` + `avatarInitial` per participant plus the
   * `participantCount` — never another client's `clientId` or `fullName`, and never a
   * cancelled/waitlisted entry. Validated against the shared
   * {@link TrainingParticipants} contract before render; the Mini App does no counting.
   */
  getTrainingParticipants(trainingId: string): Promise<TrainingParticipants> {
    return this.request(`/trainings/${trainingId}/participants`, trainingParticipantsSchema);
  }

  /**
   * Subscribe the caller to a group for a whole month (POST /bookings/group). The
   * body is validated against the shared contract before send; `clientId` is the
   * caller's OWN resolved Client id (never a client-asserted value — the server
   * re-checks ownership from the verified session) and `year`/`month` are the two
   * display-only picker ints. The SERVER computes the month's training instances,
   * the prices, capacity, and which dates are skipped (full) — the Mini App does no
   * date or money math. The response is the {@link GroupBookingResult} (the shared
   * subscription id, the bookings created one-per-instance, and the skipped dates),
   * validated before render. A 409 (invalid month / inactive group / mismatched
   * client) surfaces as {@link ConflictError} so the screen shows the server message
   * verbatim and offers a retry, never a fabricated success.
   */
  createGroupBooking(input: CreateGroupBookingInput): Promise<GroupBookingResult> {
    return this.request("/bookings/group", groupBookingResultSchema, {
      method: "POST",
      body: JSON.stringify(createGroupBookingSchema.parse(input))
    });
  }

  /**
   * Offerable court start times for a single date (GET /court-requests/availability).
   * Public reference data, routed through the authed request path so a stale session
   * re-mints transparently. The server returns ONLY offerable 30-min starts, each with
   * a free-court COUNT (`freeCourts`) — NEVER a court id/number, and with the
   * 6-courts-per-hour limit already applied. The Mini App renders the slots verbatim:
   * it never filters, computes availability, or offers a time the server didn't return.
   * The response is validated against the shared availability contract before render.
   */
  getCourtAvailability(date: string): Promise<CourtAvailability> {
    const qs = new URLSearchParams({ date }).toString();
    return this.request(`/court-requests/availability?${qs}`, courtAvailabilitySchema);
  }

  /**
   * The SPECIFIC courts free for a desired slot (GET /court-requests/free-courts), so
   * the Mini App can render a court picker (Edition 2.1 lets the client choose courts).
   * Unlike the count-only availability read, this returns the free court NUMBERS. The
   * caller's identity rides the Bearer session like every authed GET — the API bridges
   * it to `x-client-telegram-id` server-side — so no identity is sent in the query. The
   * response is validated against the shared {@link FreeCourtNumbers} contract before
   * the picker renders it; only the returned numbers are selectable.
   */
  getFreeCourtNumbers(slot: CourtRequestInput): Promise<FreeCourtNumbers> {
    const qs = new URLSearchParams({
      date: slot.date,
      startTime: slot.startTime,
      durationHours: String(slot.durationHours)
    }).toString();
    return this.request(`/court-requests/free-courts?${qs}`, freeCourtNumbersSchema);
  }

  /**
   * Price + availability preview for a desired court slot (POST /court-requests/preview).
   * The body still carries the caller's OWN Telegram id (from the verified session via
   * {@link getMe}) for bot back-compat, but the server now authoritatively resolves the
   * requester from the verified Mini App session and REJECTS a mismatch — the body id is
   * never trusted as identity. The client NEVER sends or computes a price; the response's
   * `priceRsd` is the SERVER's authoritative price, validated against the shared contract
   * before display. The response carries NO court id (the client never sees a court).
   */
  previewCourtRequest(input: CourtRequestInput): Promise<CourtRequestPreview> {
    const telegramId = this.identity?.telegramId;
    if (telegramId == null) {
      return Promise.reject(new AuthError("No verified Telegram identity to preview a court request"));
    }
    return this.request("/court-requests/preview", courtRequestPreviewSchema, {
      method: "POST",
      body: JSON.stringify(previewCourtRequestSchema.parse({ telegramId, ...input }))
    });
  }

  /**
   * Submit a court-rental request (POST /court-requests). Like the preview, the body
   * carries the caller's OWN Telegram id (verified session via {@link getMe}) for bot
   * back-compat; the server re-derives the requester from the session and rejects a
   * mismatch. The created {@link CourtRequest} is `pending` with NO court assigned
   * (`courtId` is null — the client never sees/chooses a court) and the SERVER's price;
   * the response is validated against the shared contract before render. A 409 (the slot
   * filled meanwhile) surfaces as {@link ConflictError} so the screen shows the server
   * message verbatim and offers another time.
   */
  createCourtRequest(input: CourtRequestInput): Promise<CourtRequest> {
    const telegramId = this.identity?.telegramId;
    if (telegramId == null) {
      return Promise.reject(new AuthError("No verified Telegram identity to submit a court request"));
    }
    return this.request("/court-requests", courtRequestSchema, {
      method: "POST",
      body: JSON.stringify(createCourtRequestSchema.parse({ telegramId, ...input }))
    });
  }

  /**
   * The caller's own court requests (GET /court-requests/mine), for the in-app
   * calendar. Client-scoped exactly like {@link listMyBookings}: the server resolves
   * the requester from the verified session and returns only their own requests. The
   * response is validated against the shared {@link myCourtRequestItemSchema} array
   * contract before render — and that contract carries NO court id/number, so the
   * Mini App can never display which court was assigned, even after confirmation.
   */
  listMyCourtRequests(): Promise<MyCourtRequestItem[]> {
    return this.request("/court-requests/mine", myCourtRequestItemsSchema);
  }

}

/**
 * The caller's chosen court slot: a date, a 30-min-aligned start, a duration, and the
 * specific courts the client picked. The telegramId is NOT part of this input — the
 * ApiClient supplies the caller's OWN id from the verified session, never user input.
 * `courtNumbers` carries the picked courts (the price scales by their count); it is
 * omitted on the legacy single-court path where the admin assigns the court.
 */
export interface CourtRequestInput {
  date: string;
  startTime: string;
  durationHours: CourtDurationHours;
  /** The specific courts the client picked (1…6). Omitted = single-court bot path. */
  courtNumbers?: number[];
}

/** The proposed one-on-one slot; the ApiClient supplies telegramId from the session. */
export interface IndividualSessionRequestInput {
  trainerId: string;
  date: string;
  startTime: string;
  endTime: string;
}

/**
 * Serialise an {@link AvailableSlotsQuery} to a `?key=value` string, omitting any
 * absent (`undefined`) field so the API owns the default window. Numbers (weekday)
 * are stringified; the server re-validates and coerces every value. Returns an
 * empty string when no filter is set.
 */
function toQueryString(query: AvailableSlotsQuery | TrainingScheduleQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) {
      params.set(key, String(value));
    }
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/**
 * Build a typed error from a failed (non-2xx) response, preferring the server's
 * human-readable message over a status code. NestJS exceptions serialize as
 * `{ statusCode, message, error }`, where `message` is a string or string[]. A
 * 409 becomes a {@link ConflictError} the UI can branch on; any other status
 * stays a generic Error.
 */
async function errorFromResponse(res: Response, path: string): Promise<Error> {
  const message = await readErrorMessage(res, `API ${path} failed: ${res.status}`);
  return res.status === 409 ? new ConflictError(message) : new Error(message);
}

/** Extract a NestJS `{ message }` (string or string[]) from a body, or fall back. */
async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body: unknown = await res.json();
    if (body && typeof body === "object" && "message" in body) {
      const message = (body as { message: unknown }).message;
      if (typeof message === "string" && message.length > 0) {
        return message;
      }
      if (Array.isArray(message) && message.length > 0) {
        return message.join("; ");
      }
    }
  } catch {
    // Non-JSON body (e.g. a proxy/HTML error page): use the status fallback.
  }
  return fallback;
}

/** Resolve the API base URL from browser env, defaulting to local dev. */
export function createMiniappApiClient(): MiniappApiClient {
  return new MiniappApiClient(import.meta.env.VITE_API_URL ?? "http://localhost:3000");
}
