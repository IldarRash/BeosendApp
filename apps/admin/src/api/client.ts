import { z } from "zod";
import {
  adminMeSchema,
  adminSessionSchema,
  labelCatalogSchema,
  labelEntrySchema,
  analyticsSummarySchema,
  bookingSchema,
  broadcastEffectivenessSchema,
  broadcastPreviewSchema,
  broadcastSchema,
  cancellationStatsSchema,
  clientActivitySchema,
  clientSchema,
  courtBlockSchema,
  courtLoadGridSchema,
  generateAllResultSchema,
  generationStatusItemSchema,
  groupMembersSchema,
  transferGroupResultSchema,
  courtRequestAdminViewSchema,
  courtRequestSchema,
  courtSchema,
  fillRateSchema,
  groupSchema,
  levelSchema,
  noShowStatsSchema,
  notificationTemplateSchema,
  popularSlotSchema,
  subscriptionSummarySchema,
  trainerLoadSchema,
  trainerSchema,
  trainingCalendarItemSchema,
  trainingRosterSchema,
  trainingSchema,
  type AdminMe,
  type AdminSession,
  type AnalyticsRangeQuery,
  type AnalyticsSummary,
  type AssignCourtInput,
  type Booking,
  type Broadcast,
  type BroadcastAudience,
  type BroadcastEffectiveness,
  type BroadcastPreview,
  type BroadcastType,
  type CancellationStats,
  type ClientActivity,
  type Client,
  type Court,
  type CourtBlock,
  type CourtLoadGrid,
  type CourtRequest,
  type CourtRequestAdminView,
  type CourtRequestStatus,
  type CreateCourtBlock,
  type CreateGroupInput,
  type CreateTrainerInput,
  type ChangeCapacityInput,
  type CreateSingleBookingInput,
  type CreateWalkInInput,
  type FillRate,
  type GenerateAllMonthInput,
  type GenerateAllResult,
  type GenerateMonthInput,
  type GenerationStatusItem,
  type GenerationStatusQuery,
  type Group,
  type GroupMembers,
  type LabelCatalog,
  type LabelEntry,
  type Level,
  type ListClientsQuery,
  type ListSubscriptionsQuery,
  type ListTrainingsQuery,
  type Locale,
  type UpdateLabelInput,
  type MarkAttendanceInput,
  type NoShowStats,
  type NotificationTemplate,
  type NotificationTemplateKey,
  type OnboardClientInput,
  type PopularSlot,
  type SendBroadcastInput,
  type SubscriptionSummary,
  type TelegramLoginPayload,
  type Trainer,
  type TrainerLoad,
  type Training,
  type TrainingCalendarItem,
  type TrainingRoster,
  type TransferGroupInput,
  type TransferGroupResult,
  type UpdateGroupInput,
  type UpdateLevelInput,
  type UpdateTrainerInput
} from "@beosand/types";

const healthSchema = z.object({ status: z.literal("ok"), service: z.string() });
const labelEntriesSchema = z.array(labelEntrySchema);
const courtBlocksSchema = z.array(courtBlockSchema);
const courtRequestsSchema = z.array(courtRequestAdminViewSchema);
const courtsSchema = z.array(courtSchema);
const clientsSchema = z.array(clientSchema);
const levelsSchema = z.array(levelSchema);
const trainersSchema = z.array(trainerSchema);
const groupsSchema = z.array(groupSchema);
const trainingsSchema = z.array(trainingSchema);
const trainingCalendarSchema = z.array(trainingCalendarItemSchema);
const popularSlotsSchema = z.array(popularSlotSchema);
const trainerLoadListSchema = z.array(trainerLoadSchema);
const generationStatusSchema = z.array(generationStatusItemSchema);
const subscriptionsSchema = z.array(subscriptionSummarySchema);
const notificationTemplatesSchema = z.array(notificationTemplateSchema);

/** Input for creating a level — just the name (schema is server-validated). */
export interface CreateLevelInput {
  name: string;
}

export type Health = z.infer<typeof healthSchema>;

const SESSION_STORAGE_KEY = "beosand.admin.session";

