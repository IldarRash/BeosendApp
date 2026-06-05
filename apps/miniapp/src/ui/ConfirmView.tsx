import { Cell, List, Placeholder, Section } from "@telegram-apps/telegram-ui";
import type { SlotCard as SlotCardData } from "@beosand/types";
import { useT } from "../i18n/LanguageProvider";
import { useMainButton } from "../tg/buttons";
import { FallbackButton } from "./FallbackButton";
import {
  formatDayMonth,
  formatRsd,
  formatTimeRange,
  weekdayFullKey
} from "./format";

interface ConfirmViewProps {
  slot: SlotCardData;
  /** Run the booking write (the screen supplies clientId from the cached session). */
  onConfirm: () => void;
  /** True while the booking POST is in flight (drives the MainButton loader). */
  submitting: boolean;
  /** True once the booking succeeded — shows the success state instead of the summary. */
  succeeded: boolean;
  /** A 409/error message to surface verbatim above the summary, if any. */
  errorMessage?: string;
  /** Return to the browse list (also the BackButton target, wired by the screen). */
  onBackToList: () => void;
  /**
   * Offered only when the booking failed with a 409 ("slot filled meanwhile"): switch
   * the primary action to "join the waitlist" for the very slot just attempted, so the
   * user can queue without leaving the flow. Absent in the normal (no-conflict) state.
   */
  onJoinWaitlist?: () => void;
}

/**
 * The single-booking confirm step: a read-only summary of the chosen slot (date,
 * time, trainer, level, free seats, server-computed RSD price) with the native
 * MainButton "Записаться" as the one primary action. No money or availability math
 * — every value is the API's. On success it swaps to a success Placeholder with a
 * path back to Browse; the haptic + list refetch are fired by the screen.
 *
 * A 409 ("slot filled meanwhile") arrives as `errorMessage` and is shown verbatim;
 * the screen refetches the list so the now-full slot drops out. The summary stays
 * visible so the user understands what happened.
 */
export function ConfirmView({
  slot,
  onConfirm,
  submitting,
  succeeded,
  errorMessage,
  onBackToList,
  onJoinWaitlist
}: ConfirmViewProps): JSX.Element {
  const t = useT();

  const dateLine = `${t(weekdayFullKey(slot.dayOfWeek))}, ${formatDayMonth(slot.date)}`;
  const timeLine = formatTimeRange(slot.startTime, slot.endTime);
  const priceLine = t("miniapp.browse.price", { price: formatRsd(slot.priceSingleRsd) });
  const seatsLine = t("miniapp.browse.seats", { count: slot.freeSeats });

  // After a 409 the seat is gone, so the one primary action becomes "join the
  // waitlist" for this slot rather than a retry that would 409 again.
  const offerWaitlist = onJoinWaitlist !== undefined;

  // The MainButton is the booking action while unbooked; after success it becomes a
  // "back to schedule" action, and after a 409 it becomes "join the waitlist" — always
  // exactly one primary affordance.
  useMainButton({
    text: succeeded
      ? t("miniapp.booking.backToList")
      : offerWaitlist
        ? t("miniapp.waitlist.joinConfirm")
        : t("miniapp.booking.confirm"),
    onClick: succeeded ? onBackToList : offerWaitlist ? onJoinWaitlist : onConfirm,
    isLoading: submitting
  });

  if (succeeded) {
    return (
      <div className="screen" role="status" aria-live="polite">
        <Placeholder header={t("miniapp.booking.successTitle")} description={`${dateLine} · ${timeLine}`}>
          <span className="success-badge" aria-hidden="true">
            ✓
          </span>
        </Placeholder>
        <FallbackButton text={t("miniapp.booking.backToList")} onClick={onBackToList} />
      </div>
    );
  }

  return (
    <div className="screen" aria-busy={submitting || undefined}>
      <List>
        <Section header={t("miniapp.booking.confirmHeader")}>
          <Cell subhead={t("miniapp.booking.dateLabel")}>{dateLine}</Cell>
          <Cell subhead={t("miniapp.booking.timeLabel")}>{timeLine}</Cell>
          <Cell subhead={t("miniapp.booking.trainerLabel")}>{slot.trainerName}</Cell>
          <Cell subhead={t("miniapp.booking.levelLabel")}>{slot.levelName}</Cell>
          <Cell subhead={t("miniapp.booking.seatsLabel")}>{seatsLine}</Cell>
          <Cell subhead={t("miniapp.booking.priceLabel")} className="confirm-price">
            {priceLine}
          </Cell>
        </Section>
      </List>

      {errorMessage && (
        <div className="confirm-error" role="alert">
          {errorMessage}
        </div>
      )}

      <FallbackButton
        text={offerWaitlist ? t("miniapp.waitlist.joinConfirm") : t("miniapp.booking.confirm")}
        onClick={offerWaitlist ? onJoinWaitlist! : onConfirm}
        loading={submitting}
      />
    </div>
  );
}
