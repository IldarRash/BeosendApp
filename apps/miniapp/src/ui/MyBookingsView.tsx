import type { MyBookingItem, MyBookingScope, WaitlistAdminItem } from "@beosand/types";
import { useT } from "../i18n/LanguageProvider";
import { BookingItemCard } from "./BookingItemCard";
import { partitionUpcoming, type SubscriptionGroup } from "./my-bookings-group";
import { EmptyState, ErrorState, LoadingState } from "./StateView";
import { dayOfWeekFromDate, formatDayMonth, formatTimeRange, weekdayFullKey } from "./format";

interface MyBookingsViewProps {
  scope: MyBookingScope;
  onScopeChange: (scope: MyBookingScope) => void;
  /** Validated booking items from `GET /bookings/mine` for the active scope. */
  items: ReadonlyArray<MyBookingItem> | undefined;
  /**
   * The caller's active waitlist entries from `GET /waitlist/mine`. On the Upcoming
   * scope a subscription's queued dates are folded INTO its card (matched by
   * `groupSubscriptionId`); queue entries with a null subscription id render as a
   * standalone section. Undefined on the Past scope and while it loads — the section
   * then simply omits (it is supplementary; its fetch failing must not block bookings).
   */
  waitlist?: ReadonlyArray<WaitlistAdminItem>;
  isLoading: boolean;
  /** A request/contract error message to surface verbatim, if any. */
  errorMessage?: string;
  /** Open the shared training detail for a booking row. */
  onOpenBooking: (item: MyBookingItem) => void;
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
 * On the Upcoming tab a monthly subscription's dates are grouped into ONE card that
 * shows the booked dates AND the waitlisted dates together (matched by
 * `groupSubscriptionId`). Standalone single bookings and standalone queue entries
 * render as before. Accessibility: the segmented control uses `role="tablist"` with
 * `aria-selected` so the active scope is announced to AT — never color-only.
 */
export function MyBookingsView({
  scope,
  onScopeChange,
  items,
  waitlist,
  isLoading,
  errorMessage,
  onOpenBooking,
  onBrowse
}: MyBookingsViewProps): JSX.Element {
  const t = useT();
  const isUpcoming = scope === "upcoming";

  // Only Upcoming folds the waitlist into subscription cards; Past renders bookings flat.
  const partition = isUpcoming
    ? partitionUpcoming(items ?? [], waitlist ?? [])
    : null;

  // Upcoming is empty only when there is no booking AND no queued date of any kind;
  // Past is empty purely on bookings (it never folds the waitlist).
  const isEmpty = isUpcoming
    ? (partition!.subscriptions.length === 0 &&
        partition!.standalone.length === 0 &&
        partition!.standaloneWaitlist.length === 0)
    : (items?.length ?? 0) === 0;

  return (
    <div className="screen screen--no-mainbutton">
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, letterSpacing: -0.4 }}>
        {t("miniapp.myBookings.title")}
      </h1>

      {/* Segmented tab control */}
      <div className="seg" role="tablist" aria-label={t("miniapp.myBookings.tabsAria")}>
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
      ) : isEmpty ? (
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
      ) : isUpcoming && partition ? (
        <UpcomingList partition={partition} onOpenBooking={onOpenBooking} />
      ) : (
        <FlatBookingList items={items ?? []} onOpenBooking={onOpenBooking} />
      )}
    </div>
  );
}

/**
 * The Upcoming body: subscription cards first (booked + queued dates together), then
 * the standalone single bookings, then any standalone queue entries (booking-race
 * single-training path). Each block omits when empty.
 */
function UpcomingList({
  partition,
  onOpenBooking
}: {
  partition: ReturnType<typeof partitionUpcoming>;
  onOpenBooking: (item: MyBookingItem) => void;
}): JSX.Element {
  const t = useT();
  return (
    <>
      {partition.subscriptions.map((group) => (
        <SubscriptionCard key={group.groupSubscriptionId} group={group} onOpenBooking={onOpenBooking} />
      ))}

      {partition.standalone.length > 0 && (
        <div className="card" aria-label={t("miniapp.myBookings.title")} role="list">
          {partition.standalone.map((item) => (
            <div key={item.bookingId} role="listitem">
              <BookingItemCard item={item} onOpen={onOpenBooking} />
            </div>
          ))}
        </div>
      )}

      {partition.standaloneWaitlist.length > 0 && (
        <WaitlistSection items={partition.standaloneWaitlist} />
      )}
    </>
  );
}

