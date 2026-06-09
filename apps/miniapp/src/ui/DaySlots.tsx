import type { SlotCard as SlotCardData } from "@beosand/types";
import { SlotDayList } from "./SlotDayList";
import { EmptyState, ErrorState, LoadingState } from "./StateView";

interface DaySlotsProps {
  /** Validated, server-sorted slot cards for the chosen day (only bookable slots). */
  slots: ReadonlyArray<SlotCardData> | undefined;
  isLoading: boolean;
  /** A request/contract error message to surface verbatim, if any. */
  errorMessage?: string;
  /** Accessible label for the list region (e.g. the chosen day's label). */
  ariaLabel: string;
  /** Open the confirm step for a bookable slot. */
  onBook: (slot: SlotCardData) => void;
  /** Open the waitlist affordance for a full slot. */
  onWaitlist: (slot: SlotCardData) => void;
}

/**
 * The slot-list body for one selected day: loading / error / empty states and the
 * date-grouped {@link SlotDayList} of bookable slot cards. Purely presentational — it
 * renders API-decided values (free seats, RSD price) and reports book/waitlist taps;
 * the caller owns the query and drives the booking write via {@link useSlotBookingFlow}.
 *
 * Extracted from the former Browse screen so the calendar's day-detail view and any
 * other slot list share one rendering of the book/full-slot-waitlist affordances — the
 * full/cancelled-never-bookable invariant lives in {@link SlotCard}/the flow, not here.
 */
export function DaySlots({
  slots,
  isLoading,
  errorMessage,
  ariaLabel,
  onBook,
  onWaitlist
}: DaySlotsProps): JSX.Element {
  const hasSlots = (slots?.length ?? 0) > 0;

  if (isLoading) {
    return <LoadingState />;
  }
  if (errorMessage) {
    return <ErrorState message={errorMessage} />;
  }
  if (!hasSlots) {
    return (
      <EmptyState titleKey="miniapp.schedule.emptyDayTitle" bodyKey="miniapp.schedule.emptyDayBody" />
    );
  }

  return (
    <SlotDayList slots={slots ?? []} ariaLabel={ariaLabel} onBook={onBook} onWaitlist={onWaitlist} />
  );
}
