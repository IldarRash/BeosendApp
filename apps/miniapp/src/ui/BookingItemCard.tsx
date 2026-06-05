import { Cell } from "@telegram-apps/telegram-ui";
import type { BookingStatus, MyBookingItem } from "@beosand/types";
import { useT } from "../i18n/LanguageProvider";
import { Glyph, type GlyphName } from "./icons";
import { formatDayMonth, formatTimeRange, weekdayFullKey } from "./format";

/**
 * The visual treatment of one booking-status chip: which glyph, which i18n label
 * key, and the CSS variant (the tone defined in theme.css). The status is conveyed
 * by glyph + text + tone together, never color alone. `booked` is the one branded
 * chip (upcoming); the past outcomes are deliberately calm — a finished session is
 * a neutral fact, not an alert.
 */
interface ChipStyle {
  glyph: GlyphName;
  labelKey: string;
  variant: string;
}

/**
 * Map the server's {@link BookingStatus} to its chip style. `waitlist` is not a
 * `/bookings/mine` outcome but is handled defensively (falls back to the booked
 * treatment) so an unexpected value never renders an untyped chip. The Mini App
 * makes no decision here — it only renders the status the server already decided.
 */
function chipStyle(status: BookingStatus): ChipStyle {
  switch (status) {
    case "attended":
      return { glyph: "attended", labelKey: "miniapp.myBookings.status.attended", variant: "attended" };
    case "no_show":
      return { glyph: "noShow", labelKey: "miniapp.myBookings.status.noShow", variant: "noShow" };
    case "cancelled":
      return { glyph: "cancelled", labelKey: "miniapp.myBookings.status.cancelled", variant: "cancelled" };
    case "booked":
    case "waitlist":
    default:
      return { glyph: "booked", labelKey: "miniapp.myBookings.status.booked", variant: "booked" };
  }
}

interface BookingItemCardProps {
  item: MyBookingItem;
  /**
   * Open the cancel confirm step for this booking. Rendered as the trailing control
   * ONLY when {@link MyBookingItem.canCancel} is true — the server flag is the sole
   * gate; the Mini App never infers cancellability from date/status.
   */
  onCancel: (item: MyBookingItem) => void;
}

/**
 * One booking row in the My-bookings list, rendered as a native telegram-ui Cell so
 * it reads as a list item in either theme. It displays ONLY values the API decided —
 * weekday + date, time range, trainer, level, and the booking status/outcome — with
 * no date or status math here.
 *
 * The status chip pairs a glyph with text and a calm tone (theme.css) so the state
 * is never color-only. The destructive Cancel control appears only when the server's
 * `canCancel` flag is set; tapping it opens the confirm sheet (the write is gated
 * there), so the row itself is not a tap target.
 */
export function BookingItemCard({ item, onCancel }: BookingItemCardProps): JSX.Element {
  const t = useT();
  const style = chipStyle(item.bookingStatus);

  const title = `${t(weekdayFullKey(item.dayOfWeek))}, ${formatDayMonth(item.date)} · ${formatTimeRange(
    item.startTime,
    item.endTime
  )}`;
  const subtitle = `${item.trainerName} · ${item.levelName}`;
  const statusLabel = t(style.labelKey);

  return (
    <Cell
      className="booking-card"
      multiline
      aria-label={`${title}. ${subtitle}. ${statusLabel}`}
      subtitle={subtitle}
      after={
        item.canCancel ? (
          <button
            type="button"
            className="booking-cancel"
            aria-label={t("miniapp.myBookings.cancelAria")}
            onClick={() => onCancel(item)}
          >
            {t("miniapp.myBookings.cancel")}
          </button>
        ) : undefined
      }
      description={
        <span className="booking-card__meta">
          <span className={`booking-chip booking-chip--${style.variant}`}>
            <Glyph name={style.glyph} />
            {statusLabel}
          </span>
        </span>
      }
    >
      {title}
    </Cell>
  );
}
