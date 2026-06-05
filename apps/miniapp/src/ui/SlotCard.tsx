import { Cell } from "@telegram-apps/telegram-ui";
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
 * One bookable training slot, rendered as a native telegram-ui Cell so it reads as
 * a tappable list row in either theme. The card displays ONLY values the API
 * decided — weekday + date, time range, trainer, level, free seats, and the
 * server-computed RSD price — with no client-side math.
 *
 * Free/full state is never conveyed by color alone: the seat badge carries a text
 * count ("3 места" / "Нет мест") and the card's action (Book vs. Waitlist) differs,
 * so assistive tech and color-blind users get the state from text + structure. A
 * full card (`freeSeats === 0`, defensive — the endpoint returns only bookable
 * slots) shows the waitlist pill, never the coral Book chevron.
 */
export function SlotCard({ slot, onBook, onWaitlist }: SlotCardProps): JSX.Element {
  const t = useT();
  const bookable = slot.freeSeats > 0;

  const title = `${t(weekdayShortKey(slot.dayOfWeek))}, ${formatDayMonth(slot.date)} · ${formatTimeRange(
    slot.startTime,
    slot.endTime
  )}`;
  const subtitle = `${slot.trainerName} · ${slot.levelName}`;

  const seatLabel = bookable
    ? t("miniapp.browse.seats", { count: slot.freeSeats })
    : t("miniapp.browse.seatsNone");
  const priceLabel = t("miniapp.browse.price", { price: formatRsd(slot.priceSingleRsd) });

  // The card label is the accessible name; the action verb is appended so the
  // tap target announces what it does (book vs. join the waitlist), not just the time.
  const ariaAction = bookable ? t("miniapp.browse.bookAria") : t("miniapp.browse.waitlistAria");

  return (
    <Cell
      Component="button"
      type="button"
      className="slot-card"
      multiline
      onClick={bookable ? onBook : onWaitlist}
      aria-label={`${title}. ${subtitle}. ${seatLabel}. ${priceLabel}. ${ariaAction}`}
      subtitle={subtitle}
      after={
        bookable ? (
          <span className="chevron" aria-hidden="true">
            ›
          </span>
        ) : (
          <span className="slot-card__waitlist-pill">
            <Glyph name="waitlist" />
            {t("miniapp.browse.waitlist")}
          </span>
        )
      }
      description={
        <span className="slot-card__meta">
          <span
            className={bookable ? "slot-badge slot-badge--free" : "slot-badge slot-badge--full"}
          >
            {seatLabel}
          </span>
          <span className="slot-price-chip">{priceLabel}</span>
        </span>
      }
    >
      {title}
    </Cell>
  );
}
