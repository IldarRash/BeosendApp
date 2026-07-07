import { useState } from "react";
import type { Locale, Trainer } from "@beosand/types";
import { LOCALES, localeLabel } from "@beosand/i18n";
import { AppShell } from "../ui/AppShell";
import { Button } from "../ui/Button";
import { DataTable, type Column } from "../ui/DataTable";
import { Modal } from "../ui/Modal";
import { TextField, SelectField, NumberField } from "../ui/Field";
import { useToast } from "../ui/Toast";
import { useT } from "../i18n/LanguageProvider";
import { useTrainers, useCreateTrainer, useUpdateTrainer } from "../hooks/useTrainers";

type EditorState =
  | { mode: "create" }
  | { mode: "edit"; trainer: Trainer }
  | null;

/** M1 — Trainers: CRUD plus Telegram-ID linking (the key that opens the bot UI). */
export function Trainers(): JSX.Element {
  const t = useT();
  const trainers = useTrainers();
  const [editor, setEditor] = useState<EditorState>(null);

  const typeLabel = (type: Trainer["type"]): string =>
    type === "main" ? t("admin.trainers.typeMain") : t("admin.trainers.typeGuest");
  const statusLabel = (status: Trainer["status"]): string =>
    status === "active" ? t("admin.status.active") : t("admin.status.inactive");

  const columns: Column<Trainer>[] = [
    { key: "name", header: t("admin.trainers.colName"), render: (row) => row.name },
    { key: "type", header: t("admin.trainers.colType"), render: (row) => typeLabel(row.type) },
    {
      key: "telegram",
      header: t("admin.trainers.colTelegram"),
      render: (row) => (
        <>
          {row.telegramUsername ? <code>@{row.telegramUsername}</code> : null}
          {row.telegramUsername && row.telegramId !== null ? " " : null}
          {row.telegramId !== null ? <code>{row.telegramId}</code> : null}
          {row.telegramUsername === null && row.telegramId === null ? "—" : null}
        </>
      )
    },
    {
      key: "linked",
      header: t("admin.trainers.colLinked"),
      render: (row) =>
        row.telegramId !== null ? (
          <span className="tag tag--ok">{t("admin.trainers.linked")}</span>
        ) : (
          <span className="tag tag--warn">{t("admin.trainers.pending")}</span>
        )
    },
    {
      key: "individualVisible",
      header: t("admin.trainers.colIndividualVisible"),
      render: (row) =>
        row.individualVisible ? (
          <span className="tag tag--ok">{t("admin.trainers.individualVisible")}</span>
        ) : (
          <span className="tag">{t("admin.trainers.individualHidden")}</span>
        )
    },
    { key: "status", header: t("admin.trainers.colStatus"), render: (row) => statusLabel(row.status) },
    {
      key: "actions",
      header: t("admin.trainers.colActions"),
      render: (row) => (
        <div className="row-actions">
          <Button variant="ghost" onClick={() => setEditor({ mode: "edit", trainer: row })}>
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
          <h1>{t("admin.trainers.title")}</h1>
          <p>{t("admin.trainers.lead")}</p>
        </div>
        <Button onClick={() => setEditor({ mode: "create" })}>{t("admin.trainers.new")}</Button>
      </header>

      <div className="workspace">
        <div className="workspace__bar">
          <span className="card__label">{t("admin.trainers.caption")}</span>
        </div>
        <div className="workspace__body">
          {trainers.isLoading ? (
            <p className="state state--loading">{t("admin.state.loading")}</p>
          ) : trainers.isError ? (
            <p className="state state--error" role="alert">
              {t("admin.trainers.loadError", { message: trainers.error.message })}
            </p>
          ) : (
            <DataTable
              caption={t("admin.trainers.caption")}
              columns={columns}
              rows={trainers.data ?? []}
              rowKey={(row) => row.id}
              emptyLabel={t("admin.trainers.empty")}
            />
          )}
        </div>
      </div>

      {editor ? <TrainerEditor state={editor} onClose={() => setEditor(null)} /> : null}
    </AppShell>
  );
}

interface TrainerEditorProps {
  state: NonNullable<EditorState>;
  onClose: () => void;
}

/** Create / edit dialog for a single trainer. Server owns all validation. */
function TrainerEditor({ state, onClose }: TrainerEditorProps): JSX.Element {
  const t = useT();
  const toast = useToast();
  const create = useCreateTrainer();
  const update = useUpdateTrainer();
  const isEdit = state.mode === "edit";

  const [name, setName] = useState(isEdit ? state.trainer.name : "");
  const [type, setType] = useState<Trainer["type"]>(isEdit ? state.trainer.type : "main");
  const [telegramId, setTelegramId] = useState<number | null>(
    isEdit ? state.trainer.telegramId : null
  );
  const [username, setUsername] = useState(
    isEdit ? (state.trainer.telegramUsername ?? "") : ""
  );
  const [status, setStatus] = useState<Trainer["status"]>(
    isEdit ? state.trainer.status : "active"
  );
  const [language, setLanguage] = useState<Locale>(isEdit ? state.trainer.language : "sr");
  const [individualVisible, setIndividualVisible] = useState(
    isEdit ? state.trainer.individualVisible : true
  );

  const languageOptions = LOCALES.map((value) => ({ value, label: localeLabel[value] }));

  const pending = create.isPending || update.isPending;
  const error = create.error ?? update.error;

  function handleSubmit(event: React.FormEvent): void {
    event.preventDefault();
    const trimmedUsername = username.trim();
    const telegramUsername = trimmedUsername.length > 0 ? trimmedUsername : null;
    if (isEdit) {
      update.mutate(
        {
          id: state.trainer.id,
          input: { name, type, status, telegramId, telegramUsername, language, individualVisible }
        },
        {
          onSuccess: () => {
            toast.notify(t("admin.trainers.updated"), "success");
            onClose();
          }
        }
      );
    } else {
      create.mutate(
        { name, type, telegramId, telegramUsername, language, individualVisible },
        {
          onSuccess: () => {
            toast.notify(t("admin.trainers.created"), "success");
            onClose();
          }
        }
      );
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? t("admin.trainers.editTitle") : t("admin.trainers.createTitle")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            {t("admin.action.cancel")}
          </Button>
          <Button type="submit" form="trainer-form" disabled={pending}>
            {pending ? t("admin.action.saving") : t("admin.action.save")}
          </Button>
        </>
      }
    >
      <form id="trainer-form" onSubmit={handleSubmit} className="form">
        <TextField
          label={t("admin.field.personName")}
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          autoComplete="off"
        />
        <SelectField
          label={t("admin.trainers.fieldType")}
          value={type}
          onChange={(event) => setType(event.target.value as Trainer["type"])}
          options={[
            { value: "main", label: t("admin.trainers.typeMain") },
            { value: "guest", label: t("admin.trainers.typeGuest") }
          ]}
        />
        <NumberField
          label={t("admin.trainers.fieldTelegram")}
          value={telegramId}
          onValueChange={setTelegramId}
          hint={t("admin.trainers.telegramHint")}
        />
        <TextField
          label={t("admin.field.username")}
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          autoComplete="off"
          hint={t("admin.trainers.usernameHint")}
        />
        <SelectField
          label={t("admin.labels.localeLabel")}
          value={language}
          onChange={(event) => setLanguage(event.target.value as Locale)}
          options={languageOptions}
        />
        <label className="cluster">
          <input
            type="checkbox"
            checked={individualVisible}
            onChange={(event) => setIndividualVisible(event.target.checked)}
          />
          <span>{t("admin.trainers.fieldIndividualVisible")}</span>
        </label>
        {isEdit ? (
          <SelectField
            label={t("admin.field.status")}
            value={status}
            onChange={(event) => setStatus(event.target.value as Trainer["status"])}
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
