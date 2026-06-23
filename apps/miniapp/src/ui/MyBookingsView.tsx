import type { MyBookingItem, MyBookingScope, WaitlistAdminItem } from "@beosand/types";
import { useT } from "../i18n/LanguageProvider";
import { BookingItemCard } from "./BookingItemCard";
import { EmptyState, ErrorState, LoadingState } from "./StateView";
import { dayOfWeekFromDate, formatDayMonth, formatTimeRange, weekdayFullKey } from "./format";

interface MyBookingsViewProps {
  scope: MyBookingScope;
  onScopeChange: (scope: MyBookingScope) => void;
  /** Validated booking items from `GET /bookings/mine` for the active scope. */
  items: ReadonlyArray<MyBookingItem> | undefined;
  /**
   * The caller's active waitlist entries from `GET /waitlist/mine`, rendered in a
   * separate section below the booked items. Undefined on the Past scope (queued
   * dates are forward-looking) and while it loads — the section then simply omits.
   */
  waitlist?: ReadonlyArray<WaitlistAdminItem>;
  isLoading: boolean;
  /** A request/contract error message to surface verbatim, if any. */
  errorMessage?: string;
  /** Open the cancel confirm for a cancellable item (server `canCancel` only). */
  onCancel: (item: MyBookingItem) => void;
  /** Path from the empty Upcoming state to the Browse schedule. */
  onBrowse: () => void;
}

/** The two scopes in display order; Upcoming is the default segment. */
const SCOPES: ReadonlyArray<{ scope: MyBookingScope; labelKey: string }> = [
  { scope: "upcoming", labelKey: "miniapp.myBookings.tabUpcoming" },
  { scope: "past", labelKey: "miniapp.myBookings.tabPast" }
];

/**
 * The My-bookings screen body: a segmented Upcoming|Past control over the booking
 * list, with distinct loading / per-scope empty / error states. Uses the handoff
 * `.seg` / `.seg button.is-on` structure instead of telegram-ui SegmentedControl.
 *
 * Accessibility: the control uses `role="tablist"` with `aria-selected` on each
 * tab so the active scope is announced to AT — never color-only.
 */
export function MyBookingsView({
  scope,
  onScopeChange,
  items,
  waitlist,
  isLoading,
  errorMessage,
  onCancel,
  onBrowse
}: MyBookingsViewProps): JSX.Element {
  const t = useT();
  const isUpcoming = scope === "upcoming";
  const hasBookings = (items?.length ?? 0) > 0;
  const hasWaitlist = (waitlist?.length ?? 0) > 0;

  return (
    <div className="screen screen--no-mainbutton">
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, letterSpacing: -0.4 }}>
        {t("miniapp.myBookings.title")}
      </h1>

      {/* Segmented tab control */}
      <div
        className="seg"
        role="tablist"
        aria-label={t("miniapp.myBookings.tabsAria")}
      >
        {SCOPES.map(({ scope: value, labelKey }) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={scope === value}
            className={scope === value ? "is-on" : undefined}
            onClick={() => onScopeChange(value)}
          >
            {t(labelKey)}
          </button>
        ))}
      </div>

      {isLoading ? (
        <LoadingState />
      ) : errorMessage ? (
        <ErrorState message={errorMessage} />
      ) : !hasBookings && !hasWaitlist ? (
        isUpcoming ? (
          <EmptyState
            titleKey="miniapp.myBookings.emptyUpcomingTitle"
            bodyKey="miniapp.myBookings.emptyUpcomingBody"
            actionKey="miniapp.myBookings.toBrowse"
            onAction={onBrowse}
          />
        ) : (
          <EmptyState
            titleKey="miniapp.myBookings.emptyPastTitle"
            bodyKey="miniapp.myBookings.emptyPastBody"
          />
        )
      ) : (
        <>
          {hasBookings && (
            <div
              className="card"
              aria-label={t("miniapp.myBookings.title")}
              role="list"
            >
              {items!.map((item) => (
                <div key={item.bookingId} role="listitem">
                  <BookingItemCard item={item} onCancel={onCancel} />
                </div>
              ))}
            </div>
          )}
          {hasWaitlist && <WaitlistSection items={waitlist!} />}
        </>
      )}
    </div>
  );
}

/**
 * The caller's queued (waitlisted) dates, in a clearly-separated section below the
 * booked items. Each row shows the training's weekday + date + time and the
 * server-assigned queue position — all display-only values; the Mini App does no
 * date or queue math. Rendered only when the server returned at least one entry.
 */
function WaitlistSection({ items }: { items: ReadonlyArray<WaitlistAdminItem> }): JSX.Element {
  const t = useT();
  return (
    <section aria-label={t("miniapp.myBookings.waitlistTitle")}>
      <div className="tg-sech">{t("miniapp.myBookings.waitlistTitle")}</div>
      <div className="card" role="list">
        {items.map((item) => (
          <div key={item.id} className="lrow" role="listitem">
            <div className="lrow__main">
              <div className="lrow__title">
                {t(weekdayFullKey(dayOfWeekFromDate(item.date)))}, {formatDayMonth(item.date)} ·{" "}
                {formatTimeRange(item.startTime, item.endTime)}
              </div>
              <div className="lrow__sub">
                {t("miniapp.myBookings.waitlistPosition", { position: item.position })}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
