import { useState } from "react";
import type { SlotCard } from "@beosand/types";
import { ConflictError } from "../api/client";
import { useCreateBooking, useJoinWaitlist } from "../api/hooks";
import { resolveErrorMessage } from "../api/errors";
import { useT } from "../i18n/LanguageProvider";
import { hapticSelection, hapticSuccess } from "../tg/buttons";
import { ConfirmView } from "../ui/ConfirmView";
import { WaitlistJoinView } from "../ui/WaitlistJoinView";

/**
 * The single-slot booking + waitlist sub-flow shared by Browse (S3/S4) and the
 * Schedule (расписание) screen. Both screens differ ONLY in how they build the slots
 * query and which list view they render; the chosen-slot confirm step, the full-slot
 * and booking-409 waitlist paths, and their success/conflict rendering are identical,
 * so they live here once and can never drift.
 *
 * Interaction layer only: the writes ({@link useCreateBooking}, {@link useJoinWaitlist})
 * decide everything (capacity, price, eligibility); this hook only orchestrates the
 * local sub-state (the chosen {@link SlotCard} carried outside the route stack) and the
 * haptics. `openConfirm`/`openWaitlist` are wired to the list's book/waitlist taps; the
 * native BackButton (owned by the shell) pops the screen, while {@link backToList}
 * clears the local selection. {@link activeSubView} is the confirm/waitlist element to
 * render when set, else null — the screen renders its list otherwise.
 */
export interface SlotBookingFlow {
  /** Open the confirm step for a bookable slot (the list's "book" tap). */
  openConfirm: (slot: SlotCard) => void;
  /** Open the waitlist-join sub-view for a full slot (the list's "waitlist" tap). */
  openWaitlist: (slot: SlotCard) => void;
  /** The active confirm/waitlist sub-view element, or null when on the list. */
  activeSubView: JSX.Element | null;
}

export function useSlotBookingFlow(): SlotBookingFlow {
  const t = useT();

  const [selected, setSelected] = useState<SlotCard | null>(null);
  // The slot being queued for, when in the waitlist sub-view. `fromConflict` records
  // whether the join offer came from a booking 409 (copy switch only; same write).
  const [waitlistFor, setWaitlistFor] = useState<{ slot: SlotCard; fromConflict: boolean } | null>(
    null
  );

  const booking = useCreateBooking();
  const waitlist = useJoinWaitlist();

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

  let activeSubView: JSX.Element | null = null;

  if (waitlistFor) {
    // The server's 409 message verbatim (already-on-list / now-bookable); fall back to
    // a localized string only when a ConflictError carries no body message.
    const joinError = resolveErrorMessage(waitlist.error, t, "miniapp.waitlist.joinConflict");

    activeSubView = (
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
  } else if (selected) {
    // Prefer the server's 409 message verbatim; fall back to a localized conflict
    // string only when the error is a ConflictError without a body message.
    const isConflict = booking.error instanceof ConflictError;
    const errorMessage = resolveErrorMessage(booking.error, t, "miniapp.booking.conflict");

    activeSubView = (
      <ConfirmView
        slot={selected}
        onConfirm={confirmBooking}
        submitting={booking.isPending}
        succeeded={booking.isSuccess}
        bookingStatus={booking.data?.status}
        errorMessage={errorMessage}
        onBackToList={backToList}
        onJoinWaitlist={isConflict ? offerWaitlistFromConflict : undefined}
      />
    );
  }

  return { openConfirm, openWaitlist, activeSubView };
}
