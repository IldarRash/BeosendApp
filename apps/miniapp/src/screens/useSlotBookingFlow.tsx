import { useState } from "react";
import type { SlotCard } from "@beosand/types";
import { ConflictError } from "../api/client";
import { useCreateBooking, useJoinWaitlist } from "../api/hooks";
import { resolveErrorMessage } from "../api/errors";
import { useT } from "../i18n/LanguageProvider";
import { hapticSelection, hapticSuccess } from "../tg/buttons";
import { ConfirmView } from "../ui/ConfirmView";

/**
 * The single-slot booking sub-flow shared by the Schedule (расписание) screen and any
 * other slot list. The screen builds the slots query and renders the list; the
 * chosen-slot confirm step and its success/auto-waitlist rendering live here once so
 * they can never drift.
 *
 * The waitlist is AUTO-BOOK + notify (frictionless): the client makes exactly ONE
 * decision (tap Book). When the booking write 409s because the group session is full,
 * this hook immediately fires the waitlist join for the SAME slot — no second tap — and
 * the {@link ConfirmView} renders the calm "you're on the waitlist · position N" result.
 *
 * Interaction layer only: the writes ({@link useCreateBooking}, {@link useJoinWaitlist})
 * decide everything (capacity, price, eligibility, queue position); this hook only
 * orchestrates the local selection state and the haptics. {@link activeSubView} is the
 * confirm element to render when a slot is chosen, else null — the screen renders its
 * list otherwise.
 */
export interface SlotBookingFlow {
  /** Open the confirm step for a slot (the list's tap). */
  openConfirm: (slot: SlotCard) => void;
  /** The active confirm sub-view element, or null when on the list. */
  activeSubView: JSX.Element | null;
}

export function useSlotBookingFlow(): SlotBookingFlow {
  const t = useT();

  const [selected, setSelected] = useState<SlotCard | null>(null);

  const booking = useCreateBooking();
  const waitlist = useJoinWaitlist();

  const openConfirm = (slot: SlotCard): void => {
    hapticSelection();
    booking.reset();
    waitlist.reset();
    setSelected(slot);
  };

  const backToList = (): void => {
    booking.reset();
    waitlist.reset();
    setSelected(null);
  };

  const confirmBooking = (): void => {
    if (!selected) {
      return;
    }
    booking.mutate(selected.trainingId, {
      onSuccess: () => hapticSuccess(),
      onError: (error) => {
        // A 409 means the full group session can't be booked — auto-queue the caller
        // onto the waitlist for the SAME slot with no extra tap. Any other failure
        // stays a hard error the ConfirmView shows verbatim.
        if (error instanceof ConflictError) {
          waitlist.mutate(selected.trainingId, {
            onSuccess: () => hapticSuccess()
          });
        }
      }
    });
  };

  let activeSubView: JSX.Element | null = null;

  if (selected) {
    // While the auto-join is in flight (or it failed too), surface a calm/verbatim
    // message; a successful join shows the waitlisted result instead of an error. A
    // hard booking failure (non-409) shows the booking error verbatim.
    const bookingFailedHard = booking.isError && !(booking.error instanceof ConflictError);
    const errorMessage = bookingFailedHard
      ? resolveErrorMessage(booking.error, t)
      : waitlist.isError
        ? resolveErrorMessage(waitlist.error, t, "miniapp.waitlist.joinConflict")
        : undefined;

    activeSubView = (
      <ConfirmView
        slot={selected}
        onConfirm={confirmBooking}
        submitting={booking.isPending || waitlist.isPending}
        succeeded={booking.isSuccess}
        bookingStatus={booking.data?.status}
        waitlistedPosition={waitlist.data?.position ?? null}
        errorMessage={errorMessage}
        onBackToList={backToList}
      />
    );
  }

  return { openConfirm, activeSubView };
}
