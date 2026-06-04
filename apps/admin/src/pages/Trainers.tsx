import { useState } from "react";
import type { Trainer } from "@beosand/types";
import { AppShell } from "../ui/AppShell";
import { Button } from "../ui/Button";
import { DataTable, type Column } from "../ui/DataTable";
import { Modal } from "../ui/Modal";
import { TextField, SelectField, NumberField } from "../ui/Field";
import { useToast } from "../ui/Toast";
import { useTrainers, useCreateTrainer, useUpdateTrainer } from "../hooks/useTrainers";

type EditorState =
  | { mode: "create" }
  | { mode: "edit"; trainer: Trainer }
  | null;

const TYPE_LABEL: Record<Trainer["type"], string> = {
  main: "Основной",
  guest: "Приглашённый"
};

const STATUS_LABEL: Record<Trainer["status"], string> = {
  active: "Активен",
  inactive: "Неактивен"
};

/** M1 — Trainers: CRUD plus Telegram-ID linking (the key that opens the bot UI). */
export function Trainers(): JSX.Element {
  const trainers = useTrainers();
  const [editor, setEditor] = useState<EditorState>(null);

  const columns: Column<Trainer>[] = [
    { key: "name", header: "Имя", render: (row) => row.name },
    { key: "type", header: "Тип", render: (row) => TYPE_LABEL[row.type] },
    {
      key: "telegram",
      header: "Telegram",
      render: (row) =>
        row.telegramId === null ? (
          <span className="state state--loading">Не привязан</span>
        ) : (
          <code>{row.telegramId}</code>
        )
    },
    { key: "status", header: "Статус", render: (row) => STATUS_LABEL[row.status] },
    {
      key: "actions",
      header: "Действия",
      render: (row) => (
        <Button variant="ghost" onClick={() => setEditor({ mode: "edit", trainer: row })}>
          Изменить
        </Button>
      )
    }
  ];

  return (
    <AppShell>
      <header className="page-head">
        <div>
          <h1>Тренеры</h1>
          <p>
            Создание и редактирование тренеров. Привязка Telegram-ID открывает тренеру его
            интерфейс в боте.
          </p>
        </div>
        <Button onClick={() => setEditor({ mode: "create" })}>Новый тренер</Button>
      </header>

      {trainers.isLoading ? (
        <p className="state state--loading">Загрузка…</p>
      ) : trainers.isError ? (
        <p className="state state--error" role="alert">
          Не удалось загрузить тренеров: {trainers.error.message}
        </p>
      ) : (
        <DataTable
          caption="Тренеры школы"
          columns={columns}
          rows={trainers.data ?? []}
          rowKey={(row) => row.id}
          emptyLabel="Тренеров пока нет. Создайте первого."
        />
      )}

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
  const toast = useToast();
  const create = useCreateTrainer();
  const update = useUpdateTrainer();
  const isEdit = state.mode === "edit";

  const [name, setName] = useState(isEdit ? state.trainer.name : "");
  const [type, setType] = useState<Trainer["type"]>(isEdit ? state.trainer.type : "main");
  const [telegramId, setTelegramId] = useState<number | null>(
    isEdit ? state.trainer.telegramId : null
  );
  const [status, setStatus] = useState<Trainer["status"]>(
    isEdit ? state.trainer.status : "active"
  );

  const pending = create.isPending || update.isPending;
  const error = create.error ?? update.error;

  function handleSubmit(event: React.FormEvent): void {
    event.preventDefault();
    if (isEdit) {
      update.mutate(
        { id: state.trainer.id, input: { name, type, status, telegramId } },
        {
          onSuccess: () => {
            toast.notify("Тренер обновлён", "success");
            onClose();
          }
        }
      );
    } else {
      create.mutate(
        { name, type, telegramId },
        {
          onSuccess: () => {
            toast.notify("Тренер создан", "success");
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
      title={isEdit ? "Изменить тренера" : "Новый тренер"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Отмена
          </Button>
          <Button type="submit" form="trainer-form" disabled={pending}>
            {pending ? "Сохранение…" : "Сохранить"}
          </Button>
        </>
      }
    >
      <form id="trainer-form" onSubmit={handleSubmit} className="form">
        <TextField
          label="Имя"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          autoComplete="off"
        />
        <SelectField
          label="Тип"
          value={type}
          onChange={(event) => setType(event.target.value as Trainer["type"])}
          options={[
            { value: "main", label: TYPE_LABEL.main },
            { value: "guest", label: TYPE_LABEL.guest }
          ]}
        />
        <NumberField
          label="Telegram-ID"
          value={telegramId}
          onValueChange={setTelegramId}
          hint="Необязательно. Привязка Telegram-ID открывает тренеру его интерфейс в боте."
        />
        {isEdit ? (
          <SelectField
            label="Статус"
            value={status}
            onChange={(event) => setStatus(event.target.value as Trainer["status"])}
            options={[
              { value: "active", label: STATUS_LABEL.active },
              { value: "inactive", label: STATUS_LABEL.inactive }
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
