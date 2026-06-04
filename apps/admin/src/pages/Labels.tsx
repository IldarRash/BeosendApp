import { useMemo, useState } from "react";
import type { LabelEntry, Locale } from "@beosand/types";
import { LOCALES, localeLabel } from "@beosand/i18n";
import { AppShell } from "../ui/AppShell";
import { Button } from "../ui/Button";
import { DataTable, type Column } from "../ui/DataTable";
import { Modal } from "../ui/Modal";
import { SelectField, TextField } from "../ui/Field";
import { useToast } from "../ui/Toast";
import { useT } from "../i18n/LanguageProvider";
import { useLabels, useResetLabel, useUpdateLabel } from "../hooks/useLabels";

/**
 * Localization — Тексты. The admin editor for UI labels: pick a locale, search,
 * and override the canonical default per key (or reset to default). The static
 * catalog supplies the canonical defaults; overrides are stored server-side and
 * merged into the catalog every consumer reads. No domain logic here — it only
 * collects an override string and renders the validated rows the API returns.
 */
export function Labels(): JSX.Element {
  const t = useT();
  const [locale, setLocale] = useState<Locale>("ru");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<LabelEntry | null>(null);

  const labels = useLabels(locale);

  const filtered = useMemo<LabelEntry[]>(() => {
    const rows = labels.data ?? [];
    const needle = search.trim().toLowerCase();
    if (needle === "") return rows;
    return rows.filter(
      (row) =>
        row.key.toLowerCase().includes(needle) ||
        row.defaultValue.toLowerCase().includes(needle) ||
        (row.override ?? "").toLowerCase().includes(needle)
    );
  }, [labels.data, search]);

  const localeOptions = LOCALES.map((value) => ({ value, label: localeLabel[value] }));

  const columns: Column<LabelEntry>[] = [
    { key: "key", header: t("admin.labels.colKey"), render: (row) => <code>{row.key}</code> },
    { key: "default", header: t("admin.labels.colDefault"), render: (row) => row.defaultValue },
    {
      key: "override",
      header: t("admin.labels.colOverride"),
      render: (row) =>
        row.override === null ? (
          <span className="state state--loading">{t("admin.labels.usingDefault")}</span>
        ) : (
          row.override
        )
    },
    {
      key: "actions",
      header: t("admin.labels.colActions"),
      render: (row) => (
        <Button variant="ghost" onClick={() => setEditing(row)}>
          {t("admin.action.edit")}
        </Button>
      )
    }
  ];

  return (
    <AppShell>
      <header className="page-head">
        <div>
          <h1>{t("admin.labels.title")}</h1>
          <p>{t("admin.labels.lead")}</p>
        </div>
      </header>

      <div className="stack">
        <form
          className="cluster"
          aria-label={t("admin.labels.title")}
          onSubmit={(event) => event.preventDefault()}
        >
          <SelectField
            label={t("admin.labels.localeLabel")}
            value={locale}
            onChange={(event) => setLocale(event.target.value as Locale)}
            options={localeOptions}
          />
          <TextField
            label={t("admin.labels.searchLabel")}
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("admin.labels.searchPlaceholder")}
            autoComplete="off"
          />
        </form>

        {labels.isLoading ? (
          <p className="state state--loading">{t("admin.labels.loading")}</p>
        ) : labels.isError ? (
          <p className="state state--error" role="alert">
            {t("admin.labels.error", { message: labels.error.message })}
          </p>
        ) : (
          <DataTable
            caption={t("admin.labels.caption")}
            columns={columns}
            rows={filtered}
            rowKey={(row) => row.key}
            emptyLabel={t("admin.labels.empty")}
          />
        )}
      </div>

      {editing ? (
        <LabelEditor locale={locale} entry={editing} onClose={() => setEditing(null)} />
      ) : null}
    </AppShell>
  );
}

interface LabelEditorProps {
  locale: Locale;
  entry: LabelEntry;
  onClose: () => void;
}

/** Edit / reset one label override for the chosen locale. Server owns validation. */
function LabelEditor({ locale, entry, onClose }: LabelEditorProps): JSX.Element {
  const t = useT();
  const toast = useToast();
  const update = useUpdateLabel();
  const reset = useResetLabel();

  const [value, setValue] = useState(entry.override ?? entry.defaultValue);

  const pending = update.isPending || reset.isPending;
  const error = update.error ?? reset.error;

  function handleSubmit(event: React.FormEvent): void {
    event.preventDefault();
    update.mutate(
      { locale, key: entry.key, value },
      {
        onSuccess: () => {
          toast.notify(t("admin.labels.saved"), "success");
          onClose();
        }
      }
    );
  }

  function handleReset(): void {
    reset.mutate(
      { locale, key: entry.key },
      {
        onSuccess: () => {
          toast.notify(t("admin.labels.resetDone"), "success");
          onClose();
        }
      }
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t("admin.labels.editTitle")}
      footer={
        <>
          <Button
            variant="ghost"
            onClick={handleReset}
            disabled={pending || entry.override === null}
          >
            {reset.isPending ? t("admin.labels.resetting") : t("admin.labels.reset")}
          </Button>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            {t("admin.action.cancel")}
          </Button>
          <Button type="submit" form="label-form" disabled={pending}>
            {update.isPending ? t("admin.action.saving") : t("admin.action.save")}
          </Button>
        </>
      }
    >
      <form id="label-form" onSubmit={handleSubmit} className="form">
        <p className="state">
          <code>{entry.key}</code>
        </p>
        <p className="field__hint">
          {t("admin.labels.defaultLabel")}: {entry.defaultValue}
        </p>
        <TextField
          label={t("admin.labels.fieldValue")}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          hint={t("admin.labels.valueHint")}
          autoComplete="off"
        />
        {error ? (
          <p className="state state--error" role="alert">
            {error.message}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
