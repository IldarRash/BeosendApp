import type { SlotCard as SlotCardData } from "@beosand/types";
import { useT } from "../i18n/LanguageProvider";
import {
  formatDayMonth,
  formatRsd,
  formatTimeRange,
  weekdayShortKey
} from "./format";

interface SlotCardProps {
  slot: SlotCardData;
  /** Open this slot's confirm step. The feed is bookable-only, so every card books. */
  onBook: () => void;
  /**
   * True when the caller is already actively booked into this training. The Schedule
   * view still shows the slot but makes it non-tappable with a "✓ Вы записаны" badge
   * instead of the book action — the API owns this fact (via the caller's bookings).
   */
  alreadyBooked?: boolean;
}

/**
 * One bookable training slot. Uses the handoff `.slot` structure so the card
 * matches the design prototype exactly. Displays ONLY values the API decided —
 * weekday + date, time range, trainer, level, free seats, and the server-computed
 * RSD price — with no client-side math.
 *
 * The schedule feed is bookable-only (the server hides full single slots; full group
 * sessions are queued automatically from the confirm step), so a card never offers a
 * waitlist affordance: tapping always opens the booking confirm. The `.avail` badge
 * still carries a text seat count ("3 места"), never color alone, for AT/color-blind users.
 */
export function SlotCard({ slot, onBook, alreadyBooked = false }: SlotCardProps): JSX.Element {
  const t = useT();

  const weekday = t(weekdayShortKey(slot.dayOfWeek));
  const dayMonth = formatDayMonth(slot.date);
  const timeRange = formatTimeRange(slot.startTime, slot.endTime);
  const priceLabel = t("miniapp.browse.price", { price: formatRsd(slot.priceSingleRsd) });
  const seatLabel = t("miniapp.browse.seats", { count: slot.freeSeats });
  const bookedLabel = t("miniapp.schedule.alreadyBooked");

  // Availability class: ≤2 free seats = low (still bookable), else normal.
  const availClass = slot.freeSeats <= 2 ? "avail avail--low" : "avail";

  const body = (
    <>
      <div className="slot__top">
        <div className="slot__when">
          <span className="slot__time">{timeRange}</span>
          <span className="slot__date">
            {weekday}, {dayMonth}
          </span>
        </div>
        <span className={availClass}>{seatLabel}</span>
      </div>

      <div className="slot__group">{slot.trainerName}</div>

      <div className="slot__meta">
        <span>{slot.levelName}</span>
      </div>
    </>
  );

  // Already booked: the slot is shown but NON-tappable — a static `.slot` element with a
  // "✓ Вы записаны" badge in the foot instead of the chevron. A plain div (not a disabled
  // button) so it never traps focus; the badge carries the spoken state.
  if (alreadyBooked) {
    const ariaLabel = `${weekday}, ${dayMonth} · ${timeRange}. ${slot.trainerName} · ${slot.levelName}. ${seatLabel}. ${priceLabel}. ${bookedLabel}`;
    return (
      <div className="slot slot--booked" aria-label={ariaLabel}>
        {body}
        <div className="slot__foot">
          <div className="slot__price">{priceLabel}</div>
          <span className="schip schip--ok">
            <span className="dot" aria-hidden="true" />
            {`✓ ${bookedLabel}`}
          </span>
        </div>
      </div>
    );
  }

  // Accessible name includes all key facts + the action verb so screen readers
  // announce what the tap does, not just the content.
  const ariaLabel = `${weekday}, ${dayMonth} · ${timeRange}. ${slot.trainerName} · ${slot.levelName}. ${seatLabel}. ${priceLabel}. ${t("miniapp.browse.bookAria")}`;

  return (
    <button type="button" className="slot" onClick={onBook} aria-label={ariaLabel}>
      {body}
      <div className="slot__foot">
        <div className="slot__price">{priceLabel}</div>
        <span className="chevron" aria-hidden="true">›</span>
      </div>
    </button>
  );
}
