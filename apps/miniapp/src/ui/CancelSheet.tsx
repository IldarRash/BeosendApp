import { Button, Modal } from "@telegram-apps/telegram-ui";
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
 * The cancel confirm step as a native bottom-sheet Modal: a read-only summary of
 * the booking being cancelled built from the handoff `.sumrow` rows, a `.note`
 * warning line, then a "keep" (plain) and a destructive "cancel the booking"
 * action. The destructive commit is gated here — the row's Cancel affordance only
 * opens this sheet.
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

  const dateLine = item
    ? `${t(weekdayFullKey(item.dayOfWeek))}, ${formatDayMonth(item.date)}`
    : "";
  const timeLine = item ? formatTimeRange(item.startTime, item.endTime) : "";

  return (
    <Modal
      open={item != null}
      onOpenChange={onOpenChange}
      header={<Modal.Header>{t("miniapp.myBookings.cancelConfirmTitle")}</Modal.Header>}
    >
      <div className="cancel-sheet">
        {item && (
          <>
            <div className="card">
              <div className="sumrow">
                <span className="sumrow__k">{t("miniapp.calendar.kindTraining")}</span>
                <span className="sumrow__v">{item.trainingContextLabel}</span>
              </div>
              <div className="sumrow">
                <span className="sumrow__k">{t("miniapp.booking.dateLabel")}</span>
                <span className="sumrow__v">{dateLine}</span>
              </div>
              <div className="sumrow">
                <span className="sumrow__k">{t("miniapp.booking.timeLabel")}</span>
                <span className="sumrow__v">{timeLine}</span>
              </div>
              <div className="sumrow">
                <span className="sumrow__k">{t("miniapp.booking.trainerLabel")}</span>
                <span className="sumrow__v">{item.trainerName}</span>
              </div>
            </div>

            <p className="note">
              <Warning />
              {t("miniapp.myBookings.cancelConfirmBody")}
            </p>
          </>
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

/** Warning glyph for the `.note` line (inherits coral via the `.note svg` rule). */
function Warning(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M12 4.5l8.5 14.5h-17L12 4.5Z"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
      <path d="M12 10v4.2" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
      <circle cx="12" cy="17" r="1" fill="currentColor" />
    </svg>
  );
}
