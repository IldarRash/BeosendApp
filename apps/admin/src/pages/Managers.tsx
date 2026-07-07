import { useEffect, useState } from "react";
import {
  updateManagerContactSchema,
  type CreateManagerInput,
  type Locale,
  type Manager,
  type UpdateManagerInput
} from "@beosand/types";
import { LOCALES, localeLabel } from "@beosand/i18n";
import { AppShell } from "../ui/AppShell";
import { Button } from "../ui/Button";
import { DataTable, type Column } from "../ui/DataTable";
import { Modal } from "../ui/Modal";
import { TextField, SelectField, NumberField } from "../ui/Field";
import { useToast } from "../ui/Toast";
import { useT } from "../i18n/LanguageProvider";
import {
  useManagers,
  useCreateManager,
  useManagerContact,
  useUpdateManager,
  useUpdateManagerContact
} from "../hooks/useManagers";

type EditorState =
  | { mode: "create" }
  | { mode: "edit"; manager: Manager }
  | null;

/** Trim a raw username field to a value, or null when blank (a leading "@" is fine — the API normalizes). */
function usernameValue(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Managers (admins): CRUD over DB-backed admin rows. A manager may be added by
 * @username before their numeric id is known; the table shows whether each row is
 * linked (has a telegramId) or pending its first authentication. All authorization
 * stays server-side — this screen only renders the validated rows.
 */
export function Managers(): JSX.Element {
  const t = useT();
  const managers = useManagers();
  const [editor, setEditor] = useState<EditorState>(null);

  const statusLabel = (status: Manager["status"]): string =>
    status === "active" ? t("admin.status.active") : t("admin.status.inactive");

  const columns: Column<Manager>[] = [
    {
      key: "name",
      header: t("admin.managers.colName"),
      render: (row) => row.name ?? <span className="state state--loading">—</span>
    },
    {
      key: "identity",
      header: t("admin.managers.colIdentity"),
      render: (row) => <ManagerIdentity manager={row} />
    },
    {
      key: "linked",
      header: t("admin.managers.colLinked"),
      render: (row) =>
        row.telegramId !== null ? (
          <span className="tag tag--ok">{t("admin.managers.linked")}</span>
        ) : (
          <span className="tag tag--warn">{t("admin.managers.pending")}</span>
        )
    },
    { key: "status", header: t("admin.managers.colStatus"), render: (row) => statusLabel(row.status) },
    {
      key: "actions",
      header: t("admin.managers.colActions"),
      render: (row) => (
        <div className="row-actions">
          <Button variant="ghost" onClick={() => setEditor({ mode: "edit", manager: row })}>
            {t("admin.action.edit")}
          </Button>
        </div>
      )
    }
  ];

  return (
    <AppShell>
      <header className="page-head">
        <div>
          <h1>{t("admin.managers.title")}</h1>
          <p>{t("admin.managers.lead")}</p>
        </div>
        <Button onClick={() => setEditor({ mode: "create" })}>{t("admin.managers.new")}</Button>
      </header>

      <ManagerContactPanel />

      <div className="workspace">
        <div className="workspace__bar">
          <span className="card__label">{t("admin.managers.caption")}</span>
        </div>
        <div className="workspace__body">
          {managers.isLoading ? (
            <p className="state state--loading">{t("admin.managers.loading")}</p>
          ) : managers.isError ? (
            <p className="state state--error" role="alert">
              {t("admin.managers.loadError", { message: managers.error.message })}
            </p>
          ) : (
            <DataTable
              caption={t("admin.managers.caption")}
              columns={columns}
              rows={managers.data ?? []}
              rowKey={(row) => row.id}
              emptyLabel={t("admin.managers.empty")}
            />
          )}
        </div>
      </div>

      {editor ? <ManagerEditor state={editor} onClose={() => setEditor(null)} /> : null}
    </AppShell>
  );
}

/** Manager contact setting used by the bot/Mini App "contact manager" action. */
function ManagerContactPanel(): JSX.Element {
  const t = useT();
  const toast = useToast();
  const contact = useManagerContact();
  const update = useUpdateManagerContact();
  const [draft, setDraft] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (contact.data) {
      setDraft(contact.data.contact);
    }
  }, [contact.data]);

  function handleSubmit(event: React.FormEvent): void {
    event.preventDefault();
    setSaved(false);
    const parsed = updateManagerContactSchema.safeParse({ contact: draft });
    if (!parsed.success) {
      setValidationError(t("admin.managerContact.validationError"));
      return;
    }
    setValidationError(null);
    update.mutate(parsed.data, {
      onSuccess: (savedContact) => {
        setDraft(savedContact.contact);
        setSaved(true);
        toast.notify(t("admin.managerContact.saved"), "success");
      }
    });
  }

  const error = validationError ?? (update.error instanceof Error ? update.error.message : null);

  return (
    <section className="workspace" aria-labelledby="manager-contact-title">
      <div className="workspace__bar">
        <div>
          <h2 id="manager-contact-title">{t("admin.managerContact.title")}</h2>
          <p className="field__hint">{t("admin.managerContact.lead")}</p>
        </div>
        {contact.data?.url ? (
          <a className="btn btn--ghost" href={contact.data.url} target="_blank" rel="noreferrer">
            {t("admin.managerContact.open")}
          </a>
        ) : null}
      </div>

      <div className="workspace__body">
        {contact.isLoading ? (
          <p className="state state--loading">{t("admin.managerContact.loading")}</p>
        ) : contact.isError ? (
          <p className="state state--error" role="alert">
            {t("admin.managerContact.loadError", { message: contact.error.message })}
          </p>
        ) : (
          <form className="form" onSubmit={handleSubmit} aria-label={t("admin.managerContact.title")}>
            <TextField
              label={t("admin.managerContact.contactLabel")}
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                setValidationError(null);
                setSaved(false);
              }}
              autoComplete="off"
              required
              maxLength={120}
              hint={t("admin.managerContact.contactHint")}
            />
            <div className="cluster">
              <Button type="submit" disabled={update.isPending}>
                {update.isPending ? t("admin.action.saving") : t("admin.action.save")}
              </Button>
              {contact.data?.url ? (
                <span className="tag tag--info">{t("admin.managerContact.linkReady")}</span>
              ) : (
                <span className="tag tag--muted">{t("admin.managerContact.plainText")}</span>
              )}
            </div>
            {saved ? (
              <p className="state" role="status">
                {t("admin.managerContact.savedInline")}
              </p>
            ) : null}
            {error ? (
              <p className="state state--error" role="alert">
                {error}
              </p>
            ) : null}
          </form>
        )}
      </div>
    </section>
  );
}

