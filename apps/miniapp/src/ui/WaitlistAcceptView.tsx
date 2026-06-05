import { Placeholder } from "@telegram-apps/telegram-ui";
import { useT } from "../i18n/LanguageProvider";
import { useMainButton } from "../tg/buttons";
import { FallbackButton } from "./FallbackButton";
import { Glyph } from "./icons";

interface WaitlistAcceptViewProps {
  /** Run the accept write — POST /waitlist/:id/accept (no body). */
  onAccept: () => void;
  /** True while the accept POST is in flight (drives the MainButton loader). */
  submitting: boolean;
  /** True once the accept succeeded — shows the booked state. */
  accepted: boolean;
  /**
   * True when the accept failed with a recoverable conflict (window expired / seat
   * re-taken / already booked). Distinct from a hard error so the copy reads as a
   * calm "window closed", not "something broke" — and crucially NO booking is shown.
   */
  conflict: boolean;
  /** The 409/error message to surface verbatim; falls back to a localized string. */
  errorMessage?: string;
  /** Leave the accept flow toward Home (also the BackButton target, wired by the screen). */
  onHome: () => void;
}

/**
 * The waitlist-accept screen reached by the `startapp=waitlist_<entryId>` deep
 * link when a seat frees and the bot pushes a promotion notification. ≤2 taps:
 * open → "Подтвердить".
 *
 * No slot card is hydrated (recorded default Q1): there is no read endpoint mapping
 * an entryId to a slot, so the prompt presents the promotion context from the
 * notification ("освободилось место — подтвердите запись") plus the single native
 * MainButton. The confirmed booking is the post-accept detail.
 *
 * Three terminal states, all distinct (a11y: role + text, never color alone):
 *   - prompt   → role="status"; MainButton "Подтвердить" fires {@link onAccept}
 *   - accepted → a success Placeholder (coral tick); MainButton becomes "На главную"
 *   - conflict → a calm "window closed" Placeholder with the server message verbatim
 *                and a path Home; NO booking is rendered (the invariant: accept never
 *                over-books — a re-taken seat surfaces here, never as a booked card).
 *
 * A hard (non-conflict) error reuses the shared ErrorState via the screen; this view
 * owns only the domain states above. Interaction layer only — it calls and renders.
 */
export function WaitlistAcceptView({
  onAccept,
  submitting,
  accepted,
  conflict,
  errorMessage,
  onHome
}: WaitlistAcceptViewProps): JSX.Element {
  const t = useT();
  const terminal = accepted || conflict;

  // One primary action: confirm while open, then "home" once terminal so there is
  // always exactly one MainButton (and the conflict state still has a way forward).
  useMainButton({
    text: terminal ? t("miniapp.waitlist.toHome") : t("miniapp.waitlist.accept"),
    onClick: terminal ? onHome : onAccept,
    isLoading: submitting
  });

  if (accepted) {
    return (
      <div className="screen screen__center" role="status" aria-live="polite">
        <Placeholder
          header={t("miniapp.waitlist.acceptedTitle")}
          description={t("miniapp.waitlist.acceptedBody")}
        >
          <span className="success-badge" aria-hidden="true">
            ✓
          </span>
        </Placeholder>
        <FallbackButton text={t("miniapp.waitlist.toHome")} onClick={onHome} />
      </div>
    );
  }

  if (conflict) {
    return (
      <div className="screen screen__center" role="alert">
        <Placeholder
          header={t("miniapp.waitlist.expiredTitle")}
          description={errorMessage || t("miniapp.waitlist.expiredBody")}
        >
          <span className="waitlist-badge waitlist-badge--muted" aria-hidden="true">
            <Glyph name="waitlist" />
          </span>
        </Placeholder>
        <FallbackButton text={t("miniapp.waitlist.toHome")} onClick={onHome} />
      </div>
    );
  }

  return (
    <div className="screen screen__center" role="status" aria-live="polite" aria-busy={submitting || undefined}>
      <Placeholder
        header={t("miniapp.waitlist.acceptHeader")}
        description={t("miniapp.waitlist.acceptBody")}
      >
        <span className="waitlist-badge" aria-hidden="true">
          <Glyph name="accept" />
        </span>
      </Placeholder>
      <FallbackButton
        text={t("miniapp.waitlist.accept")}
        onClick={onAccept}
        loading={submitting}
      />
    </div>
  );
}
