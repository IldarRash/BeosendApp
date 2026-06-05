import { Cell, List, Placeholder, Section } from "@telegram-apps/telegram-ui";
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
 *   - joined   → a success Placeholder showing the returned waitlist position, and
 *                the MainButton becomes the "done" action (back to the list)
 *   - conflict → the server's 409 message verbatim (already-on-list / now-bookable)
 *                stays beneath the prompt; no fabricated "joined" state.
 *
 * Interaction layer only: it renders the API's `position` and the verbatim server
 * message — no eligibility, ordering, or window math here. Coral lives only on the
 * primary MainButton (native) and the success tick; the conflict notice reuses the
 * `.confirm-error` coral-tint surface so it reads as an inline alert, not an error
 * page. State is conveyed by structure + text (role="status"/"alert"), never color
 * alone.
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
        <Placeholder
          header={t("miniapp.waitlist.joinedTitle")}
          description={t("miniapp.waitlist.joinedBody")}
        >
          <span className="waitlist-badge" aria-hidden="true">
            <Glyph name="waitlist" />
          </span>
        </Placeholder>
        <div className="waitlist-position" role="note">
          {t("miniapp.waitlist.positionLabel", { position })}
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
      <List>
        <Section header={header} footer={t("miniapp.waitlist.joinConfirmBody")}>
          {slot ? (
            <>
              <Cell subhead={t("miniapp.booking.dateLabel")}>{dateLine}</Cell>
              <Cell subhead={t("miniapp.booking.timeLabel")}>{timeLine}</Cell>
              <Cell subhead={t("miniapp.booking.trainerLabel")}>{slot.trainerName}</Cell>
            </>
          ) : null}
        </Section>
      </List>

      {errorMessage && (
        <div className="confirm-error" role="alert">
          {errorMessage}
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
