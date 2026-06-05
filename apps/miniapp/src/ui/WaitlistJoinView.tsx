import type { SlotCard as SlotCardData } from "@beosand/types";
import { useT } from "../i18n/LanguageProvider";
import { useMainButton } from "../tg/buttons";
import { FallbackButton } from "./FallbackButton";
import { Glyph } from "./icons";
import { formatDayMonth, formatTimeRange, weekdayFullKey } from "./format";

interface WaitlistJoinViewProps {
  /**
   * The slot being joined, when known (the Browse full-slot path), so the confirm
   * step can show which session the user is queueing for. The booking-409 offer may
   * omit it (it already showed the slot summary in the ConfirmView) — then the
   * prompt is text-only.
   */
  slot?: SlotCardData;
  /**
   * The booking-409 framing. When true the confirm header reads "the seat was just
   * taken" (an offer to queue) rather than the neutral "Waitlist" header. Purely a
   * copy switch; the action is identical.
   */
  fromConflict?: boolean;
  /** Run the join write (the screen supplies clientId from the cached session). */
  onJoin: () => void;
  /** True while POST /waitlist is in flight (drives the MainButton loader). */
  submitting: boolean;
  /** The validated WaitlistEntry once the join succeeded; null until then. */
  position: number | null;
  /** A join 409/error message to surface verbatim; falls back to a localized string. */
  errorMessage?: string;
  /** Leave the join flow (also the BackButton target, wired by the screen). */
  onDone: () => void;
  /** Label for the post-join "done" action (e.g. "К расписанию"). */
  doneLabelKey: string;
}

/**
 * The shared waitlist-join confirm/result sub-view, used by BOTH entry points so
 * the success/conflict rendering can never drift:
 *   1. the Browse full-slot affordance, and
 *   2. the booking-409 "the seat was just taken — join the waitlist?" offer.
 *
 * Three states, one native MainButton:
 *   - prompt   → MainButton "Встать в лист ожидания" fires {@link onJoin}
 *   - joined   → a success `.stateview` showing the returned waitlist position, and
 *                the MainButton becomes the "done" action (back to the list)
 *   - conflict → the server's 409 message verbatim (already-on-list / now-bookable)
 *                stays beneath the prompt; no fabricated "joined" state.
 *
 * Interaction layer only: it renders the API's `position` and the verbatim server
 * message — no eligibility, ordering, or window math here. Coral lives only on the
 * primary MainButton (native) and the success `.stateview` icon; the conflict notice
 * reuses the prototype `.note` hint (coral icon + text) so it reads as an inline
 * alert, not an error page. State is conveyed by structure + text
 * (role="status"/"alert"), never color alone.
 */
export function WaitlistJoinView({
  slot,
  fromConflict = false,
  onJoin,
  submitting,
  position,
  errorMessage,
  onDone,
  doneLabelKey
}: WaitlistJoinViewProps): JSX.Element {
  const t = useT();
  const joined = position !== null;

  // One primary action: join while pending, then "done" once on the list.
  useMainButton({
    text: joined ? t(doneLabelKey) : t("miniapp.waitlist.joinConfirm"),
    onClick: joined ? onDone : onJoin,
    isLoading: submitting
  });

  if (joined) {
    return (
      <div className="screen" role="status" aria-live="polite">
        <div className="stateview">
          <div className="stateview__ic" aria-hidden="true">
            <Glyph name="waitlist" />
          </div>
          <div className="stateview__title">{t("miniapp.waitlist.joinedTitle")}</div>
          <div className="stateview__sub">{t("miniapp.waitlist.joinedBody")}</div>
        </div>
        <div className="note" role="note">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <circle cx="12" cy="12" r="8.5" />
            <path d="M12 11v5M12 8h.01" />
          </svg>
          <span>{t("miniapp.waitlist.positionLabel", { position })}</span>
        </div>
        <FallbackButton text={t(doneLabelKey)} onClick={onDone} />
      </div>
    );
  }

  const header = fromConflict
    ? t("miniapp.waitlist.joinOfferTitle")
    : t("miniapp.waitlist.joinConfirmHeader");

  const dateLine = slot
    ? `${t(weekdayFullKey(slot.dayOfWeek))}, ${formatDayMonth(slot.date)}`
    : null;
  const timeLine = slot ? formatTimeRange(slot.startTime, slot.endTime) : null;

  return (
    <div className="screen" aria-busy={submitting || undefined}>
      <div className="tg-sech" style={{ padding: "0 0 7px" }}>
        {header}
      </div>

      {slot ? (
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
        </div>
      ) : null}

      <div className="note">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 11v5M12 8h.01" />
        </svg>
        <span>{t("miniapp.waitlist.joinConfirmBody")}</span>
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
        text={t("miniapp.waitlist.joinConfirm")}
        onClick={onJoin}
        loading={submitting}
      />
    </div>
  );
}
