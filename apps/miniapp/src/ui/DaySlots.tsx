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
  /**
   * The trainingIds the caller is already actively booked into. A slot in this set is
   * shown non-tappable with a "✓ Вы записаны" badge instead of the book action.
   */
  bookedTrainingIds?: ReadonlySet<string>;
}

/**
 * The slot-list body for one selected day: loading / error / empty states and the
 * date-grouped {@link SlotDayList} of bookable slot cards. Purely presentational — it
 * renders API-decided values (free seats, RSD price) and reports book taps; the caller
 * owns the query and drives the booking write via {@link useSlotBookingFlow}.
 *
 * The feed is bookable-only: the server hides full single slots, and a full group
 * session is auto-queued from the confirm step — so a card never offers a waitlist
 * affordance, the booking flow handles that automatically.
 */
export function DaySlots({
  slots,
  isLoading,
  errorMessage,
  ariaLabel,
  onBook,
  bookedTrainingIds
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
    <SlotDayList
      slots={slots ?? []}
      ariaLabel={ariaLabel}
      onBook={onBook}
      bookedTrainingIds={bookedTrainingIds}
    />
  );
}
