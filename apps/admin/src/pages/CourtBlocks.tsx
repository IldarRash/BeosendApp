import { useMemo, useState } from "react";
import type { Court, CourtBlock, CreateCourtBlock } from "@beosand/types";
import { AppShell } from "../ui/AppShell";
import { Button } from "../ui/Button";
import { DataTable, type Column } from "../ui/DataTable";
import { Modal } from "../ui/Modal";
import { SelectField, TextField, TimeField } from "../ui/Field";
import { useToast } from "../ui/Toast";
import { useCourts } from "../hooks/useCourts";
import {
  useCourtBlocks,
  useCreateCourtBlock,
  useDeleteCourtBlock
} from "../hooks/useCourtBlocks";

/** Today's date as an ISO `yyyy-mm-dd` string for the default day. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Human-readable error from a failed query/mutation (the API decides the text). */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Не удалось выполнить операцию.";
}

/**
 * M3 — Блокировки кортов: pick a day, list that day's admin court blocks, add a
 * new block (court / date / time window / reason), and remove one. A block reduces
 * court availability and changes the load grid; the hooks invalidate both queries.
 * Interaction layer only: the API owns validation, overlap and availability — the
 * screen renders the validated rows it gets back and surfaces server errors.
 */
export function CourtBlocks(): JSX.Element {
  const { notify } = useToast();
  const [date, setDate] = useState(todayIso());
  const [creating, setCreating] = useState(false);

  const courts = useCourts();
  const blocks = useCourtBlocks(date || null);
  const remove = useDeleteCourtBlock();

  // Map court id → number so blocks (which carry only courtId) show a court number.
  const courtNumberById = useMemo<Map<string, number>>(() => {
    const map = new Map<string, number>();
    for (const court of courts.data ?? []) {
      map.set(court.id, court.number);
    }
    return map;
  }, [courts.data]);

  function courtLabel(courtId: string): string {
    const number = courtNumberById.get(courtId);
    return number === undefined ? "—" : `Корт ${number}`;
  }

  function handleDelete(block: CourtBlock): void {
    const confirmed = window.confirm(
      `Удалить блокировку ${courtLabel(block.courtId)} ${block.startTime}–${block.endTime}?`
    );
    if (!confirmed) return;
    remove.mutate(block.id, {
      onSuccess: () => notify("Блокировка удалена.", "success"),
      onError: (error) => notify(errorText(error), "error")
    });
  }

  const columns: Column<CourtBlock>[] = [
    { key: "court", header: "Корт", render: (b) => courtLabel(b.courtId) },
    { key: "time", header: "Время", render: (b) => `${b.startTime}–${b.endTime}` },
    { key: "reason", header: "Причина", render: (b) => b.reason },
    {
      key: "actions",
      header: "Действия",
      render: (b) => (
        <Button variant="danger" onClick={() => handleDelete(b)} disabled={remove.isPending}>
          Удалить
        </Button>
      )
    }
  ];

  return (
    <AppShell>
      <header className="page-head">
        <div>
          <h1>Блокировки кортов</h1>
          <p>Ручные блокировки кортов на дату: тренировки, турниры, ремонт.</p>
        </div>
        <Button onClick={() => setCreating(true)} disabled={courts.isError}>
          Добавить блокировку
        </Button>
      </header>

      <div className="stack">
        <form
          aria-label="Выбор даты"
          onSubmit={(e) => e.preventDefault()}
          className="cluster"
        >
          <TextField
            label="Дата"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </form>

        {date === "" ? (
          <p className="state">Укажите дату, чтобы увидеть блокировки.</p>
        ) : blocks.isPending ? (
          <p className="state">Загрузка блокировок…</p>
        ) : blocks.isError ? (
          <p className="state state--error" role="alert">
            {errorText(blocks.error)}
          </p>
        ) : (
          <DataTable
            caption="Блокировки кортов за выбранную дату"
            columns={columns}
            rows={blocks.data}
            rowKey={(b) => b.id}
            emptyLabel="На эту дату блокировок нет."
          />
        )}
      </div>

      {creating ? (
        <CreateBlockDialog
          date={date || todayIso()}
          courts={courts.data ?? []}
          onClose={() => setCreating(false)}
        />
      ) : null}
    </AppShell>
  );
}

interface CreateBlockDialogProps {
  date: string;
  courts: Court[];
  onClose: () => void;
}

/** Create dialog for a single court block. Server owns all validation. */
function CreateBlockDialog({ date, courts, onClose }: CreateBlockDialogProps): JSX.Element {
  const { notify } = useToast();
  const create = useCreateCourtBlock();

  const [courtId, setCourtId] = useState(courts[0]?.id ?? "");
  const [blockDate, setBlockDate] = useState(date);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [reason, setReason] = useState("");

  function handleSubmit(event: React.FormEvent): void {
    event.preventDefault();
    const input: CreateCourtBlock = { courtId, date: blockDate, startTime, endTime, reason };
    create.mutate(input, {
      onSuccess: () => {
        notify("Блокировка создана.", "success");
        onClose();
      }
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Новая блокировка"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={create.isPending}>
            Отмена
          </Button>
          <Button type="submit" form="court-block-form" disabled={create.isPending}>
            {create.isPending ? "Сохранение…" : "Сохранить"}
          </Button>
        </>
      }
    >
      <form id="court-block-form" onSubmit={handleSubmit} className="form">
        <SelectField
          label="Корт"
          value={courtId}
          onChange={(e) => setCourtId(e.target.value)}
          required
          options={courts.map((court) => ({
            value: court.id,
            label: `Корт ${court.number}`
          }))}
        />
        <TextField
          label="Дата"
          type="date"
          value={blockDate}
          onChange={(e) => setBlockDate(e.target.value)}
          required
        />
        <TimeField
          label="Начало"
          value={startTime}
          onChange={(e) => setStartTime(e.target.value)}
          required
        />
        <TimeField
          label="Конец"
          value={endTime}
          onChange={(e) => setEndTime(e.target.value)}
          required
        />
        <TextField
          label="Причина"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          required
          autoComplete="off"
        />
        {create.error ? (
          <p className="state state--error" role="alert">
            {errorText(create.error)}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