/**
 * Thrown when the API rejects the session (401). The app catches this to clear
 * the stored token and redirect to /login — a typed signal, not a generic Error.
 */
export class AuthError extends Error {
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "AuthError";
  }
}

/**
 * Thrown when the API returns 404 for a resource the caller asked for by id. A
 * typed signal so a screen can branch on "not found" without sniffing message
 * strings, raised by the shared `request<T>` for any 404.
 */
export class NotFoundError extends Error {
  constructor(message = "Not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

/**
 * Thrown when the API returns 409 for a write whose precondition no longer holds
 * — e.g. confirming a court request another admin (or the bot) already decided.
 * Carries the server's human-readable message so the screen can show it verbatim
 * and react (refetch the now-stale queue, close the modal) instead of treating it
 * as a generic failure. A 409 is expected here, not a bug: the API owns the check.
 */
export class ConflictError extends Error {
  constructor(message = "Conflict") {
    super(message);
    this.name = "ConflictError";
  }
}

/**
 * Thin typed client the admin SPA uses to reach apps/api. The console is an
 * interaction layer only: it never owns domain logic or money/availability math.
 * Every response is validated against a shared @beosand/types contract before the
 * UI renders it.
 *
 * Identity is a verified session JWT (Telegram Login Widget → POST /auth/telegram)
 * sent as `Authorization: Bearer <token>`. The interim `x-telegram-id` header used
 * by the bot is never sent from the browser. A 401 surfaces as {@link AuthError}.
 */
export class ApiClient {
  private token: string | null = null;

  constructor(private readonly baseUrl: string) {
    this.token = readStoredSession();
  }

  /** Store the session JWT (in-memory + sessionStorage) after a successful login. */
  setSession(token: string): void {
    this.token = token;
    try {
      sessionStorage.setItem(SESSION_STORAGE_KEY, token);
    } catch {
      // sessionStorage may be unavailable (private mode); in-memory token still works.
    }
  }

  /** Forget the session (logout, or after a 401). */
  clearSession(): void {
    this.token = null;
    try {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
    } catch {
      // Ignore: nothing to clear if storage is unavailable.
    }
  }

  /** The current session JWT, or null when logged out. */
  getSession(): string | null {
    return this.token;
  }

  private async request<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...this.authHeader(), ...init?.headers }
    });
    if (res.status === 401) {
      throw new AuthError(`API ${path} rejected the session`);
    }
    if (res.status === 404) {
      throw new NotFoundError(`API ${path} not found`);
    }
    if (!res.ok) {
      throw await errorFromResponse(res, path);
    }
    return schema.parse(await res.json());
  }

  /** Bearer header for authed calls; empty when logged out (public endpoints). */
  private authHeader(): Record<string, string> {
    return this.token ? { authorization: `Bearer ${this.token}` } : {};
  }

  health(): Promise<Health> {
    return this.request("/health", healthSchema);
  }

  /** Exchange a Telegram Login Widget payload for a verified admin session. */
  loginWithTelegram(payload: TelegramLoginPayload): Promise<AdminSession> {
    return this.request("/auth/telegram", adminSessionSchema, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  /** Resolve the logged-in admin identity for the current session. */
  me(): Promise<AdminMe> {
    return this.request("/auth/me", adminMeSchema);
  }

  /** Headline dashboard figures (read-only; range defaults server-side to 30 days). */
  analyticsSummary(): Promise<AnalyticsSummary> {
    return this.request("/analytics/summary", analyticsSummarySchema);
  }

  /** C5 — admin blocks a court for a 30-min-aligned time range. */
  createCourtBlock(input: CreateCourtBlock): Promise<CourtBlock> {
    return this.request("/court-blocks", courtBlockSchema, {
      method: "POST",
      body: JSON.stringify(input)
    });
  }

  /**
   * C5/C6 — admin lists court blocks over an inclusive date range
   * (GET /court-blocks?from=…&to=…, both `yyyy-mm-dd`). A single day is the
   * `from === to` case. Each row is validated against `courtBlockSchema`.
   */
  listCourtBlocks(range: { from: string; to: string }): Promise<CourtBlock[]> {
    const query = new URLSearchParams({ from: range.from, to: range.to }).toString();
    return this.request(`/court-blocks?${query}`, courtBlocksSchema);
  }

  /** C5 — admin removes a block, restoring availability (204, no body). */
  async deleteCourtBlock(id: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/court-blocks/${id}`, {
      method: "DELETE",
      headers: this.authHeader()
    });
    if (res.status === 401) {
      throw new AuthError(`API /court-blocks/${id} rejected the session`);
    }
    if (!res.ok) {
      throw await errorFromResponse(res, `/court-blocks/${id}`);
    }
  }

  /**
   * Move a block to another court (PATCH /court-blocks/:id, body `{ courtId }`).
   * Used primarily for group auto-blocks (non-null `groupTrainingId`). The server
   * re-checks per-court overlap and the 6-per-30-min limit on the target court for
   * the block's own slots and rejects (409) a clash — the client computes nothing.
   */
  reassignCourtBlock(id: string, courtId: string): Promise<CourtBlock> {
    return this.request(`/court-blocks/${id}`, courtBlockSchema, {
      method: "PATCH",
      body: JSON.stringify({ courtId })
    });
  }

  // ── Court requests & courts (M3) ──────────────────────────────────────────

  /**
   * C4 — admin moderation queue for one status (GET /court-requests?status=…),
   * joined with the client's name/telegram. This admin-only view carries a
   * `courtId`, populated only for confirmed requests; a pending row's `courtId`
   * is null (the screen must render "—", never a court number).
   */
  listCourtRequests(status: CourtRequestStatus): Promise<CourtRequestAdminView[]> {
    const query = new URLSearchParams({ status }).toString();
    return this.request(`/court-requests?${query}`, courtRequestsSchema);
  }

  /**
   * Admin-only detail for one request (GET /court-requests/:id), joined with the
   * client's name/telegram and the derived end time. Backs the court-load grid's
   * "who booked this court/hour?" popup. Carries a `courtId` (admin path only).
   */
  courtRequestDetail(id: string): Promise<CourtRequestAdminView> {
    return this.request(`/court-requests/${id}`, courtRequestAdminViewSchema);
  }

  /**
   * C4 — the active courts free for *every* 30-min slot the request covers (GET
   * /court-requests/:id/free-courts). The server owns the per-slot/6-per-court
   * math; the picker only offers what this returns and never computes its own.
   */
  freeCourtsForRequest(id: string): Promise<Court[]> {
    return this.request(`/court-requests/${id}/free-courts`, courtsSchema);
  }

  /**
   * C4 — confirm a pending request onto a chosen court (POST
   * /court-requests/:id/confirm). Body is { requestId, courtId, decidedBy };
   * `requestId` is fixed to the path id here. The server atomically re-checks
   * freeness — a slot filled meanwhile surfaces as a thrown Error (409).
   */
  confirmRequest(id: string, input: { courtId: string; decidedBy: number }): Promise<CourtRequest> {
    return this.request(`/court-requests/${id}/confirm`, courtRequestSchema, {
      method: "POST",
      body: JSON.stringify({ requestId: id, courtId: input.courtId, decidedBy: input.decidedBy })
    });
  }

  /**
   * C4 — reject a pending request (POST /court-requests/:id/reject). Body is
   * { requestId, decidedBy }; the server stamps decided_* and notifies the client.
   */
  rejectRequest(id: string, input: { decidedBy: number }): Promise<CourtRequest> {
    return this.request(`/court-requests/${id}/reject`, courtRequestSchema, {
      method: "POST",
      body: JSON.stringify({ requestId: id, decidedBy: input.decidedBy })
    });
  }

  /** C6 — active courts (GET /courts): id, number, status. Admin-only server-side. */
  listCourts(): Promise<Court[]> {
    return this.request("/courts", courtsSchema);
  }

  /**
   * C6 — per-day court load grid (GET /courts/load?date=YYYY-MM-DD): courts ×
   * 30-minute-slot cells, each free | request | block. Admin-only; carries court
   * numbers (never a client path).
   */
  courtLoad(date: string): Promise<CourtLoadGrid> {
    const query = new URLSearchParams({ date }).toString();
    return this.request(`/courts/load?${query}`, courtLoadGridSchema);
  }

  /**
   * Assign a court to an unassigned training (POST /trainings/:id/assign-court,
   * body `{ courtId }`). The server reuses the 6-per-30-min guard and re-checks the
   * chosen court is free for every slot the training covers — the console offers a
   * court but computes no availability. A clash surfaces as a thrown Error (409).
   * Admin-only; returns the updated training the grid then re-renders.
   */
  assignCourt(trainingId: string, courtId: string): Promise<Training> {
    const input: AssignCourtInput = { courtId };
    return this.request(`/trainings/${trainingId}/assign-court`, trainingSchema, {
      method: "POST",
      body: JSON.stringify(input)
    });
  }

  // ── Levels (M1) ────────────────────────────────────────────────────────

  /** Active training levels. */
  listLevels(): Promise<Level[]> {
    return this.request("/levels", levelsSchema);
  }

  /** Create a level (server validates + decides status). */
  createLevel(input: CreateLevelInput): Promise<Level> {
    return this.request("/levels", levelSchema, {
      method: "POST",
      body: JSON.stringify(input)
    });
  }

  /** Rename / (de)activate a level. */
  updateLevel(id: string, input: UpdateLevelInput): Promise<Level> {
    return this.request(`/levels/${id}`, levelSchema, {
      method: "PATCH",
      body: JSON.stringify(input)
    });
  }

  // ── Trainers (M1) ──────────────────────────────────────────────────────

  /** Active trainers. */
  listTrainers(): Promise<Trainer[]> {
    return this.request("/trainers", trainersSchema);
  }

  /** Create a trainer (optionally linking a Telegram id). */
  createTrainer(input: CreateTrainerInput): Promise<Trainer> {
    return this.request("/trainers", trainerSchema, {
      method: "POST",
      body: JSON.stringify(input)
    });
  }

  /** Edit a trainer (name/type/status/telegramId). */
  updateTrainer(id: string, input: UpdateTrainerInput): Promise<Trainer> {
    return this.request(`/trainers/${id}`, trainerSchema, {
      method: "PATCH",
      body: JSON.stringify(input)
    });
  }

  // ── Groups (M1) ────────────────────────────────────────────────────────

  /** Active groups (recurring training slots). */
  listGroups(): Promise<Group[]> {
    return this.request("/groups", groupsSchema);
  }

  /** Create a group (server validates time order, prices, capacity). */
  createGroup(input: CreateGroupInput): Promise<Group> {
    return this.request("/groups", groupSchema, {
      method: "POST",
      body: JSON.stringify(input)
    });
  }

  /** Edit a group (any subset of its fields). */
  updateGroup(id: string, input: UpdateGroupInput): Promise<Group> {
    return this.request(`/groups/${id}`, groupSchema, {
      method: "PATCH",
      body: JSON.stringify(input)
    });
  }

  /**
   * Soft-delete a group (DELETE /groups/:id): the server sets it inactive, cancels
   * its future trainings and notifies their booked members — all server-side, the
   * console computes nothing. Admin-only; returns the now-inactive group. After
   * success the groups list (active only) no longer carries it.
   */
  deleteGroup(id: string): Promise<Group> {
    return this.request(`/groups/${id}`, groupSchema, { method: "DELETE" });
  }

  /**
   * A group's distinct members for a month (GET /groups/:id/members?year&month).
   * The admin session (Bearer) gets the full shape — each member's `clientId` and
   * `fullName` — which the transfer flow needs; a client caller would receive only
   * first name + avatar initial. The server owns who is a member; the console only
   * renders the validated result.
   */
  getGroupMembers(groupId: string, year: number, month: number): Promise<GroupMembers> {
    const query = new URLSearchParams({ year: String(year), month: String(month) }).toString();
    return this.request(`/groups/${groupId}/members?${query}`, groupMembersSchema);
  }

  // ── Trainings (M1) ─────────────────────────────────────────────────────

  /**
   * Generate one training per group weekday across a month (15.1). The optional
   * `courtId` (sent only when chosen) is the preferred court for this group's auto
   * court blocks; the server falls back per date if it is not free.
   */
  generateMonth(input: GenerateMonthInput): Promise<Training[]> {
    return this.request("/trainings/generate", trainingsSchema, {
      method: "POST",
      body: JSON.stringify(input)
    });
  }

  /**
   * Feature 3 — generate the month for every active group at once (POST
   * /trainings/generate-all). Returns a per-group summary (created / blocked /
   * skipped); auto-blocks pick a court per date server-side. Admin-only.
   */
  generateAllGroups(input: GenerateAllMonthInput): Promise<GenerateAllResult> {
    return this.request("/trainings/generate-all", generateAllResultSchema, {
      method: "POST",
      body: JSON.stringify(input)
    });
  }

  /**
   * Per-group month generation coverage (GET /trainings/generation-status?year&month).
   * For the chosen year/month each item reports how many future training dates the
   * group's weekdays imply (`expected`), how many already exist (`existing`), and
   * whether the month is already fully generated (`fullyGenerated`). The console uses
   * it to mark already-generated groups in the generate-month modal; it computes no
   * generation math itself. Admin-only server-side.
   */
  generationStatus(query: GenerationStatusQuery): Promise<GenerationStatusItem[]> {
    const params = new URLSearchParams({ year: String(query.year), month: String(query.month) });
    return this.request(`/trainings/generation-status?${params.toString()}`, generationStatusSchema);
  }

  /** Admin trainings list for a date range, optionally filtered to one group. */
  listTrainings(query: ListTrainingsQuery): Promise<Training[]> {
    const params = new URLSearchParams({ from: query.from, to: query.to });
    if (query.groupId) {
      params.set("groupId", query.groupId);
    }
    return this.request(`/trainings?${params.toString()}`, trainingsSchema);
  }

  /**
   * Calendar view of generated trainings for a date range (GET
   * /trainings/calendar?from&to&groupId?&trainerId?). Each item carries the
   * training plus joined group/trainer display names and the auto-block court
   * number (null when there's no group / no block). Admin-only server-side; the
   * console only renders the validated, server-decided values.
   */
  trainingsCalendar(query: ListTrainingsQuery): Promise<TrainingCalendarItem[]> {
    const params = new URLSearchParams({ from: query.from, to: query.to });
    if (query.groupId) {
      params.set("groupId", query.groupId);
    }
    if (query.trainerId) {
      params.set("trainerId", query.trainerId);
    }
    return this.request(`/trainings/calendar?${params.toString()}`, trainingCalendarSchema);
  }

  /**
   * Calendar detail for one training (GET /trainings/:id/detail) — the same
   * joined view as a calendar item, backing the "whose training?" popup. Admin
   * carries the court number; occupancy/status are the server's, never recomputed.
   */
  trainingDetail(id: string): Promise<TrainingCalendarItem> {
    return this.request(`/trainings/${id}/detail`, trainingCalendarItemSchema);
  }

  /** Cancel a training (server notifies booked clients). */
  cancelTraining(id: string): Promise<Training> {
    return this.request(`/trainings/${id}/cancel`, trainingSchema, {
      method: "POST",
      body: JSON.stringify({})
    });
  }

  /** Change a training's capacity (server rejects below booked, recomputes status). */
  changeCapacity(id: string, input: ChangeCapacityInput): Promise<Training> {
    return this.request(`/trainings/${id}/capacity`, trainingSchema, {
      method: "PATCH",
      body: JSON.stringify(input)
    });
  }

  // ── Roster & attendance (M2) ──────────────────────────────────────────────

  /**
   * A training's roster (GET /trainings/:id/roster) — session header plus its
   * booked participants. Server excludes cancelled/waitlist and enforces the
   * trainer/admin gate; the SPA only renders the validated result.
   */
  getRoster(trainingId: string): Promise<TrainingRoster> {
    return this.request(`/trainings/${trainingId}/roster`, trainingRosterSchema);
  }

  /**
   * Mark one booking attended/no_show (POST /bookings/:id/attendance). The server
   * decides whether the training is markable (past/today) and recomputes nothing
   * client-side; we return the updated booking it validated.
   */
  markAttendance(bookingId: string, input: MarkAttendanceInput): Promise<Booking> {
    return this.request(`/bookings/${bookingId}/attendance`, bookingSchema, {
      method: "POST",
      body: JSON.stringify(input)
    });
  }

  // ── Clients (M2) ──────────────────────────────────────────────────────────

  /**
   * Admin clients list (GET /clients), optionally filtered by a name/@username
   * `search` and `status`. The server owns the admin gate, search normalization
   * (a leading "@" is dropped), and ordering; the SPA only renders the validated
   * rows and never filters domain data itself.
   */
  listClients(query?: ListClientsQuery): Promise<Client[]> {
    const params = new URLSearchParams();
    if (query?.search) {
      params.set("search", query.search);
    }
    if (query?.status) {
      params.set("status", query.status);
    }
    const qs = params.toString();
    return this.request(`/clients${qs ? `?${qs}` : ""}`, clientsSchema);
  }

  /** Register a client (POST /clients/onboard); idempotent on telegram_id. */
  onboardClient(input: OnboardClientInput): Promise<Client> {
    return this.request("/clients/onboard", clientSchema, {
      method: "POST",
      body: JSON.stringify(input)
    });
  }

  /**
   * Feature 5 — create a walk-in client by name (POST /clients/walk-in). The
   * stored row has no Telegram id and `source: "walk_in"`; phone/note optional.
   * Admin-only server-side.
   */
  createWalkIn(input: CreateWalkInInput): Promise<Client> {
    return this.request("/clients/walk-in", clientSchema, {
      method: "POST",
      body: JSON.stringify(input)
    });
  }

  /**
   * Feature 5 — admin/trainer books a client onto a training (POST
   * /bookings/manual). Same `{ clientId, trainingId }` body as the bot's self
   * path, but the server authorizes admin-or-the-training's-trainer and owns all
   * capacity/status/duplicate math — the console computes nothing. A full or
   * duplicate booking surfaces as a thrown Error (409) the screen renders.
   */
  bookManual(input: CreateSingleBookingInput): Promise<Booking> {
    return this.request("/bookings/manual", bookingSchema, {
      method: "POST",
      body: JSON.stringify(input)
    });
  }

  /**
   * Move a client between groups for a month (POST /bookings/transfer-group). The
   * server cancels the client's future bookings on `fromGroupId` and re-books them
   * onto `toGroupId`'s bookable future trainings — all capacity/status math is the
   * API's. Admin-only server-side; returns the moved/cancelled/skipped dates the
   * console renders. The two groups must differ (enforced by the contract + API).
   */
  transferGroupMember(input: TransferGroupInput): Promise<TransferGroupResult> {
    return this.request("/bookings/transfer-group", transferGroupResultSchema, {
      method: "POST",
      body: JSON.stringify(input)
    });
  }

  // ── Subscription payments (admin) ──────────────────────────────────────────

  /**
   * Admin list of monthly subscriptions (GET /subscriptions), optionally filtered
   * by `paymentState` (unpaid/partial/paid) and/or `clientId`. Counts, totals, and
   * the payment state are all server-decided over non-cancelled bookings; the
   * console never sums money or derives state — it only renders the validated rows.
   */
  listSubscriptions(query: ListSubscriptionsQuery): Promise<SubscriptionSummary[]> {
    const params = new URLSearchParams();
    if (query.paymentState) {
      params.set("paymentState", query.paymentState);
    }
    if (query.clientId) {
      params.set("clientId", query.clientId);
    }
    const qs = params.toString();
    return this.request(`/subscriptions${qs ? `?${qs}` : ""}`, subscriptionsSchema);
  }

  /**
   * Mark every non-cancelled booking of one subscription paid/unpaid (PATCH
   * /subscriptions/:id/paid). The server flips the whole batch in one transaction,
   * stamps the acting admin, and returns the re-aggregated summary; a 404 (no
   * matching booking) surfaces as {@link NotFoundError}.
   */
  markSubscriptionPaid(id: string, paid: boolean): Promise<SubscriptionSummary> {
    return this.request(`/subscriptions/${id}/paid`, subscriptionSummarySchema, {
      method: "PATCH",
      body: JSON.stringify({ paid })
    });
  }

  // ── Broadcasts (M4) ───────────────────────────────────────────────────────

  /**
   * T2.4 — dry-run preview of a free-slot broadcast (GET /broadcasts/preview):
   * the composed message text, the bookable slot cards, and the server-decided
   * recipient count for the chosen audience. The audience segment can't ride a
   * flat query string, so the controller expects it JSON-encoded in the `audience`
   * param (see coerceAudienceQuery in broadcasts.controller.ts); an absent audience
   * means `{ kind: "all" }`. The browser does NO recipient/segmentation math — it
   * only renders this validated result before the send action.
   */
  previewBroadcast(type: BroadcastType, audience?: BroadcastAudience): Promise<BroadcastPreview> {
    const params = new URLSearchParams({ type });
    if (audience) {
      params.set("audience", JSON.stringify(audience));
    }
    return this.request(`/broadcasts/preview?${params.toString()}`, broadcastPreviewSchema);
  }

  /**
   * T2.4 — send the previewed broadcast (POST /broadcasts/send). Persists one
   * broadcasts row server-side (per-recipient delivery failures are tolerated by
   * the API) and returns it. `audience` is sent inline in the JSON body; absent ⇒
   * `{ kind: "all" }`.
   */
  sendBroadcast(input: SendBroadcastInput): Promise<Broadcast> {
    return this.request("/broadcasts/send", broadcastSchema, {
      method: "POST",
      body: JSON.stringify(input)
    });
  }

  // ── Analytics reports (M4) ────────────────────────────────────────────────

  /**
   * Build the `?from=&to=` query the analytics reports require. The non-summary
   * endpoints validate a strict range (both bounds), so callers pass a resolved
   * {from,to}; the server owns from<=to validation and all aggregation.
   */
  private rangeQuery(range: AnalyticsRangeQuery): string {
    return new URLSearchParams({ from: range.from, to: range.to }).toString();
  }

  /** T3.1 — popular recurring (weekday, startTime) slots ranked by bookings. */
  popularSlots(range: AnalyticsRangeQuery): Promise<PopularSlot[]> {
    return this.request(`/analytics/popular-slots?${this.rangeQuery(range)}`, popularSlotsSchema);
  }

  /** T3.1 — average booked/capacity fill rate across trainings in range. */
  fillRate(range: AnalyticsRangeQuery): Promise<FillRate> {
    return this.request(`/analytics/fill-rate?${this.rangeQuery(range)}`, fillRateSchema);
  }

  /** T3.1 — sessions + participants per trainer in range. */
  trainerLoad(range: AnalyticsRangeQuery): Promise<TrainerLoad[]> {
    return this.request(`/analytics/trainer-load?${this.rangeQuery(range)}`, trainerLoadListSchema);
  }

  /** T3.1 — cancelled vs total bookings created in range, with rate. */
  cancellations(range: AnalyticsRangeQuery): Promise<CancellationStats> {
    return this.request(`/analytics/cancellations?${this.rangeQuery(range)}`, cancellationStatsSchema);
  }

  /** T3.1 — no_show vs resolved bookings on trainings in range, with rate. */
  noShows(range: AnalyticsRangeQuery): Promise<NoShowStats> {
    return this.request(`/analytics/no-shows?${this.rangeQuery(range)}`, noShowStatsSchema);
  }

  /** T3.1 — active/booking clients and total bookings created in range. */
  clientActivity(range: AnalyticsRangeQuery): Promise<ClientActivity> {
    return this.request(`/analytics/client-activity?${this.rangeQuery(range)}`, clientActivitySchema);
  }

  /** T3.1 — broadcasts → attributed bookings within the server attribution window. */
  broadcastEffectiveness(range: AnalyticsRangeQuery): Promise<BroadcastEffectiveness> {
    return this.request(
      `/analytics/broadcast-effectiveness?${this.rangeQuery(range)}`,
      broadcastEffectivenessSchema
    );
  }

  // ── Localization (i18n) ────────────────────────────────────────────────────

  /**
   * The merged catalog for a locale (GET /i18n/catalog?locale=…): static defaults
   * overlaid with admin overrides, as a flat dotted-key → string map. Public on the
   * API; the console renders it through the resolver with the bundled static catalog
   * as the offline fallback.
   */
  getI18nCatalog(locale: Locale): Promise<LabelCatalog> {
    const query = new URLSearchParams({ locale }).toString();
    return this.request(`/i18n/catalog?${query}`, labelCatalogSchema);
  }

  /**
   * Editor rows for a locale (GET /i18n/labels?locale=…) — one per known key, each
   * carrying its canonical default and the current override (null when using the
   * default). Admin-only on the server.
   */
  listLabels(locale: Locale): Promise<LabelEntry[]> {
    const query = new URLSearchParams({ locale }).toString();
    return this.request(`/i18n/labels?${query}`, labelEntriesSchema);
  }

  /**
   * Upsert one label override (PATCH /i18n/labels). The server rejects unknown keys
   * and unknown fields; it returns the updated editor row. Admin-only.
   */
  updateLabel(input: UpdateLabelInput): Promise<LabelEntry> {
    return this.request("/i18n/labels", labelEntrySchema, {
      method: "PATCH",
      body: JSON.stringify(input)
    });
  }

  /**
   * Reset a label to its canonical default (DELETE /i18n/labels), removing any
   * override. Idempotent; returns the editor row with `override: null`. Admin-only.
   */
  resetLabel(input: { locale: Locale; key: string }): Promise<LabelEntry> {
    return this.request("/i18n/labels", labelEntrySchema, {
      method: "DELETE",
      body: JSON.stringify(input)
    });
  }

  // ── Notification templates (Slice F) ────────────────────────────────────────

  /**
   * The editable client-facing notification templates (GET /notification-templates)
   * — one row per event, each carrying its current effective body, whether it is
   * overridden, the code default for reference/reset, and the allowed placeholders.
   * Admin-only server-side; every row is validated by `notificationTemplateSchema`.
   */
  listNotificationTemplates(): Promise<NotificationTemplate[]> {
    return this.request("/notification-templates", notificationTemplatesSchema);
  }

  /**
   * Set one event's override body (PATCH /notification-templates/:eventKey, body
   * `{ body }`). The server validates a non-empty body and returns the updated row;
   * unknown `{tokens}` render literally rather than being rejected. Admin-only.
   */
  updateNotificationTemplate(
    eventKey: NotificationTemplateKey,
    body: string
  ): Promise<NotificationTemplate> {
    return this.request(`/notification-templates/${eventKey}`, notificationTemplateSchema, {
      method: "PATCH",
      body: JSON.stringify({ body })
    });
  }

  /**
   * Reset one event to its code default (POST /notification-templates/:eventKey/reset),
   * removing any override. Idempotent; returns the row with `isOverridden: false`.
   * Admin-only.
   */
  resetNotificationTemplate(eventKey: NotificationTemplateKey): Promise<NotificationTemplate> {
    return this.request(`/notification-templates/${eventKey}/reset`, notificationTemplateSchema, {
      method: "POST",
      body: JSON.stringify({})
    });
  }
}

/**
 * Build a typed error from a failed (non-2xx) response, preferring the server's
 * human-readable message over a status code. NestJS exceptions serialize as
 * `{ statusCode, message, error }`, where `message` is a string or string[]. A
 * 409 becomes a {@link ConflictError} the UI can branch on (refetch + close);
 * any other status stays a generic Error.
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

/** Read a persisted session JWT from sessionStorage (page reload survives login). */
function readStoredSession(): string | null {
  try {
    return sessionStorage.getItem(SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Resolve the API base URL from browser env, defaulting to local dev. */
export function createApiClient(): ApiClient {
  return new ApiClient(import.meta.env.VITE_API_URL ?? "http://localhost:3000");
}