/** Identity cell: @username and/or numeric id, or an em dash when neither is set. */
function ManagerIdentity({ manager }: { manager: Manager }): JSX.Element {
  if (manager.telegramUsername === null && manager.telegramId === null) {
    return <>—</>;
  }
  return (
    <>
      {manager.telegramUsername ? <code>@{manager.telegramUsername}</code> : null}
      {manager.telegramUsername && manager.telegramId !== null ? " " : null}
      {manager.telegramId !== null ? <code>{manager.telegramId}</code> : null}
    </>
  );
}

interface ManagerEditorProps {
  state: NonNullable<EditorState>;
  onClose: () => void;
}

/** Create / edit dialog for a single manager. Server owns all validation. */
function ManagerEditor({ state, onClose }: ManagerEditorProps): JSX.Element {
  const t = useT();
  const toast = useToast();
  const create = useCreateManager();
  const update = useUpdateManager();
  const isEdit = state.mode === "edit";

  const [name, setName] = useState(isEdit ? (state.manager.name ?? "") : "");
  const [telegramId, setTelegramId] = useState<number | null>(
    isEdit ? state.manager.telegramId : null
  );
  const [username, setUsername] = useState(
    isEdit ? (state.manager.telegramUsername ?? "") : ""
  );
  const [status, setStatus] = useState<Manager["status"]>(
    isEdit ? state.manager.status : "active"
  );
  const [language, setLanguage] = useState<Locale>(isEdit ? state.manager.language : "sr");

  const languageOptions = LOCALES.map((value) => ({ value, label: localeLabel[value] }));

  const pending = create.isPending || update.isPending;
  const error = create.error ?? update.error;

  function handleSubmit(event: React.FormEvent): void {
    event.preventDefault();
    const trimmedName = name.trim();
    if (isEdit) {
      const input: UpdateManagerInput = {
        name: trimmedName.length > 0 ? trimmedName : null,
        telegramId,
        telegramUsername: usernameValue(username),
        status,
        language
      };
      update.mutate(
        { id: state.manager.id, input },
        {
          onSuccess: () => {
            toast.notify(t("admin.managers.updated"), "success");
            onClose();
          }
        }
      );
    } else {
      // Send only the identities provided; the API enforces "at least one".
      const input: CreateManagerInput = { language };
      if (trimmedName.length > 0) {
        input.name = trimmedName;
      }
      if (telegramId !== null) {
        input.telegramId = telegramId;
      }
      const uname = usernameValue(username);
      if (uname !== null) {
        input.telegramUsername = uname;
      }
      create.mutate(input, {
        onSuccess: () => {
          toast.notify(t("admin.managers.created"), "success");
          onClose();
        }
      });
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? t("admin.managers.editTitle") : t("admin.managers.createTitle")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            {t("admin.action.cancel")}
          </Button>
          <Button type="submit" form="manager-form" disabled={pending}>
            {pending ? t("admin.action.saving") : t("admin.action.save")}
          </Button>
        </>
      }
    >
      <form id="manager-form" onSubmit={handleSubmit} className="form">
        <TextField
          label={t("admin.field.personName")}
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoComplete="off"
        />
        <NumberField
          label={t("admin.field.telegramId")}
          value={telegramId}
          onValueChange={setTelegramId}
          hint={t("admin.managers.identityHint")}
        />
        <TextField
          label={t("admin.field.username")}
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          autoComplete="off"
          hint={t("admin.managers.usernameHint")}
        />
        <SelectField
          label={t("admin.labels.localeLabel")}
          value={language}
          onChange={(event) => setLanguage(event.target.value as Locale)}
          options={languageOptions}
        />
        {isEdit ? (
          <SelectField
            label={t("admin.field.status")}
            value={status}
            onChange={(event) => setStatus(event.target.value as Manager["status"])}
            options={[
              { value: "active", label: t("admin.status.active") },
              { value: "inactive", label: t("admin.status.inactive") }
            ]}
          />
        ) : null}
        {error ? (
          <p className="state state--error" role="alert">
            {error.message}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
