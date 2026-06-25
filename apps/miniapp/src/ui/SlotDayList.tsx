import type { SlotCard as SlotCardData } from "@beosand/types";
import { useT } from "../i18n/LanguageProvider";
import { formatDayMonth, weekdayShortKey } from "./format";
import { SlotCard } from "./SlotCard";

interface DateGroup {
  date: string;
  dayOfWeek: SlotCardData["dayOfWeek"];
  slots: SlotCardData[];
}

/**
 * Group already-sorted slot cards by their `date` for date-headed sections. Pure
 * presentation grouping (no domain math): it preserves the API's order and only
 * buckets consecutive same-date cards. The API owns sort/availability. Shared by the
 * browse and schedule screens so the day-section layout lives in one place.
 */
export function groupByDate(slots: ReadonlyArray<SlotCardData>): DateGroup[] {
  const groups: DateGroup[] = [];
  for (const slot of slots) {
    const last = groups[groups.length - 1];
    if (last && last.date === slot.date) {
      last.slots.push(slot);
    } else {
      groups.push({ date: slot.date, dayOfWeek: slot.dayOfWeek, slots: [slot] });
    }
  }
  return groups;
}

interface SlotDayListProps {
  /** Validated, server-sorted slot cards (only bookable slots). */
  slots: ReadonlyArray<SlotCardData>;
  /** Accessible label for the outer list region (e.g. the screen title). */
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
 * A date-grouped list of {@link SlotCard}s with a flat `.tg-sech` header per day
 * (weekday + date). Purely presentational — it renders API-decided values and
 * reports book taps; the screen owns the queries and the booking write. Shared by any
 * slot list so the grouping/rendering is never duplicated.
 */
export function SlotDayList({
  slots,
  ariaLabel,
  onBook,
  bookedTrainingIds
}: SlotDayListProps): JSX.Element {
  const t = useT();
  const groups = groupByDate(slots);

  return (
    <div role="list" aria-label={ariaLabel}>
      {groups.map((group) => (
        <div key={group.date} role="group">
          <div className="tg-sech">
            {`${t(weekdayShortKey(group.dayOfWeek))} · ${formatDayMonth(group.date)}`}
          </div>
          {group.slots.map((slot) => (
            <SlotCard
              key={slot.trainingId}
              slot={slot}
              onBook={() => onBook(slot)}
              alreadyBooked={bookedTrainingIds?.has(slot.trainingId) ?? false}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
