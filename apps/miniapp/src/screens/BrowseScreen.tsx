import { useMemo, useState } from "react";
import type { AvailableSlotsQuery, SlotCard } from "@beosand/types";
import {
  useAvailableSlots,
  useCreateBooking,
  useJoinWaitlist,
  useLevels,
  useTrainers
} from "../api/hooks";
import { ConflictError } from "../api/client";
import { resolveErrorMessage } from "../api/errors";
import { useT } from "../i18n/LanguageProvider";
import { hapticSelection, hapticSuccess } from "../tg/buttons";
import { BrowseView } from "../ui/BrowseView";
import { ConfirmView } from "../ui/ConfirmView";
import type { SlotFilters } from "../ui/FilterSheet";
import { WaitlistJoinView } from "../ui/WaitlistJoinView";
import { todayLocalDate } from "../ui/format";

/**
 * The browse-and-book journey (S3 + S4). Owns the filter/Today state, queries the
 * bookable slots, and drives the booking write — purely interaction: every value
 * rendered is the API's (free seats, price), with no availability or money math here.
 *
 * One screen, two sub-states: the slot list (with the Today toggle + filter sheet)
 * and a pushed confirm step for a chosen bookable slot. The confirm step is held in
 * local state rather than the global route stack because it carries the selected
 * {@link SlotCard} payload; the native BackButton is owned by the shell and pops
 * the screen, while in-confirm "back to list" clears the local selection.
 *
 * A full slot (defensive — the endpoint returns only bookable slots) opens the
 * waitlist-join sub-view (S6) and never offers a normal booking. A booking 409 ("slot
 * filled meanwhile") turns into the same join offer for the very slot just attempted,
 * so the user can queue without leaving the flow.
 */
export function BrowseScreen(): JSX.Element {
  const t = useT();

  const [todayOnly, setTodayOnly] = useState(false);
  const [filters, setFilters] = useState<SlotFilters>({});
  const [selected, setSelected] = useState<SlotCard | null>(null);
  // The slot being queued for, when in the waitlist sub-view. `fromConflict` records
  // whether the join offer came from a booking 409 (copy switch only; same write).
  const [waitlistFor, setWaitlistFor] = useState<{ slot: SlotCard; fromConflict: boolean } | null>(
    null
  );

  // Map the UI filter model + Today toggle onto the API query. Today pins the date
  // window to a single day (from = to = today); otherwise the window is left to the
  // server. A cleared filter field is simply absent, so the API owns its default.
  const query = useMemo<AvailableSlotsQuery>(() => {
    const q: AvailableSlotsQuery = {};
    if (todayOnly) {
      const today = todayLocalDate();
      q.from = today;
      q.to = today;
    }
    if (filters.weekday !== undefined) q.weekday = filters.weekday;
    if (filters.timeOfDay !== undefined) q.timeOfDay = filters.timeOfDay;
    if (filters.trainerId !== undefined) q.trainerId = filters.trainerId;
    if (filters.levelId !== undefined) q.levelId = filters.levelId;
    return q;
  }, [todayOnly, filters]);

  const slots = useAvailableSlots(query);
  const trainers = useTrainers();
  const levels = useLevels();
  const booking = useCreateBooking();
  const waitlist = useJoinWaitlist();

  const listError =
    slots.error instanceof Error
      ? slots.error.message
      : slots.isError
        ? t("miniapp.browse.errorBody")
        : undefined;

  const toggleToday = (): void => {
    hapticSelection();
    setTodayOnly((prev) => !prev);
  };

  const openConfirm = (slot: SlotCard): void => {
    hapticSelection();
    booking.reset();
    setSelected(slot);
  };

  const backToList = (): void => {
    booking.reset();
    waitlist.reset();
    setSelected(null);
    setWaitlistFor(null);
  };

  const openWaitlist = (slot: SlotCard): void => {
    // Full-slot tap: queue for this slot. The native MainButton in WaitlistJoinView
    // fires the join; this only opens the confirm sub-view (a fresh join state).
    hapticSelection();
    waitlist.reset();
    setWaitlistFor({ slot, fromConflict: false });
  };

  const offerWaitlistFromConflict = (): void => {
    // The booking 409 path: the seat filled meanwhile, so offer the waitlist for the
    // very slot just attempted. Carries the slot so the join confirm can show it.
    if (!selected) {
      return;
    }
    hapticSelection();
    waitlist.reset();
    setWaitlistFor({ slot: selected, fromConflict: true });
    setSelected(null);
    booking.reset();
  };

  const joinWaitlist = (): void => {
    if (!waitlistFor) {
      return;
    }
    waitlist.mutate(waitlistFor.slot.trainingId, {
      onSuccess: () => hapticSuccess()
    });
  };

  const confirmBooking = (): void => {
    if (!selected) {
      return;
    }
    booking.mutate(selected.trainingId, {
      onSuccess: () => hapticSuccess()
    });
  };

  if (waitlistFor) {
    // The server's 409 message verbatim (already-on-list / now-bookable); fall back to
    // a localized string only when a ConflictError carries no body message.
    const joinError = resolveErrorMessage(waitlist.error, t, "miniapp.waitlist.joinConflict");

    return (
      <WaitlistJoinView
        slot={waitlistFor.slot}
        fromConflict={waitlistFor.fromConflict}
        onJoin={joinWaitlist}
        submitting={waitlist.isPending}
        position={waitlist.data?.position ?? null}
        errorMessage={joinError}
        onDone={backToList}
        doneLabelKey="miniapp.waitlist.toSchedule"
      />
    );
  }

  if (selected) {
    // Prefer the server's 409 message verbatim; fall back to a localized conflict
    // string only when the error is a ConflictError without a body message.
    const isConflict = booking.error instanceof ConflictError;
    const errorMessage = resolveErrorMessage(booking.error, t, "miniapp.booking.conflict");

    return (
      <ConfirmView
        slot={selected}
        onConfirm={confirmBooking}
        submitting={booking.isPending}
        succeeded={booking.isSuccess}
        errorMessage={errorMessage}
        onBackToList={backToList}
        onJoinWaitlist={isConflict ? offerWaitlistFromConflict : undefined}
      />
    );
  }

  return (
    <BrowseView
      slots={slots.data}
      trainers={trainers.data ?? []}
      levels={levels.data ?? []}
      isLoading={slots.isLoading}
      errorMessage={listError}
      todayOnly={todayOnly}
      onToggleToday={toggleToday}
      filters={filters}
      onApplyFilters={setFilters}
      onResetFilters={() => setFilters({})}
      onBook={openConfirm}
      onWaitlist={openWaitlist}
    />
  );
}
