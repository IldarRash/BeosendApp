import { useState } from "react";
import type { SlotCard } from "@beosand/types";
import { ConflictError } from "../api/client";
import { useCreateBooking } from "../api/hooks";
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
 * decision (tap Book). When the API returns the waitlisted branch for a full group slot,
 * the {@link ConfirmView} renders the calm "you're on the waitlist" result with the
 * server-assigned position.
 *
 * Interaction layer only: the write ({@link useCreateBooking}) decides everything
 * (capacity, price, eligibility, queue position); this hook only
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

/**
 * @param bookedTrainingIds The trainingIds the caller is already actively booked into.
 *   Used to interpret a booking 409 correctly: an already-booked trainingId 409s because
 *   the caller holds the seat — NOT because the session is full — so it must surface an
 *   "already booked" message. A genuine full visible group slot now comes back as a
 *   typed waitlisted result from POST /bookings/single, not as a client-side fallback.
 */
export function useSlotBookingFlow(
  bookedTrainingIds?: ReadonlySet<string>
): SlotBookingFlow {
  const t = useT();

  const [selected, setSelected] = useState<SlotCard | null>(null);

  const booking = useCreateBooking();

  const openConfirm = (slot: SlotCard): void => {
    hapticSelection();
    booking.reset();
    setSelected(slot);
  };

  const backToList = (): void => {
    booking.reset();
    setSelected(null);
  };

  const confirmBooking = (): void => {
    if (!selected) {
      return;
    }
    const trainingId = selected.trainingId;
    booking.mutate(trainingId, {
      onSuccess: () => hapticSuccess()
    });
  };

  let activeSubView: JSX.Element | null = null;

  if (selected) {
    // A 409 on a training the caller is ALREADY booked into is a duplicate-booking;
    // surface a calm "already booked" message instead of a generic conflict.
    const bookingConflict = booking.error instanceof ConflictError;
    const alreadyBooked =
      bookingConflict && (bookedTrainingIds?.has(selected.trainingId) ?? false);

    const errorMessage = alreadyBooked
      ? t("miniapp.schedule.alreadyBooked")
      : booking.isError
        ? resolveErrorMessage(booking.error, t, "miniapp.booking.conflict")
        : undefined;
    const waitlistedPosition =
      booking.data?.status === "waitlisted" ? booking.data.position : null;
    const bookingStatus =
      booking.data?.status === "waitlisted" ? undefined : booking.data?.status;

    activeSubView = (
      <ConfirmView
        slot={selected}
        onConfirm={confirmBooking}
        submitting={booking.isPending}
        succeeded={booking.isSuccess}
        bookingStatus={bookingStatus}
        waitlistedPosition={waitlistedPosition}
        errorMessage={errorMessage}
        onBackToList={backToList}
      />
    );
  }

  return { openConfirm, activeSubView };
}
