import type { MyBookingItem, MyBookingScope } from "@beosand/types";
import { useT } from "../i18n/LanguageProvider";
import { BookingItemCard } from "./BookingItemCard";
import { EmptyState, ErrorState, LoadingState } from "./StateView";

interface MyBookingsViewProps {
  scope: MyBookingScope;
  onScopeChange: (scope: MyBookingScope) => void;
  /** Validated booking items from `GET /bookings/mine` for the active scope. */
  items: ReadonlyArray<MyBookingItem> | undefined;
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
  isLoading,
  errorMessage,
  onCancel,
  onBrowse
}: MyBookingsViewProps): JSX.Element {
  const t = useT();
  const isUpcoming = scope === "upcoming";

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
      ) : (items?.length ?? 0) === 0 ? (
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
    </div>
  );
}