/** The Past body: a flat list of booking rows (no subscription/waitlist grouping). */
function FlatBookingList({
  items,
  onOpenBooking
}: {
  items: ReadonlyArray<MyBookingItem>;
  onOpenBooking: (item: MyBookingItem) => void;
}): JSX.Element {
  const t = useT();
  return (
    <div className="card" aria-label={t("miniapp.myBookings.title")} role="list">
      {items.map((item) => (
        <div key={item.bookingId} role="listitem">
          <BookingItemCard item={item} onOpen={onOpenBooking} />
        </div>
      ))}
    </div>
  );
}

/**
 * One monthly subscription on the Upcoming tab: a header with the group name and a
 * date-count summary, then the booked date rows (each cancellable per the server's
 * `canCancel`) and, when the month had full dates, the waitlisted dates with their
 * queue position. The Mini App does no date/queue math — it renders the server's rows.
 */
function SubscriptionCard({
  group,
  onOpenBooking
}: {
  group: SubscriptionGroup;
  onOpenBooking: (item: MyBookingItem) => void;
}): JSX.Element {
  const t = useT();

  // The group label: the waitlist rows carry a groupName; fall back to the booked
  // rows' server-provided training context label when only bookings are present.
  const groupName =
    group.waitlisted.find((entry) => entry.groupName)?.groupName ??
    group.bookings[0]?.trainingContextLabel ??
    t("miniapp.myBookings.subscription.title");

  const summary = t("miniapp.myBookings.subscription.summary", {
    booked: group.bookings.length,
    waitlisted: group.waitlisted.length
  });

  return (
    <section aria-label={groupName}>
      <div className="tg-sech">{groupName}</div>
      <div className="card" role="list">
        <div className="lrow" aria-hidden="true">
          <div className="lrow__main">
            <div className="lrow__sub">{summary}</div>
          </div>
        </div>

        {group.bookings.map((item) => (
          <div key={item.bookingId} role="listitem">
            <BookingItemCard item={item} onOpen={onOpenBooking} />
          </div>
        ))}

        {group.waitlisted.map((entry) => (
          <WaitlistRow key={entry.id} entry={entry} />
        ))}
      </div>
    </section>
  );
}

/**
 * The caller's standalone queued dates (booking-race single-training path), in a
 * clearly-separated section below the booked items. Each row shows the training's
 * weekday + date + time and the server-assigned queue position — all display-only.
 */
function WaitlistSection({ items }: { items: ReadonlyArray<WaitlistAdminItem> }): JSX.Element {
  const t = useT();
  return (
    <section aria-label={t("miniapp.myBookings.waitlistTitle")}>
      <div className="tg-sech">{t("miniapp.myBookings.waitlistTitle")}</div>
      <div className="card" role="list">
        {items.map((entry) => (
          <WaitlistRow key={entry.id} entry={entry} />
        ))}
      </div>
    </section>
  );
}

/** One waitlisted date: weekday/date · time and the server-assigned queue position. */
function WaitlistRow({ entry }: { entry: WaitlistAdminItem }): JSX.Element {
  const t = useT();
  return (
    <div className="lrow" role="listitem">
      <div className="lrow__main">
        <div className="lrow__title">
          {t(weekdayFullKey(dayOfWeekFromDate(entry.date)))}, {formatDayMonth(entry.date)} ·{" "}
          {formatTimeRange(entry.startTime, entry.endTime)}
        </div>
        <div className="lrow__sub">
          {t("miniapp.myBookings.waitlistPosition", { position: entry.position })}
        </div>
      </div>
    </div>
  );
}
