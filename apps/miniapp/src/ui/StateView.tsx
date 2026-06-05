import { Button, Placeholder, Spinner } from "@telegram-apps/telegram-ui";
import { useT } from "../i18n/LanguageProvider";

/**
 * The three non-content states a data list can be in, as distinct native views so
 * loading, "nothing matched", and "request failed" never collapse into one
 * ambiguous screen. Each is theme-adaptive and announced to assistive tech
 * (`role="status"`, `aria-live="polite"`). Reusable across browse and later list
 * screens (S5/S7) — one place owns the empty/loading/error look.
 */

/** Centered spinner with a caption while a query is in flight. */
export function LoadingState({ labelKey = "miniapp.common.loading" }: { labelKey?: string }): JSX.Element {
  const t = useT();
  return (
    <div className="state-view" role="status" aria-live="polite">
      <Spinner size="l" />
      <span className="muted">{t(labelKey)}</span>
    </div>
  );
}

/**
 * "Nothing matched" — distinct from loading and from an error. An optional action
 * (e.g. "К расписанию" from an empty Upcoming list) renders an in-DOM Button inside
 * the Placeholder; it is navigation, not a submit, so it is NOT the native
 * MainButton (which stays reserved for a screen's primary write action).
 */
export function EmptyState({
  titleKey,
  bodyKey,
  actionKey,
  onAction
}: {
  titleKey: string;
  bodyKey: string;
  actionKey?: string;
  onAction?: () => void;
}): JSX.Element {
  const t = useT();
  return (
    <div className="state-view" role="status" aria-live="polite">
      <Placeholder header={t(titleKey)} description={t(bodyKey)}>
        {actionKey && onAction ? (
          <Button size="m" onClick={onAction}>
            {t(actionKey)}
          </Button>
        ) : undefined}
      </Placeholder>
    </div>
  );
}

/**
 * A failed request: the server/contract message verbatim when we have one (e.g. a
 * malformed-response or network error), otherwise a generic fallback. An optional
 * retry affordance is rendered by the caller's children.
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
    <div className="state-view" role="alert">
      <Placeholder
        header={t("miniapp.common.error")}
        description={message ?? t("miniapp.common.errorBody")}
      >
        {children}
      </Placeholder>
    </div>
  );
}
