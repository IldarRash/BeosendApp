import type { BookingStatus, SlotCard as SlotCardData } from "@beosand/types";
import { useT } from "../i18n/LanguageProvider";
import { useMainButton } from "../tg/buttons";
import { FallbackButton } from "./FallbackButton";
import { Glyph } from "./icons";
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
  /**
   * The server-decided status of the created booking, when it succeeded. `pending`
   * means the training's trainer must confirm the request, so the success copy
   * becomes "request sent, awaiting trainer confirmation"; `booked` is an immediate
   * confirmation. The Mini App never decides this — it reflects the API's status.
   */
  bookingStatus?: BookingStatus;
  /**
   * Set once a booking 409 ("full group session") auto-queued the caller onto the
   * waitlist: the returned 1-based queue position. When present the view renders the
   * calm "you're on the waitlist · position N" result instead of the summary or a
   * booked-success state — the user made exactly one decision (tap Book) and the full
   * session queued them automatically.
   */
  waitlistedPosition?: number | null;
  /** A hard (non-409) error message to surface verbatim above the summary, if any. */
  errorMessage?: string;
  /** Return to the browse list (also the BackButton target, wired by the screen). */
  onBackToList: () => void;
}

/**
 * The single-booking confirm step. Uses the handoff `.sumrow` / `.note` structure
 * for the summary rows and a note hint. No money or availability math — every value
 * is the API's.
 *
 * Three terminal states, one native MainButton each:
 *   - summary    → MainButton "Записаться" fires {@link onConfirm}
 *   - booked     → a success `.stateview`; MainButton becomes "back to list"
 *   - waitlisted → a full group session 409'd and the caller was auto-queued; the
 *                  calm "you're on the waitlist · position N" result (NO extra tap —
 *                  the join already fired); MainButton becomes "back to list"
 *
 * A hard (non-409) failure arrives as `errorMessage` and is shown verbatim above the
 * summary so the user can retry.
 */
export function ConfirmView({
  slot,
  onConfirm,
  submitting,
  succeeded,
  bookingStatus,
  waitlistedPosition,
  errorMessage,
  onBackToList
}: ConfirmViewProps): JSX.Element {
  const t = useT();

  // A pending booking is a request awaiting the trainer's confirmation; the server
  // decides this (auto-confirmed to `booked` when the trainer has no Telegram). The
  // Mini App only reflects it in the success copy.
  const isPending = bookingStatus === "pending";
  const waitlisted = waitlistedPosition != null;

  const dateLine = `${t(weekdayFullKey(slot.dayOfWeek))}, ${formatDayMonth(slot.date)}`;
  const timeLine = formatTimeRange(slot.startTime, slot.endTime);
  const priceLine = t("miniapp.browse.price", { price: formatRsd(slot.priceSingleRsd) });
  const seatsLine = t("miniapp.browse.seats", { count: slot.freeSeats });

  const terminal = succeeded || waitlisted;

  useMainButton({
    text: terminal ? t("miniapp.booking.backToList") : t("miniapp.booking.confirm"),
    onClick: terminal ? onBackToList : onConfirm,
    isLoading: submitting
  });

  if (waitlisted) {
    // The full session 409'd and we auto-queued the caller — a calm waitlisted result,
    // never a red error. role="status" so it reads as the expected outcome of Book.
    return (
      <div className="screen" role="status" aria-live="polite">
        <div className="stateview">
          <div className="stateview__ic" aria-hidden="true">
            <Glyph name="waitlist" />
          </div>
          <div className="stateview__title">{t("miniapp.waitlist.autoJoinedTitle")}</div>
          <div className="stateview__sub">{t("miniapp.waitlist.autoJoinedBody")}</div>
          <div className="stateview__sub">{dateLine} · {timeLine}</div>
        </div>
        <div className="note" role="note">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <circle cx="12" cy="12" r="8.5" />
            <path d="M12 11v5M12 8h.01" />
          </svg>
          <span>{t("miniapp.waitlist.autoJoinedPosition", { position: waitlistedPosition })}</span>
        </div>
        <FallbackButton text={t("miniapp.booking.backToList")} onClick={onBackToList} />
      </div>
    );
  }

  if (succeeded) {
    return (
      <div className="screen" role="status" aria-live="polite">
        <div className="stateview">
          <div className="stateview__ic" aria-hidden="true">
            <Glyph name="accept" />
          </div>
          <div className="stateview__title">
            {t(isPending ? "miniapp.booking.pendingTitle" : "miniapp.booking.successTitle")}
          </div>
          {isPending && (
            <div className="stateview__sub">{t("miniapp.booking.pendingBody")}</div>
          )}
          <div className="stateview__sub">{dateLine} · {timeLine}</div>
        </div>
        <FallbackButton text={t("miniapp.booking.backToList")} onClick={onBackToList} />
      </div>
    );
  }

  return (
    <div className="screen" aria-busy={submitting || undefined}>
      {/* Section header */}
      <div className="tg-sech" style={{ padding: "0 0 7px" }}>
        {t("miniapp.booking.confirmHeader")}
      </div>

      {/* Summary rows */}
      <div className="card">
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
          <span className="sumrow__v">{slot.trainerName}</span>
        </div>
        <div className="sumrow">
          <span className="sumrow__k">{t("miniapp.booking.levelLabel")}</span>
          <span className="sumrow__v">{slot.levelName}</span>
        </div>
        <div className="sumrow">
          <span className="sumrow__k">{t("miniapp.booking.seatsLabel")}</span>
          <span className="sumrow__v">{seatsLine}</span>
        </div>
        <div className="sumrow">
          <span className="sumrow__k">{t("miniapp.booking.priceLabel")}</span>
          <span className="sumrow__v sumrow__v--big">{priceLine}</span>
        </div>
      </div>

      {errorMessage && (
        <div className="note" role="alert">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <circle cx="12" cy="12" r="8.5" />
            <path d="M12 8v4M12 16h.01" />
          </svg>
          <span>{errorMessage}</span>
        </div>
      )}

      <FallbackButton
        text={t("miniapp.booking.confirm")}
        onClick={onConfirm}
        loading={submitting}
      />
    </div>
  );
}
