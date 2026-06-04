import { useState } from "react";
import type { Level } from "@beosand/types";
import { AppShell } from "../ui/AppShell";
import { Button } from "../ui/Button";
import { DataTable, type Column } from "../ui/DataTable";
import { Modal } from "../ui/Modal";
import { TextField, SelectField } from "../ui/Field";
import { useToast } from "../ui/Toast";
import { useLevels, useCreateLevel, useUpdateLevel } from "../hooks/useLevels";

type EditorState =
  | { mode: "create" }
  | { mode: "edit"; level: Level }
  | null;

const STATUS_LABEL: Record<Level["status"], string> = {
  active: "Активен",
  inactive: "Неактивен"
};

/** M1 — Levels: reference data CRUD (create, rename, activate/deactivate). */
export function Levels(): JSX.Element {
  const levels = useLevels();
  const [editor, setEditor] = useState<EditorState>(null);

  const columns: Column<Level>[] = [
    { key: "name", header: "Название", render: (row) => row.name },
    {
      key: "status",
      header: "Статус",
      render: (row) => STATUS_LABEL[row.status]
    },
    {
      key: "actions",
      header: "Действия",
      render: (row) => (
        <Button variant="ghost" onClick={() => setEditor({ mode: "edit", level: row })}>
          Изменить
        </Button>
      )
    }
  ];

  return (
    <AppShell>
      <header className="page-head">
        <div>
          <h1>Уровни</h1>
          <p>Справочник уровней подготовки: создание, переименование и деактивация.</p>
        </div>
        <Button onClick={() => setEditor({ mode: "create" })}>Новый уровень</Button>
      </header>

      {levels.isLoading ? (
        <p className="state state--loading">Загрузка…</p>
      ) : levels.isError ? (
        <p className="state state--error" role="alert">
          Не удалось загрузить уровни: {levels.error.message}
        </p>
      ) : (
        <DataTable
          caption="Уровни подготовки"
          columns={columns}
          rows={levels.data ?? []}
          rowKey={(row) => row.id}
          emptyLabel="Уровней пока нет. Создайте первый."
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
            toast.notify("Уровень обновлён", "success");
            onClose();
          }
        }
      );
    } else {
      create.mutate(
        { name },
        {
          onSuccess: () => {
            toast.notify("Уровень создан", "success");
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
      title={isEdit ? "Изменить уровень" : "Новый уровень"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Отмена
          </Button>
          <Button type="submit" form="level-form" disabled={pending}>
            {pending ? "Сохранение…" : "Сохранить"}
          </Button>
        </>
      }
    >
      <form id="level-form" onSubmit={handleSubmit} className="form">
        <TextField
          label="Название"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          autoComplete="off"
        />
        {isEdit ? (
          <SelectField
            label="Статус"
            value={status}
            onChange={(event) => setStatus(event.target.value as Level["status"])}
            options={[
              { value: "active", label: STATUS_LABEL.active },
              { value: "inactive", label: STATUS_LABEL.inactive }
            ]}
            hint="Неактивные уровни не предлагаются в новых группах."
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
