import { useState } from "react";
import type { Level } from "@beosand/types";
import { AppShell } from "../ui/AppShell";
import { Button } from "../ui/Button";
import { DataTable, type Column } from "../ui/DataTable";
import { Modal } from "../ui/Modal";
import { TextField, SelectField } from "../ui/Field";
import { useToast } from "../ui/Toast";
import { useT } from "../i18n/LanguageProvider";
import { useLevels, useCreateLevel, useUpdateLevel } from "../hooks/useLevels";

type EditorState =
  | { mode: "create" }
  | { mode: "edit"; level: Level }
  | null;

/** M1 — Levels: reference data CRUD (create, rename, activate/deactivate). */
export function Levels(): JSX.Element {
  const t = useT();
  const levels = useLevels();
  const [editor, setEditor] = useState<EditorState>(null);

  const statusLabel = (status: Level["status"]): string =>
    status === "active" ? t("admin.status.active") : t("admin.status.inactive");

  const columns: Column<Level>[] = [
    { key: "name", header: t("admin.levels.colName"), render: (row) => row.name },
    {
      key: "status",
      header: t("admin.levels.colStatus"),
      render: (row) => statusLabel(row.status)
    },
    {
      key: "actions",
      header: t("admin.levels.colActions"),
      render: (row) => (
        <Button variant="ghost" onClick={() => setEditor({ mode: "edit", level: row })}>
          {t("admin.action.edit")}
        </Button>
      )
    }
  ];

  return (
    <AppShell>
      <header className="page-head">
        <div>
          <h1>{t("admin.levels.title")}</h1>
          <p>{t("admin.levels.lead")}</p>
        </div>
        <Button onClick={() => setEditor({ mode: "create" })}>{t("admin.levels.new")}</Button>
      </header>

      {levels.isLoading ? (
        <p className="state state--loading">{t("admin.state.loading")}</p>
      ) : levels.isError ? (
        <p className="state state--error" role="alert">
          {t("admin.levels.loadError", { message: levels.error.message })}
        </p>
      ) : (
        <DataTable
          caption={t("admin.levels.caption")}
          columns={columns}
          rows={levels.data ?? []}
          rowKey={(row) => row.id}
          emptyLabel={t("admin.levels.empty")}
        />
      )}

      {editor ? <LevelEditor state={editor} onClose={() => setEditor(null)} /> : null}
    </AppShell>
  );
}

interface LevelEditorProps {
  state: NonNullable<EditorState>;
  onClose: () => void;
}

/** Create / edit dialog for a single level. Server owns all validation. */
function LevelEditor({ state, onClose }: LevelEditorProps): JSX.Element {
  const t = useT();
  const toast = useToast();
  const create = useCreateLevel();
  const update = useUpdateLevel();
  const isEdit = state.mode === "edit";

  const [name, setName] = useState(isEdit ? state.level.name : "");
  const [status, setStatus] = useState<Level["status"]>(isEdit ? state.level.status : "active");

  const pending = create.isPending || update.isPending;
  const error = create.error ?? update.error;

  function handleSubmit(event: React.FormEvent): void {
    event.preventDefault();
    if (isEdit) {
      update.mutate(
        { id: state.level.id, input: { name, status } },
        {
          onSuccess: () => {
            toast.notify(t("admin.levels.updated"), "success");
            onClose();
          }
        }
      );
    } else {
      create.mutate(
        { name },
        {
          onSuccess: () => {
            toast.notify(t("admin.levels.created"), "success");
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
      title={isEdit ? t("admin.levels.editTitle") : t("admin.levels.createTitle")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            {t("admin.action.cancel")}
          </Button>
          <Button type="submit" form="level-form" disabled={pending}>
            {pending ? t("admin.action.saving") : t("admin.action.save")}
          </Button>
        </>
      }
    >
      <form id="level-form" onSubmit={handleSubmit} className="form">
        <TextField
          label={t("admin.field.name")}
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          autoComplete="off"
        />
        {isEdit ? (
          <SelectField
            label={t("admin.field.status")}
            value={status}
            onChange={(event) => setStatus(event.target.value as Level["status"])}
            options={[
              { value: "active", label: t("admin.status.active") },
              { value: "inactive", label: t("admin.status.inactive") }
            ]}
            hint={t("admin.levels.statusHint")}
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
