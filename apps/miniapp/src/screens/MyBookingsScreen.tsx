import { useState } from "react";
import type { MyBookingItem, MyBookingScope } from "@beosand/types";
import { useCancelBooking, useMyBookings } from "../api/hooks";
import { resolveErrorMessage } from "../api/errors";
import { useT } from "../i18n/LanguageProvider";
import { hapticSuccess, hapticWarning } from "../tg/buttons";
import { CancelSheet } from "../ui/CancelSheet";
import { MyBookingsView } from "../ui/MyBookingsView";

interface MyBookingsScreenProps {
  /** Navigate to the Browse schedule (from the empty Upcoming state). */
  onBrowse: () => void;
}

/**
 * The My-bookings journey (S5): a segmented Upcoming|Past list of the caller's own
 * bookings and a cancel-confirm flow. Purely interaction — the server owns the
 * upcoming/past split, the per-item `canCancel` flag, the capacity recompute
 * (`full → open`) and the monthly-batch invariant; this screen only fetches, renders,
 * and calls cancel.
 *
 * The two scopes cache independently (keyed by clientId + scope); switching segments
 * swaps the query, never re-resolving the client. Cancel opens a bottom-sheet confirm
 * (with a warning haptic); a success fires a success haptic, closes the sheet, and the
 * hook's invalidation refetches both scopes so the row leaves Upcoming and appears in
 * Past. A 409 is shown verbatim in the sheet and the list re-syncs `canCancel`.
 */
export function MyBookingsScreen({ onBrowse }: MyBookingsScreenProps): JSX.Element {
  const t = useT();
  const [scope, setScope] = useState<MyBookingScope>("upcoming");
  // The booking being cancelled (drives the confirm sheet); null = closed.
  const [pending, setPending] = useState<MyBookingItem | null>(null);

  const bookings = useMyBookings(scope);
  const cancel = useCancelBooking();

  const listError =
    bookings.error instanceof Error
      ? bookings.error.message
      : bookings.isError
        ? t("miniapp.myBookings.errorBody")
        : undefined;

  const openCancel = (item: MyBookingItem): void => {
    // Opening the destructive confirm: warn haptically and start from a clean
    // mutation state so a prior error/result never leaks into this sheet.
    hapticWarning();
    cancel.reset();
    setPending(item);
  };

  const closeSheet = (open: boolean): void => {
    if (!open && !cancel.isPending) {
      setPending(null);
      cancel.reset();
    }
  };

  const confirmCancel = (): void => {
    if (!pending) {
      return;
    }
    cancel.mutate(pending.bookingId, {
      onSuccess: () => {
        hapticSuccess();
        // The hook invalidates both scopes; close the sheet — the cancelled row
        // leaves Upcoming and reappears in Past on the refetch.
        setPending(null);
      }
    });
  };

  // Prefer the server's 409 message verbatim; fall back to a localized conflict
  // string only when a ConflictError carries no body message. A 403/other error
  // surfaces its message too (the server keeps it generic for a non-owner).
  const cancelError = resolveErrorMessage(cancel.error, t, "miniapp.myBookings.cancelConflict");

  return (
    <>
      <MyBookingsView
        scope={scope}
        onScopeChange={setScope}
        items={bookings.data}
        isLoading={bookings.isLoading}
        errorMessage={listError}
        onCancel={openCancel}
        onBrowse={onBrowse}
      />
      <CancelSheet
        item={pending}
        onOpenChange={closeSheet}
        onConfirm={confirmCancel}
        submitting={cancel.isPending}
        errorMessage={cancelError}
      />
    </>
  );
}
