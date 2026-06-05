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
 *   - prompt   → role="status"; a coral `.stateview`; MainButton "Подтвердить" fires {@link onAccept}
 *   - accepted → a success `.stateview` (coral check); MainButton becomes "На главную"
 *   - conflict → a calm `.stateview` ("window closed", amber/neutral tone) with the
 *                server message verbatim and a path Home; announced politely
 *                (role="status"), NOT a red alarm. NO booking is rendered (the
 *                invariant: accept never over-books — a re-taken seat surfaces here,
 *                never as a booked card).
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
        <div className="stateview">
          <div className="stateview__ic" aria-hidden="true">
            <Glyph name="accept" />
          </div>
          <div className="stateview__title">{t("miniapp.waitlist.acceptedTitle")}</div>
          <div className="stateview__sub">{t("miniapp.waitlist.acceptedBody")}</div>
        </div>
        <FallbackButton text={t("miniapp.waitlist.toHome")} onClick={onHome} />
      </div>
    );
  }

  if (conflict) {
    // Calm "window closed" — amber/neutral tone, NOT a red alarm. role="status"
    // (polite) so a re-taken seat reads as an expected outcome, never an error.
    return (
      <div className="screen screen__center" role="status" aria-live="polite">
        <div className="stateview">
          <div className="stateview__ic stateview__ic--calm" aria-hidden="true">
            <Glyph name="waitlist" />
          </div>
          <div className="stateview__title">{t("miniapp.waitlist.expiredTitle")}</div>
          <div className="stateview__sub">{errorMessage || t("miniapp.waitlist.expiredBody")}</div>
        </div>
        <FallbackButton text={t("miniapp.waitlist.toHome")} onClick={onHome} />
      </div>
    );
  }

  return (
    <div className="screen screen__center" role="status" aria-live="polite" aria-busy={submitting || undefined}>
      <div className="stateview">
        <div className="stateview__ic" aria-hidden="true">
          <Glyph name="accept" />
        </div>
        <div className="stateview__title">{t("miniapp.waitlist.acceptHeader")}</div>
        <div className="stateview__sub">{t("miniapp.waitlist.acceptBody")}</div>
      </div>
      <FallbackButton
        text={t("miniapp.waitlist.accept")}
        onClick={onAccept}
        loading={submitting}
      />
    </div>
  );
}
