import { useT } from "../i18n/LanguageProvider";
import { Glyph, type GlyphName } from "./icons";
import { FallbackButton } from "./FallbackButton";

/**
 * Shared non-content states for data lists and action screens:
 * loading, empty, error, and calm (informational / non-error).
 *
 * Uses the handoff `.stateview` / `.spinner` structure. Roles:
 * - LoadingState   — `role="status"` (polite, in-progress)
 * - EmptyState     — `role="status"` (polite, no data)
 * - ErrorState     — `role="alert"` (assertive, actionable failure)
 * - CalmState      — `role="status"` (amber/neutral tone; NOT a red alarm —
 *                    used for "trainer unavailable", "waitlist window closed")
 *
 * Every state is conveyed by text + structure + tone, never color alone.
 */

/** Centered spinner with a caption while a query is in flight. */
export function LoadingState({ labelKey = "miniapp.common.loading" }: { labelKey?: string }): JSX.Element {
  const t = useT();
  return (
    <div className="stateview" role="status" aria-live="polite">
      <div className="spinner" aria-hidden="true" />
      <span className="stateview__sub">{t(labelKey)}</span>
    </div>
  );
}

/**
 * "Nothing matched" — distinct from loading and from an error. An optional action
 * (e.g. "К расписанию" from an empty Upcoming list) renders a FallbackButton.
 * This is not a failure — `role="status"` with polite live region.
 */
export function EmptyState({
  titleKey,
  bodyKey,
  actionKey,
  onAction,
  glyph
}: {
  titleKey: string;
  bodyKey: string;
  actionKey?: string;
  onAction?: () => void;
  /** Optional illustrative glyph; defaults to no icon if omitted. */
  glyph?: GlyphName;
}): JSX.Element {
  const t = useT();
  return (
    <div className="stateview" role="status" aria-live="polite">
      {glyph && (
        <div className="stateview__ic stateview__ic--muted" aria-hidden="true">
          <Glyph name={glyph} />
        </div>
      )}
      <div className="stateview__title">{t(titleKey)}</div>
      <div className="stateview__sub">{t(bodyKey)}</div>
      {actionKey && onAction && (
        <FallbackButton text={t(actionKey)} onClick={onAction} />
      )}
    </div>
  );
}

/**
 * A failed request: the server/contract message verbatim when we have one (e.g. a
 * malformed-response or network error), otherwise a generic fallback. Uses `role="alert"`
 * (assertive) since this IS an error that requires attention. An optional retry
 * affordance is rendered via children.
 */
export function ErrorState({
  message,
  children
}: {
  message?: string;
  children?: JSX.Element;
}): JSX.Element {
  const t = useT();
  return (
    <div className="stateview" role="alert">
      <div className="stateview__ic" aria-hidden="true">
        {/* Coral icon surface signals error */}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 8v4M12 16h.01" />
        </svg>
      </div>
      <div className="stateview__title">{t("miniapp.common.error")}</div>
      <div className="stateview__sub">{message ?? t("miniapp.common.errorBody")}</div>
      {children}
    </div>
  );
}

/**
 * A calm, informational state — NOT a red alarm. Used for situations like
 * "trainer unavailable" or "waitlist window closed" where the outcome is
 * expected and recoverable, not a system failure.
 *
 * Uses amber/neutral tone (`.stateview__ic--calm`) and `role="status"` so
 * screen readers announce it politely, not as an error.
 */
export function CalmState({
  titleKey,
  bodyKey,
  glyph,
  actionKey,
  onAction
}: {
  titleKey: string;
  bodyKey: string;
  /** Illustrative glyph inside the amber chip. */
  glyph?: GlyphName;
  actionKey?: string;
  onAction?: () => void;
}): JSX.Element {
  const t = useT();
  return (
    <div className="stateview" role="status" aria-live="polite">
      {glyph && (
        <div className="stateview__ic stateview__ic--calm" aria-hidden="true">
          <Glyph name={glyph} />
        </div>
      )}
      <div className="stateview__title">{t(titleKey)}</div>
      <div className="stateview__sub">{t(bodyKey)}</div>
      {actionKey && onAction && (
        <FallbackButton text={t(actionKey)} onClick={onAction} />
      )}
    </div>
  );
}
