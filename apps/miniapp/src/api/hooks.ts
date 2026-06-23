import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult
} from "@tanstack/react-query";
import type {
  AvailableSlotsQuery,
  Booking,
  Client,
  CourtAvailability,
  CourtRequest,
  CourtRequestPreview,
  FreeCourtNumbers,
  Group,
  GroupBookingResult,
  GroupMembers,
  IndividualRequestResult,
  Level,
  MyBookingItem,
  MyBookingScope,
  MyCourtRequestItem,
  OnboardClientInput,
  SlotCard,
  Trainer,
  WaitlistAdminItem,
  WaitlistEntry
} from "@beosand/types";
import type { Locale } from "@beosand/i18n";
import { useApiClient } from "./ApiProvider";
import { NotFoundError, type CourtRequestInput } from "./client";

/**
 * The stable query key for the caller's own Client record, keyed by Telegram id.
 * Documented for reuse: later slices (S4–S8) read the resolved client — and its
 * `id` (clientId) — through {@link useClient} over this exact key, so the record
 * is fetched once and shared, never re-resolved per screen.
 */
export function clientQueryKey(telegramId: number): readonly [string, number] {
  return ["client", telegramId] as const;
}

/** Active levels for the onboarding picker. */
export function levelsQueryKey(): readonly [string] {
  return ["levels"] as const;
}

/**
 * Resolve the caller's Client by their verified Telegram id. A 404 from the API
 * means "not onboarded yet" — surfaced here as `notOnboarded` so the router can
 * branch to the wizard without sniffing error messages. The query is disabled
 * until the session identity is available.
 */
export function useClient(): UseQueryResult<Client> & { notOnboarded: boolean } {
  const client = useApiClient();
  const telegramId = client.getMe()?.telegramId ?? null;

  const query = useQuery<Client>({
    queryKey: clientQueryKey(telegramId ?? -1),
    enabled: telegramId != null,
    retry: false,
    queryFn: () => client.getClientByTelegramId(telegramId!)
  });

  return { ...query, notOnboarded: query.error instanceof NotFoundError };
}

/**
 * The caller's OWN resolved Client id from the cached {@link useClient} record, or
 * null until it resolves. The single place the clientId is read, so every write
 * hook supplies the same self-only id (never client-asserted — the server re-checks
 * ownership from the verified session) instead of re-deriving it per hook.
 */
export function useResolvedClientId(): string | null {
  return useClient().data?.id ?? null;
}

/** Active levels (GET /levels), validated against the level contract. */
export function useLevels(): UseQueryResult<Level[]> {
  const client = useApiClient();
  return useQuery<Level[]>({
    queryKey: levelsQueryKey(),
    queryFn: () => client.listLevels()
  });
}

/**
 * Onboard the caller (POST /clients/onboard, idempotent on telegram_id). On
 * success it seeds the client cache with the returned record so the router lands
 * on the profile with no extra round-trip.
 */
export function useOnboard(): UseMutationResult<Client, Error, OnboardClientInput> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation<Client, Error, OnboardClientInput>({
    mutationFn: (input) => client.onboardClient(input),
    onSuccess: (record) => {
      if (record.telegramId != null) {
        qc.setQueryData(clientQueryKey(record.telegramId), record);
      }
    }
  });
}

/**
 * A stable, order-independent query key for a bookable-slots request, keyed by the
 * normalised filter set so any filter change (date window / level / weekday /
 * time-of-day / trainer) refetches and a cleared filter shares the key it had
 * before. Built from sorted, defined entries so `{a,b}` and `{b,a}` collide.
 */
