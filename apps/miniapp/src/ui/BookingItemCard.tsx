import type { BookingStatus, MyBookingItem } from "@beosand/types";
import { useT } from "../i18n/LanguageProvider";
import { Glyph, type GlyphName } from "./icons";
import { formatDayMonth, formatTimeRange, weekdayFullKey } from "./format";

/**
 * The visual treatment of one booking-status chip: which glyph, which i18n label
 * key, and the `.schip--*` CSS variant defined in theme.css.
 * pending → amber/warn (.schip--warn, hourglass: awaiting trainer confirmation),
 * booked → coral (.schip--co), attended → teal/ok (.schip--ok),
 * no_show → amber/warn (.schip--warn), cancelled → muted (.schip--muted).
 * Status is conveyed by glyph + text + tone, never color alone.
 */
interface ChipStyle {
  glyph: GlyphName;
  labelKey: string;
  /** CSS modifier for .schip (co / ok / warn / muted) */
  variant: "co" | "ok" | "warn" | "muted";
}

function chipStyle(status: BookingStatus): ChipStyle {
  switch (status) {
    case "pending":
      return { glyph: "waitlist", labelKey: "miniapp.myBookings.status.pending", variant: "warn" };
    case "attended":
      return { glyph: "attended", labelKey: "miniapp.myBookings.status.attended", variant: "ok" };
    case "no_show":
      return { glyph: "noShow", labelKey: "miniapp.myBookings.status.noShow", variant: "warn" };
    case "cancelled":
      return { glyph: "cancelled", labelKey: "miniapp.myBookings.status.cancelled", variant: "muted" };
    case "booked":
    case "waitlist":
    default:
      return { glyph: "booked", labelKey: "miniapp.myBookings.status.booked", variant: "co" };
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
 * One booking row in the My-bookings list. Uses the handoff `.lrow` /
 * `.lrow__main` / `.lrow__title` / `.lrow__sub` + `.schip--*` structure.
 * Displays ONLY values the API decided — weekday + date, time range, trainer,
 * level, and the booking status/outcome — with no date or status math here.
 *
 * The status chip pairs a glyph with text and a calm tone so the state is never
 * color-only. When the server's `canCancel` flag is set the whole row becomes a
 * button that opens the cancel-confirm sheet, with a trailing `.lrow__chev`
 * affordance; otherwise it is a plain, non-interactive row (no chevron).
 */
export function BookingItemCard({ item, onCancel }: BookingItemCardProps): JSX.Element {
  const t = useT();
  const style = chipStyle(item.bookingStatus);

  const weekday = t(weekdayFullKey(item.dayOfWeek));
  const dayMonth = formatDayMonth(item.date);
  const timeRange = formatTimeRange(item.startTime, item.endTime);
  const statusLabel = t(style.labelKey);

  const rowLabel = `${item.trainingContextLabel}. ${weekday}, ${dayMonth} · ${timeRange}. ${item.trainerName} · ${item.levelName}. ${statusLabel}`;

  const main = (
    <div className="lrow__main">
      <div className="lrow__title">{item.trainingContextLabel}</div>
      <div className="lrow__sub">
        {weekday}, {dayMonth} · {timeRange}
      </div>
      <div className="lrow__sub">{item.trainerName} · {item.levelName}</div>
      <div style={{ marginTop: 6 }}>
        <span className={`schip schip--${style.variant}`}>
          <span className="dot" aria-hidden="true" />
          <Glyph name={style.glyph} />
          {statusLabel}
        </span>
      </div>
    </div>
  );

  if (item.canCancel) {
    return (
      <button
        type="button"
        className="lrow"
        aria-label={`${rowLabel}. ${t("miniapp.myBookings.cancelAria")}`}
        onClick={() => onCancel(item)}
      >
        {main}
        <span className="lrow__chev" aria-hidden="true">
          <Chevron />
        </span>
      </button>
    );
  }

  return (
    <div className="lrow" aria-label={rowLabel}>
      {main}
    </div>
  );
}

/** Trailing disclosure chevron for the `.lrow__chev` slot. */
function Chevron(): JSX.Element {
  return (
    <svg viewBox="0 0 8 14" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M1 1l6 6-6 6"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
