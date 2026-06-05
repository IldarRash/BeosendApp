import { Button, Cell, Modal, Section } from "@telegram-apps/telegram-ui";
import type { MyBookingItem } from "@beosand/types";
import { useT } from "../i18n/LanguageProvider";
import { formatDayMonth, formatTimeRange, weekdayFullKey } from "./format";

interface CancelSheetProps {
  /** The booking being cancelled; `null` keeps the sheet closed. */
  item: MyBookingItem | null;
  onOpenChange: (open: boolean) => void;
  /** Run the cancel write for {@link item} (the screen supplies the bookingId). */
  onConfirm: () => void;
  /** True while the cancel POST is in flight (drives the primary button loader). */
  submitting: boolean;
  /** A 409/error message to surface verbatim above the actions, if any. */
  errorMessage?: string;
}

/**
 * The cancel confirm step as a native bottom-sheet Modal (mirroring FilterSheet): a
 * plain read-only summary of the booking being cancelled, a warning line, then a
 * "keep" (plain) and a destructive "cancel the booking" action. The destructive
 * commit is gated here — the row's Cancel affordance only opens this sheet.
 *
 * The warning haptic is fired by the screen on open; the actual write, success, and
 * refetch are owned by the screen via `useCancelBooking`. A 409 (already cancelled /
 * no longer cancellable) arrives as `errorMessage` and is shown verbatim with
 * role="alert". No batch/capacity math here — the server keeps the monthly siblings.
 */
export function CancelSheet({
  item,
  onOpenChange,
  onConfirm,
  submitting,
  errorMessage
}: CancelSheetProps): JSX.Element {
  const t = useT();

  const summary = item
    ? `${t(weekdayFullKey(item.dayOfWeek))}, ${formatDayMonth(item.date)} · ${formatTimeRange(
        item.startTime,
        item.endTime
      )}`
    : "";

  return (
    <Modal
      open={item != null}
      onOpenChange={onOpenChange}
      header={<Modal.Header>{t("miniapp.myBookings.cancelConfirmTitle")}</Modal.Header>}
    >
      <div className="cancel-sheet">
        {item && (
          <Section footer={t("miniapp.myBookings.cancelConfirmBody")}>
            <Cell subhead={t("miniapp.booking.dateLabel")} multiline>
              {summary}
            </Cell>
            <Cell subhead={t("miniapp.booking.trainerLabel")}>{item.trainerName}</Cell>
          </Section>
        )}

        {errorMessage && (
          <div className="confirm-error" role="alert">
            {errorMessage}
          </div>
        )}

        <div className="cancel-sheet__actions">
          <Button size="l" mode="plain" stretched onClick={() => onOpenChange(false)}>
            {t("miniapp.myBookings.cancelKeep")}
          </Button>
          <Button size="l" mode="outline" stretched loading={submitting} onClick={onConfirm}>
            {t("miniapp.myBookings.cancelConfirm")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
