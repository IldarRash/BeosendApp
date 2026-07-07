import { useRef, useState } from "react";
import type { Locale, NotificationTemplate, NotificationTemplateKey } from "@beosand/types";
import { LOCALES, localeLabel } from "@beosand/i18n";
import { AppShell } from "../ui/AppShell";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import { useToast } from "../ui/Toast";
import { useLanguage } from "../i18n/LanguageProvider";
import {
  useNotificationTemplates,
  useResetNotificationTemplate,
  useUpdateNotificationTemplate
} from "../hooks/useNotificationTemplates";

/**
 * Шаблоны уведомлений — the owner edits the notification texts per locale (e.g.
 * booking confirmation) and inserts `{placeholders}` for request details. Templates
 * are split by audience (client- vs staff-facing). No domain logic here: the page
 * renders the validated server rows for the selected locale, collects an override
 * body, and shows a presentation-only preview by substituting sample values for the
 * placeholders. The server owns validation, the defaults, and the real interpolation.
 */
export function NotificationTemplates(): JSX.Element {
  const { t, locale: uiLocale } = useLanguage();
  // The locale being *edited* — independent of the admin's UI language. Defaults to
  // the active UI locale so the editor opens on what the admin is already reading.
  const [locale, setLocale] = useState<Locale>(uiLocale);
  const templates = useNotificationTemplates(locale);

  const rows = templates.data ?? [];
  const clientRows = rows.filter((row) => row.audience === "client");
  const staffRows = rows.filter((row) => row.audience === "staff");

  return (
    <AppShell>
      <header className="page-head">
        <div>
          <h1>{t("admin.notificationTemplates.title")}</h1>
          <p>{t("admin.notificationTemplates.lead")}</p>
        </div>
      </header>

      <div className="workspace">
        <div className="workspace__bar">
          <div
            role="tablist"
            aria-label={t("admin.notificationTemplates.localeLabel")}
            className="tabs"
          >
            {LOCALES.map((value) => {
              const selected = value === locale;
              return (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  id={`tpl-locale-${value}`}
                  aria-selected={selected}
                  aria-controls="tpl-panel"
                  className={selected ? "tab tab--active" : "tab"}
                  onClick={() => setLocale(value)}
                >
                  {localeLabel[value]}
                </button>
              );
            })}
          </div>
        </div>

        <div
          id="tpl-panel"
          role="tabpanel"
          aria-labelledby={`tpl-locale-${locale}`}
          className="workspace__body"
        >
          {templates.isLoading ? (
            <p className="state state--loading">{t("admin.notificationTemplates.loading")}</p>
          ) : templates.isError ? (
            <p className="state state--error" role="alert">
              {t("admin.notificationTemplates.error", { message: templates.error.message })}
            </p>
          ) : rows.length === 0 ? (
            <p className="state">{t("admin.notificationTemplates.empty")}</p>
          ) : (
            <div className="stack">
              <TemplateSection
                heading={t("admin.notificationTemplates.sectionClient")}
                rows={clientRows}
                locale={locale}
              />
              <TemplateSection
                heading={t("admin.notificationTemplates.sectionStaff")}
                rows={staffRows}
                locale={locale}
              />
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

interface TemplateSectionProps {
  heading: string;
  rows: NotificationTemplate[];
  locale: Locale;
}

/** One audience group of template cards under a labelled heading. */
function TemplateSection({ heading, rows, locale }: TemplateSectionProps): JSX.Element | null {
  if (rows.length === 0) return null;
  return (
    <section className="stack" aria-label={heading}>
      <h2 className="tpl-section__title">{heading}</h2>
      <ul className="tpl-list">
        {rows.map((template) => (
          <li key={template.eventKey}>
            <TemplateCard template={template} locale={locale} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Sample values used only to render the live preview — not domain math, just display. */
const PREVIEW_SAMPLES: Record<string, string> = {
  "{training}": "03.06 18:00–19:30 · Начинающий · Милена",
  "{date}": "03.06",
  "{startTime}": "18:00",
  "{endTime}": "19:30",
  "{levelName}": "Начинающий",
  "{trainerName}": "Милена",
  "{windowMinutes}": "15",
  "{position}": "2",
  "{clientName}": "Анна",
  "{clientTelegramId}": "123456789",
  "{courtLabel}": "Корт 3",
  "{priceRsd}": "2400",
  "{durationHours}": "2",
  "{courtCount}": "1"
};

/**
 * Substitute each known placeholder with a sample value for the preview. Unknown
 * `{tokens}` are left literal, mirroring the server interpolator. Presentation only.
 */
function renderPreview(body: string): string {
  let out = body;
  for (const [token, sample] of Object.entries(PREVIEW_SAMPLES)) {
    out = out.split(token).join(sample);
  }
  return out;
}

interface TemplateCardProps {
  template: NotificationTemplate;
  locale: Locale;
}

/** One template row: human label, override badge, editable body, placeholder chips, preview. */
function TemplateCard({ template, locale }: TemplateCardProps): JSX.Element {
  const t = useLanguage().t;
  const toast = useToast();
  const update = useUpdateNotificationTemplate();
  const reset = useResetNotificationTemplate();

  const [body, setBody] = useState(template.body);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const trimmed = body.trim();
  const dirty = body !== template.body;
  const canSave = dirty && trimmed.length > 0 && !update.isPending;
  const error = update.error ?? reset.error;

  /** Insert a placeholder token at the caret (or replacing the selection). */
  function insertPlaceholder(token: string): void {
    const el = textareaRef.current;
    if (!el) {
      setBody((prev) => prev + token);
      return;
    }
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    const next = body.slice(0, start) + token + body.slice(end);
    setBody(next);
    // Restore focus and place the caret just after the inserted token.
    requestAnimationFrame(() => {
      el.focus();
      const caret = start + token.length;
      el.setSelectionRange(caret, caret);
    });
  }

  function handleSave(): void {
    if (!canSave) return;
    update.mutate(
      { eventKey: template.eventKey, locale, body: trimmed },
      {
        onSuccess: () => toast.notify(t("admin.notificationTemplates.saved"), "success")
      }
    );
  }

  function handleReset(): void {
    reset.mutate(
      { eventKey: template.eventKey, locale },
      {
        onSuccess: (row) => {
          setBody(row.body);
          setConfirmingReset(false);
          toast.notify(t("admin.notificationTemplates.resetDone"), "success");
        }
      }
    );
  }

  const eventLabel = t(`admin.notificationTemplates.event.${template.eventKey}`);
  const fieldId = `tpl-body-${template.eventKey}`;

  return (
    <article className="card tpl-card">
      <div className="tpl-card__head">
        <div className="tpl-card__heading">
          <h3 className="tpl-card__title">{eventLabel}</h3>
          <code className="tpl-card__key">{template.eventKey}</code>
        </div>
        <span
          className={template.isOverridden ? "tag tag--coral" : "tag tag--muted"}
          title={
            template.isOverridden
              ? t("admin.notificationTemplates.overriddenHint")
              : t("admin.notificationTemplates.defaultHint")
          }
        >
          {template.isOverridden
            ? t("admin.notificationTemplates.overridden")
            : t("admin.notificationTemplates.usingDefault")}
        </span>
      </div>

      <div className="field">
        <label className="field__label" htmlFor={fieldId}>
          {t("admin.notificationTemplates.bodyLabel")}
        </label>
        <textarea
          id={fieldId}
          ref={textareaRef}
          className="input tpl-card__textarea"
          rows={4}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          aria-describedby={`${fieldId}-hint`}
        />
        <span id={`${fieldId}-hint`} className="field__hint">
          {t("admin.notificationTemplates.bodyHint")}
        </span>
      </div>

      <div className="tpl-chips" aria-label={t("admin.notificationTemplates.placeholdersLabel")}>
        <span className="tpl-chips__label">{t("admin.notificationTemplates.placeholdersLabel")}</span>
        {template.placeholders.map((token) => (
          <button
            key={token}
            type="button"
            className="tpl-chip"
            onClick={() => insertPlaceholder(token)}
            title={t("admin.notificationTemplates.insertHint")}
          >
            {token}
          </button>
        ))}
      </div>

      <div className="tpl-preview">
        <span className="tpl-preview__label">{t("admin.notificationTemplates.previewLabel")}</span>
        <p className="tpl-preview__body">
          {trimmed.length > 0
            ? renderPreview(body)
            : t("admin.notificationTemplates.previewEmpty")}
        </p>
      </div>

      {error ? (
        <p className="state state--error" role="alert">
          {error.message}
        </p>
      ) : null}

      <div className="row-actions">
        {template.isOverridden ? (
          <Button
            variant="ghost"
            onClick={() => setConfirmingReset(true)}
            disabled={reset.isPending || update.isPending}
          >
            {t("admin.notificationTemplates.reset")}
          </Button>
        ) : null}
        <Button onClick={handleSave} disabled={!canSave}>
          {update.isPending ? t("admin.action.saving") : t("admin.action.save")}
        </Button>
      </div>

      {confirmingReset ? (
        <Modal
          open
          onClose={() => setConfirmingReset(false)}
          title={t("admin.notificationTemplates.resetTitle")}
          footer={
            <>
              <Button
                variant="ghost"
                onClick={() => setConfirmingReset(false)}
                disabled={reset.isPending}
              >
                {t("admin.action.cancel")}
              </Button>
              <Button variant="danger" onClick={handleReset} disabled={reset.isPending}>
                {reset.isPending
                  ? t("admin.notificationTemplates.resetting")
                  : t("admin.notificationTemplates.reset")}
              </Button>
            </>
          }
        >
          <p>{t("admin.notificationTemplates.resetConfirm", { event: eventLabel })}</p>
          <p className="field__hint">{template.defaultBody}</p>
        </Modal>
      ) : null}
    </article>
  );
}

/** Re-exported for the unsafe-path test and any future typed consumer. */
export type { NotificationTemplateKey };
