import type { SlotCard as SlotCardData } from "@beosand/types";
import { useT } from "../i18n/LanguageProvider";
import { Glyph } from "./icons";
import {
  formatDayMonth,
  formatRsd,
  formatTimeRange,
  weekdayShortKey
} from "./format";

interface SlotCardProps {
  slot: SlotCardData;
  /**
   * Open this slot's confirm step. Present only when the slot is bookable
   * (`freeSeats > 0`); a full slot exposes {@link onWaitlist} instead, never Book.
   */
  onBook?: () => void;
  /**
   * Open the waitlist affordance (S6 seam). Present only when the slot is NOT
   * bookable (`freeSeats === 0`), so a full card never offers a normal booking.
   */
  onWaitlist?: () => void;
}

/**
 * One bookable training slot. Uses the handoff `.slot` structure so the card
 * matches the design prototype exactly. Displays ONLY values the API decided —
 * weekday + date, time range, group, trainer, level, free seats, and the
 * server-computed RSD price — with no client-side math.
 *
 * Free/full state is never conveyed by color alone: the `.avail` badge carries
 * a text count ("3 места" / "Нет мест") and the card's action (Book vs. Waitlist)
 * differs, so assistive tech and color-blind users get the state from text + structure.
 */
export function SlotCard({ slot, onBook, onWaitlist }: SlotCardProps): JSX.Element {
  const t = useT();
  const bookable = slot.freeSeats > 0;

  const weekday = t(weekdayShortKey(slot.dayOfWeek));
  const dayMonth = formatDayMonth(slot.date);
  const timeRange = formatTimeRange(slot.startTime, slot.endTime);
  const priceLabel = t("miniapp.browse.price", { price: formatRsd(slot.priceSingleRsd) });

  const seatLabel = bookable
    ? t("miniapp.browse.seats", { count: slot.freeSeats })
    : t("miniapp.browse.seatsNone");

  // Accessible name includes all key facts + the action verb so screen readers
  // announce what the tap does, not just the content.
  const ariaAction = bookable ? t("miniapp.browse.bookAria") : t("miniapp.browse.waitlistAria");
  const ariaLabel = `${weekday}, ${dayMonth} · ${timeRange}. ${slot.trainerName} · ${slot.levelName}. ${seatLabel}. ${priceLabel}. ${ariaAction}`;

  // Availability class: free (≤2 = low, else normal), or none.
  let availClass = "avail";
  if (!bookable) {
    availClass = "avail avail--none";
  } else if (slot.freeSeats <= 2) {
    availClass = "avail avail--low";
  }

  return (
    <button
      type="button"
      className="slot"
      onClick={bookable ? onBook : onWaitlist}
      aria-label={ariaLabel}
    >
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

      <div className="slot__foot">
        <div className="slot__price">
          {priceLabel}
        </div>
        {bookable ? (
          <span className="chevron" aria-hidden="true">›</span>
        ) : (
          <span className="slot-card__waitlist-pill">
            <Glyph name="waitlist" />
            {t("miniapp.browse.waitlist")}
          </span>
        )}
      </div>
    </button>
  );
}