export function availableSlotsQueryKey(
  query: AvailableSlotsQuery
): readonly [string, string] {
  const normalised = Object.entries(query)
    .filter(([, value]) => value !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${String(value)}`)
    .join("&");
  return ["available-slots", normalised] as const;
}

/** The shared query-key prefix for every available-slots request (for invalidation). */
const AVAILABLE_SLOTS_KEY_PREFIX = "available-slots";

/** Trainers for the filter picker (GET /trainers). */
export function trainersQueryKey(): readonly [string] {
  return ["trainers"] as const;
}

/**
 * Bookable slots for the browse screen (GET /trainings/available), keyed by the
 * filter set so a filter change refetches. The server returns only bookable slots
 * and owns availability/price; this hook only fetches and validates. The Today
 * toggle is expressed by the caller as `from = to = today` in the query.
 */
export function useAvailableSlots(query: AvailableSlotsQuery): UseQueryResult<SlotCard[]> {
  const client = useApiClient();
  return useQuery<SlotCard[]>({
    queryKey: availableSlotsQueryKey(query),
    queryFn: () => client.listAvailableSlots(query)
  });
}

/** Trainers for the browse filter picker (GET /trainers), cached like levels. */
export function useTrainers(): UseQueryResult<Trainer[]> {
  const client = useApiClient();
  return useQuery<Trainer[]>({
    queryKey: trainersQueryKey(),
    queryFn: () => client.listTrainers()
  });
}

/**
 * Request a one-on-one training with a trainer (POST /trainers/:id/individual-request).
 * The mutation argument is the chosen trainer's id; the client supplies the caller's own
 * Telegram id from the verified session (never user input — the server re-derives the
 * requester from the session and rejects a mismatch). Notification-only: no booking is
 * created, so there is nothing to invalidate. The result is an
 * {@link IndividualRequestResult}: `delivered:false` is a calm 200 ("trainer unavailable"),
 * surfaced as success data the screen renders softly — NOT a mutation error.
 */
export function useRequestIndividual(): UseMutationResult<IndividualRequestResult, Error, string> {
  const apiClient = useApiClient();
  return useMutation<IndividualRequestResult, Error, string>({
    mutationFn: (trainerId) => apiClient.requestIndividualSession(trainerId)
  });
}

/**
 * Book a single training (POST /bookings/single). `clientId` is the caller's OWN
 * resolved Client id (the cached {@link useClient} record's `id`), never user input
 * — the server re-checks ownership from the verified session.
 *
 * On success or failure it invalidates every available-slots query so the affected
 * slot is refetched: a slot that hit its last seat flips `open → full` server-side
 * and drops out of the bookable list, reflecting the server's capacity recompute in
 * the UI. A 409 (slot filled meanwhile) surfaces as a {@link ConflictError} so the
 * screen shows the server message verbatim; the same invalidation refetches.
 */
export function useCreateBooking(): UseMutationResult<Booking, Error, string> {
  const apiClient = useApiClient();
  const qc = useQueryClient();
  const clientId = useResolvedClientId();
  return useMutation<Booking, Error, string>({
    mutationFn: (trainingId) => {
      if (clientId == null) {
        throw new Error("No resolved client to book for");
      }
      return apiClient.createSingleBooking({ clientId, trainingId });
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: [AVAILABLE_SLOTS_KEY_PREFIX] });
    }
  });
}

/**
 * Join a training's waitlist (POST /waitlist). `clientId` is the caller's OWN
 * resolved Client id (the cached {@link useClient} record's `id`), never user input
 * — the server re-checks ownership and eligibility from the verified session. The
 * mutation argument is the trainingId; the hook supplies the clientId.
 *
 * A 409 (slot became bookable again / already on the list) surfaces as a
 * {@link ConflictError} so the screen shows the server message verbatim. No slots
 * invalidation here: joining a still-full slot does not change the bookable list.
 */
export function useJoinWaitlist(): UseMutationResult<WaitlistEntry, Error, string> {
  const apiClient = useApiClient();
  const clientId = useResolvedClientId();
  return useMutation<WaitlistEntry, Error, string>({
    mutationFn: (trainingId) => {
      if (clientId == null) {
        throw new Error("No resolved client to join the waitlist for");
      }
      return apiClient.joinWaitlist({ clientId, trainingId });
    }
  });
}

/**
 * Accept a freed seat from the waitlist (POST /waitlist/:id/accept). The mutation
 * argument is the entry id carried by the deep link; the server promotes it to a
 * booking, enforcing ownership, the confirmation window, and capacity (no over-book).
 *
 * On settle it invalidates every available-slots query so the bookable list reflects
 * the server's capacity recompute (a promotion may have consumed the slot's last open
 * seat). A 409 (window closed / seat re-taken) surfaces as a {@link ConflictError}.
 */
export function useAcceptWaitlist(): UseMutationResult<Booking, Error, string> {
  const apiClient = useApiClient();
  const qc = useQueryClient();
  return useMutation<Booking, Error, string>({
    mutationFn: (entryId) => apiClient.acceptWaitlist(entryId),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: [AVAILABLE_SLOTS_KEY_PREFIX] });
    }
  });
}

/** The shared query-key prefix for every my-bookings request (for invalidation). */
const MY_BOOKINGS_KEY_PREFIX = "my-bookings";

/**
 * A stable query key for one scope of the caller's bookings, keyed by clientId AND
 * scope so the two scopes (upcoming / past) cache independently and a cancel can
 * invalidate the whole prefix to refetch both at once.
 */
export function myBookingsQueryKey(
  clientId: string,
  scope: MyBookingScope
): readonly [string, string, MyBookingScope] {
  return [MY_BOOKINGS_KEY_PREFIX, clientId, scope] as const;
}

/**
 * The caller's own bookings for one scope (GET /bookings/mine). `clientId` is the
 * caller's OWN resolved Client id (the cached {@link useClient} record's `id`), never
 * user input — the server re-checks ownership from the verified session and owns the
 * upcoming/past split, the per-item `canCancel` flag, and the outcome. Disabled until
 * the client is resolved; the two scopes cache independently.
 */
export function useMyBookings(scope: MyBookingScope): UseQueryResult<MyBookingItem[]> {
  const apiClient = useApiClient();
  const clientId = useResolvedClientId();
  return useQuery<MyBookingItem[]>({
    queryKey: myBookingsQueryKey(clientId ?? "", scope),
    enabled: clientId != null,
    queryFn: () => apiClient.listMyBookings(clientId!, scope)
  });
}

/** The query key for the caller's own active waitlist entries, keyed by clientId. */
export function myWaitlistQueryKey(clientId: string): readonly [string, string] {
  return ["my-waitlist", clientId] as const;
}

/**
 * The caller's own active waitlist entries (GET /waitlist/mine) — the dates they are
 * queued on, each with its server-assigned position. Mirrors {@link useMyBookings}:
 * the server resolves the requester from the verified session and returns only their
 * own entries (no identity in the call). Keyed by the resolved clientId so it caches
 * per user and is disabled until the client resolves. The Mini App does no queue math.
 */
export function useMyWaitlist(): UseQueryResult<WaitlistAdminItem[]> {
  const apiClient = useApiClient();
  const clientId = useResolvedClientId();
  return useQuery<WaitlistAdminItem[]>({
    queryKey: myWaitlistQueryKey(clientId ?? ""),
    enabled: clientId != null,
    queryFn: () => apiClient.getMyWaitlist()
  });
}

/** The query key for the caller's own court requests (the in-app calendar feed). */
export function myCourtRequestsQueryKey(clientId: string): readonly [string, string] {
  return ["my-court-requests", clientId] as const;
}

/**
 * The caller's own court requests (GET /court-requests/mine) for the calendar. The
 * server resolves the requester from the verified session (bridged Bearer →
 * `x-client-telegram-id`) and returns only their own requests — the Mini App sends no
 * identity in the call. Keyed by the resolved clientId so it caches per user and is
 * disabled until the client resolves. The contract carries NO court id, so a court
 * number can never reach the calendar.
 */
export function useMyCourtRequests(): UseQueryResult<MyCourtRequestItem[]> {
  const apiClient = useApiClient();
  const clientId = useResolvedClientId();
  return useQuery<MyCourtRequestItem[]>({
    queryKey: myCourtRequestsQueryKey(clientId ?? ""),
    enabled: clientId != null,
    queryFn: () => apiClient.listMyCourtRequests()
  });
}

/**
 * Cancel one of the caller's bookings (POST /bookings/:id/cancel). The mutation
 * argument is the bookingId; the server enforces ownership from the verified session,
 * recomputes the training's capacity (`full → open`), and keeps a monthly batch's
 * siblings intact — the Mini App does no batch/capacity math.
 *
 * On settle it invalidates BOTH my-bookings scopes (the row leaves Upcoming and
 * appears in Past) AND every available-slots query (a freed seat may flip a slot
 * `full → open` back into the bookable list). A 409 (already cancelled / no longer
 * cancellable) surfaces as a {@link ConflictError} so the screen shows the server
 * message verbatim; a 403 (not the owner) stays a generic error.
 */
export function useCancelBooking(): UseMutationResult<Booking, Error, string> {
  const apiClient = useApiClient();
  const qc = useQueryClient();
  return useMutation<Booking, Error, string>({
    mutationFn: (bookingId) => apiClient.cancelBooking(bookingId),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: [MY_BOOKINGS_KEY_PREFIX] });
      void qc.invalidateQueries({ queryKey: [AVAILABLE_SLOTS_KEY_PREFIX] });
    }
  });
}

/** Active groups for the monthly-subscription picker (GET /groups). */
export function groupsQueryKey(): readonly [string] {
  return ["groups"] as const;
}

/**
 * Active groups (GET /groups), validated against the group contract. Cached like
 * levels/trainers — reference data the group-booking screen reads to render the
 * group list and the chosen group's facts. The server owns the schedule, prices,
 * and capacity; this hook only fetches and validates.
 */
export function useGroups(): UseQueryResult<Group[]> {
  const client = useApiClient();
  return useQuery<Group[]>({
    queryKey: groupsQueryKey(),
    queryFn: () => client.listGroups()
  });
}

/** A stable query key for a group's monthly roster, keyed by group + year + month. */
export function groupMembersQueryKey(
  groupId: string,
  year: number,
  month: number
): readonly [string, string, number, number] {
  return ["group-members", groupId, year, month] as const;
}

/**
 * The roster of a group for one month (GET /groups/:id/members) — "who signed up".
 * For the Mini App caller the server returns the CLIENT-NARROWED shape (first name +
 * avatar initial + count only, never other clients' ids/full names). Keyed by group +
 * month so each previewed month caches independently; disabled until both are set.
 */
export function useGroupMembers(
  groupId: string,
  year: number | undefined,
  month: number | undefined
): UseQueryResult<GroupMembers> {
  const client = useApiClient();
  return useQuery<GroupMembers>({
    queryKey: groupMembersQueryKey(groupId, year ?? 0, month ?? 0),
    enabled: year != null && month != null,
    queryFn: () => client.getGroupMembers(groupId, year!, month!)
  });
}

/** The chosen month for a group subscription — two display-only ints the server validates. */
export interface GroupBookingArgs {
  groupId: string;
  year: number;
  month: number;
}

/**
 * Subscribe the caller to a group for a whole month (POST /bookings/group).
 * `clientId` is the caller's OWN resolved Client id (the cached {@link useClient}
 * record's `id`), never user input — the server re-checks ownership from the
 * verified session and computes the month's instances, prices, capacity, and the
 * skipped (full) dates. The mutation argument is the chosen group + month; the hook
 * supplies the clientId.
 *
 * On settle it invalidates BOTH my-bookings scopes (the new month's trainings join
 * the caller's Upcoming list) AND every available-slots query (a subscription
 * consumed seats that may flip a slot `open → full` out of the bookable list). A
 * 409 (invalid month / inactive group / mismatched client) surfaces as a
 * {@link ConflictError} so the screen shows the server message verbatim.
 */
export function useCreateGroupBooking(): UseMutationResult<
  GroupBookingResult,
  Error,
  GroupBookingArgs
> {
  const apiClient = useApiClient();
  const qc = useQueryClient();
  const clientId = useResolvedClientId();
  return useMutation<GroupBookingResult, Error, GroupBookingArgs>({
    mutationFn: ({ groupId, year, month }) => {
      if (clientId == null) {
        throw new Error("No resolved client to subscribe");
      }
      return apiClient.createGroupBooking({ clientId, groupId, year, month });
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: [MY_BOOKINGS_KEY_PREFIX] });
      void qc.invalidateQueries({ queryKey: [AVAILABLE_SLOTS_KEY_PREFIX] });
    }
  });
}

/**
 * Persist the caller's UI locale (PATCH .../language). On success it updates the
 * cached client record so the profile shows the new language immediately.
 */
export function useSetLanguage(): UseMutationResult<Client, Error, Locale> {
  const client = useApiClient();
  const qc = useQueryClient();
  const telegramId = client.getMe()?.telegramId ?? null;
  return useMutation<Client, Error, Locale>({
    mutationFn: (locale) => {
      if (telegramId == null) {
        throw new Error("No verified Telegram identity");
      }
      return client.setLanguage(telegramId, locale);
    },
    onSuccess: (record) => {
      if (record.telegramId != null) {
        qc.setQueryData(clientQueryKey(record.telegramId), record);
      }
    }
  });
}

/** The shared query-key prefix for every court-availability request (for invalidation). */
const COURT_AVAILABILITY_KEY_PREFIX = "court-availability";

/** A stable query key for one date's court availability. */
export function courtAvailabilityQueryKey(date: string): readonly [string, string] {
  return [COURT_AVAILABILITY_KEY_PREFIX, date] as const;
}

/**
 * Offerable court start times for a date (GET /court-requests/availability), keyed by
 * the date so a date change refetches. The server returns only offerable starts, each
 * with a free-court COUNT (never a court id) and the 6-per-hour limit already applied;
 * this hook only fetches and validates. Disabled until a date is chosen.
 */
export function useCourtAvailability(
  date: string | undefined
): UseQueryResult<CourtAvailability> {
  const client = useApiClient();
  return useQuery<CourtAvailability>({
    queryKey: courtAvailabilityQueryKey(date ?? ""),
    enabled: date != null,
    queryFn: () => client.getCourtAvailability(date!)
  });
}

/** The shared query-key prefix for every free-courts request (for invalidation). */
const FREE_COURTS_KEY_PREFIX = "court-free-courts";

/** A stable query key for one slot's free court numbers, keyed by date + start + duration. */
export function courtFreeCourtsQueryKey(slot: CourtRequestInput): readonly [string, string] {
  return [FREE_COURTS_KEY_PREFIX, `${slot.date}|${slot.startTime}|${slot.durationHours}`] as const;
}

/**
 * The SPECIFIC courts free for a chosen slot (GET /court-requests/free-courts), so the
 * court-picker step can render which courts (1…6) the client may pick. Keyed by the
 * full slot so a date/time/duration change refetches; disabled until a complete slot is
 * chosen. The server owns which courts are free; this hook only fetches and validates.
 */
export function useCourtFreeCourts(
  slot: CourtRequestInput | undefined
): UseQueryResult<FreeCourtNumbers> {
  const apiClient = useApiClient();
  return useQuery<FreeCourtNumbers>({
    queryKey: courtFreeCourtsQueryKey(slot ?? { date: "", startTime: "", durationHours: 1 }),
    enabled: slot != null,
    queryFn: () => apiClient.getFreeCourtNumbers(slot!)
  });
}

/**
 * Price + availability preview for a chosen court slot (POST /court-requests/preview).
 * The mutation argument is the chosen slot; the ApiClient supplies the caller's OWN
 * Telegram id from the verified session (never user input — the server re-derives the
 * requester and rejects a mismatch). The client NEVER sends or computes a price; the
 * result's `priceRsd` is the SERVER's authoritative value the screen displays read-only.
 */
export function useCourtPreview(): UseMutationResult<CourtRequestPreview, Error, CourtRequestInput> {
  const apiClient = useApiClient();
  return useMutation<CourtRequestPreview, Error, CourtRequestInput>({
    mutationFn: (input) => apiClient.previewCourtRequest(input)
  });
}

/**
 * Submit a court-rental request (POST /court-requests). The mutation argument is the
 * chosen slot; the ApiClient supplies the caller's OWN Telegram id from the verified
 * session. The created {@link CourtRequest} is `pending` with NO court assigned — the
 * client now picks the courts (held while pending). On settle it invalidates the date's
 * availability AND every free-courts query so a consumed slot — the picked courts now
 * held — reflects the server's recompute. A 409 (slot filled meanwhile) surfaces as a
 * {@link ConflictError} so the screen shows the server message verbatim.
 */
export function useCreateCourtRequest(): UseMutationResult<CourtRequest, Error, CourtRequestInput> {
  const apiClient = useApiClient();
  const qc = useQueryClient();
  return useMutation<CourtRequest, Error, CourtRequestInput>({
    mutationFn: (input) => apiClient.createCourtRequest(input),
    onSettled: (_data, _error, input) => {
      void qc.invalidateQueries({ queryKey: courtAvailabilityQueryKey(input.date) });
      // The picked courts are now held; refetch every free-courts read so no taken
      // court is still offered as selectable on the picker.
      void qc.invalidateQueries({ queryKey: [FREE_COURTS_KEY_PREFIX] });
    }
  });
}
