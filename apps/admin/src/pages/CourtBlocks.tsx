import { useMemo, useState } from "react";
import type { Court, CourtBlock, CreateCourtBlock } from "@beosand/types";
import { AppShell } from "../ui/AppShell";
import { Button } from "../ui/Button";
import { DataTable, type Column } from "../ui/DataTable";
import { Modal } from "../ui/Modal";
import { SelectField, TextField, TimeField } from "../ui/Field";
import { useToast } from "../ui/Toast";
import { useT } from "../i18n/LanguageProvider";
import { useCourts } from "../hooks/useCourts";
import {
  useCourtBlocks,
  useCreateCourtBlock,
  useDeleteCourtBlock
} from "../hooks/useCourtBlocks";

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** Today's date as an ISO `yyyy-mm-dd` string for the default day. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Human-readable error from a failed query/mutation (the API decides the text). */
function errorText(error: unknown, t: Translate): string {
  return error instanceof Error ? error.message : t("admin.courtBlocks.opFailed");
}

/**
 * M3 — Блокировки кортов: pick a day, list that day's admin court blocks, add a
 * new block (court / date / time window / reason), and remove one. A block reduces
 * court availability and changes the load grid; the hooks invalidate both queries.
 * Interaction layer only: the API owns validation, overlap and availability — the
 * screen renders the validated rows it gets back and surfaces server errors.
 */
export function CourtBlocks(): JSX.Element {
  const t = useT();
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
    return number === undefined ? "—" : t("admin.courtBlocks.court", { number });
  }

  function handleDelete(block: CourtBlock): void {
    const confirmed = window.confirm(
      t("admin.courtBlocks.deletePrompt", {
        court: courtLabel(block.courtId),
        start: block.startTime,
        end: block.endTime
      })
    );
    if (!confirmed) return;
    remove.mutate(block.id, {
      onSuccess: () => notify(t("admin.courtBlocks.deleted"), "success"),
      onError: (error) => notify(errorText(error, t), "error")
    });
  }

  const columns: Column<CourtBlock>[] = [
    { key: "court", header: t("admin.courtBlocks.colCourt"), render: (b) => courtLabel(b.courtId) },
    { key: "time", header: t("admin.courtBlocks.colTime"), render: (b) => `${b.startTime}–${b.endTime}` },
    { key: "reason", header: t("admin.courtBlocks.colReason"), render: (b) => b.reason },
    {
      key: "actions",
      header: t("admin.courtBlocks.colActions"),
      render: (b) => (
        <Button variant="danger" onClick={() => handleDelete(b)} disabled={remove.isPending}>
          {t("admin.action.delete")}
        </Button>
      )
    }
  ];

  return (
    <AppShell>
      <header className="page-head">
        <div>
          <h1>{t("admin.courtBlocks.title")}</h1>
          <p>{t("admin.courtBlocks.lead")}</p>
        </div>
        <Button onClick={() => setCreating(true)} disabled={courts.isError}>
          {t("admin.courtBlocks.add")}
        </Button>
      </header>

      <div className="stack">
        <form
          aria-label={t("admin.courtBlocks.dateLabel")}
          onSubmit={(e) => e.preventDefault()}
          className="cluster"
        >
          <TextField
            label={t("admin.field.date")}
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </form>

        {date === "" ? (
          <p className="state">{t("admin.courtBlocks.pickDate")}</p>
        ) : blocks.isPending ? (
          <p className="state">{t("admin.courtBlocks.loading")}</p>
        ) : blocks.isError ? (
          <p className="state state--error" role="alert">
            {errorText(blocks.error, t)}
          </p>
        ) : (
          <DataTable
            caption={t("admin.courtBlocks.caption")}
            columns={columns}
            rows={blocks.data}
            rowKey={(b) => b.id}
            emptyLabel={t("admin.courtBlocks.empty")}
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
  const t = useT();
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
        notify(t("admin.courtBlocks.created"), "success");
        onClose();
      }
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t("admin.courtBlocks.newTitle")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={create.isPending}>
            {t("admin.action.cancel")}
          </Button>
          <Button type="submit" form="court-block-form" disabled={create.isPending}>
            {create.isPending ? t("admin.action.saving") : t("admin.action.save")}
          </Button>
        </>
      }
    >
      <form id="court-block-form" onSubmit={handleSubmit} className="form">
        <SelectField
          label={t("admin.courtBlocks.colCourt")}
          value={courtId}
          onChange={(e) => setCourtId(e.target.value)}
          required
          options={courts.map((court) => ({
            value: court.id,
            label: t("admin.courtBlocks.court", { number: court.number })
          }))}
        />
        <TextField
          label={t("admin.field.date")}
          type="date"
          value={blockDate}
          onChange={(e) => setBlockDate(e.target.value)}
          required
        />
        <TimeField
          label={t("admin.field.startTime")}
          value={startTime}
          onChange={(e) => setStartTime(e.target.value)}
          required
        />
        <TimeField
          label={t("admin.field.endTime")}
          value={endTime}
          onChange={(e) => setEndTime(e.target.value)}
          required
        />
        <TextField
          label={t("admin.courtBlocks.fieldReason")}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          required
          autoComplete="off"
        />
        {create.error ? (
          <p className="state state--error" role="alert">
            {errorText(create.error, t)}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
