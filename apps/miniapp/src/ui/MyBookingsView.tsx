import { List, SegmentedControl, Title } from "@telegram-apps/telegram-ui";
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
 * list, with distinct loading / per-scope empty / error states. Purely
 * presentational — it renders API-decided values (the booking status/outcome and the
 * `canCancel` flag) and reports taps; the screen owns the queries and the cancel
 * write. No date or status math here.
 *
 * Coral is reserved for the active segment (theme.css). The control is a real
 * tablist (role/aria-selected) so the active scope is announced, never color-only.
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
      <Title level="1" weight="2">
        {t("miniapp.myBookings.title")}
      </Title>

      <div className="segmented" role="tablist" aria-label={t("miniapp.myBookings.tabsAria")}>
        <SegmentedControl>
          {SCOPES.map(({ scope: value, labelKey }) => (
            <SegmentedControl.Item
              key={value}
              role="tab"
              aria-selected={scope === value}
              selected={scope === value}
              onClick={() => onScopeChange(value)}
            >
              {t(labelKey)}
            </SegmentedControl.Item>
          ))}
        </SegmentedControl>
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
        <List aria-label={t("miniapp.myBookings.title")}>
          {items!.map((item) => (
            <BookingItemCard key={item.bookingId} item={item} onCancel={onCancel} />
          ))}
        </List>
      )}
    </div>
  );
}
