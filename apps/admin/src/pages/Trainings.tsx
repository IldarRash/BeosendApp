import { useMemo, useState } from "react";
import {
  isoDate,
  type ChangeCapacityInput,
  type Client,
  type Court,
  type GenerateAllResult,
  type GenerateMonthInput,
  type Group,
  type ListTrainingsQuery,
  type Training,
  type TrainingStatus
} from "@beosand/types";
import { AppShell } from "../ui/AppShell";
import { Button } from "../ui/Button";
import { DataTable, type Column } from "../ui/DataTable";
import { Modal } from "../ui/Modal";
import { NumberField, SelectField, TextField, type SelectOption } from "../ui/Field";
import { useToast } from "../ui/Toast";
import { useT } from "../i18n/LanguageProvider";
import { useCourts } from "../hooks/useCourts";
import { useGroups } from "../hooks/useGroups";
import { useTrainers } from "../hooks/useTrainers";
import { useBookManual, useClientsList, useCreateWalkIn } from "../hooks/useClients";
import { useGenerationStatus } from "../hooks/useGenerationStatus";
import {
  useCancelTraining,
  useChangeCapacity,
  useGenerateAllGroups,
  useGenerateMonth,
  useTrainings
} from "../hooks/useTrainings";
import { TrainingsCalendar } from "./TrainingsCalendar";

type TrainingsView = "table" | "calendar";

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** Catalog key for a training status the API returns (never recomputed here). */
function statusLabel(status: TrainingStatus, t: Translate): string {
  return t(`admin.trainings.status${status.charAt(0).toUpperCase()}${status.slice(1)}`);
}

/** First/last day of a calendar month as ISO strings (`month` is 1-12). */
function monthRange(year: number, month: number): { from: string; to: string } {
  // Day 0 of the next month is the last day of this month — plain Date math.
  const lastDay = new Date(year, month, 0).getDate();
  return { from: isoDate(year, month, 1), to: isoDate(year, month, lastDay) };
}

/** First/last day of the current calendar month as ISO strings. */
function currentMonthRange(): { from: string; to: string } {
  const now = new Date();
  return monthRange(now.getFullYear(), now.getMonth() + 1);
}

/** Month options 1..12 with localized names. */
function monthOptions(t: Translate): SelectOption[] {
  return Array.from({ length: 12 }, (_, i) => ({
    value: String(i + 1),
    label: t(`admin.trainings.month.${i + 1}`)
  }));
}

/** Human-readable error from a failed mutation (the API decides the message). */
function errorText(error: unknown, t: Translate): string {
  return error instanceof Error ? error.message : t("admin.trainings.opFailed");
}

/**
 * M1 — Trainings management. A from/to (optionally group-scoped) range feeds
 * listTrainings into a DataTable showing the API's own booked/capacity and
 * status — no client recompute. Admin can generate a month for a group, cancel a
 * training (behind a confirm), and change a training's capacity (the server
 * rejects a value below bookedCount; that error is rendered, never the floor).
 */
export function Trainings(): JSX.Element {
  const t = useT();
  const { notify } = useToast();

  // ── View toggle (table | calendar) ──────────────────────────────────────
  const [view, setView] = useState<TrainingsView>("table");

  // ── Range / group filter ───────────────────────────────────────────────
  // Default to the current calendar month so the table shows data on first load;
  // clearing a date drops the query back to the pick-range placeholder.
  const [from, setFrom] = useState(() => currentMonthRange().from);
  const [to, setTo] = useState(() => currentMonthRange().to);
  const [filterGroupId, setFilterGroupId] = useState("");

  const groups = useGroups();
  const trainers = useTrainers();
  const courts = useCourts();

  const query: ListTrainingsQuery | null =
    from && to ? { from, to, ...(filterGroupId ? { groupId: filterGroupId } : {}) } : null;
  const trainings = useTrainings(query);

  const groupOptions = useMemo<SelectOption[]>(
    () => [
      { value: "", label: t("admin.trainings.allGroups") },
      ...(groups.data ?? []).map((g) => ({ value: g.id, label: g.name }))
    ],
    [groups.data, t]
  );

  const groupName = useMemo(() => {
    const map = new Map<string, string>();
    for (const g of groups.data ?? []) map.set(g.id, g.name);
    return (id: string | null): string => (id ? (map.get(id) ?? "—") : t("admin.trainings.oneOff"));
  }, [groups.data, t]);

  const trainerName = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of trainers.data ?? []) map.set(t.id, t.name);
    return (id: string): string => map.get(id) ?? "—";
  }, [trainers.data]);

  // ── Generate month ─────────────────────────────────────────────────────
  const [genOpen, setGenOpen] = useState(false);
  const generate = useGenerateMonth();

  // ── Generate all groups (Feature 3) ─────────────────────────────────────
  const [genAllOpen, setGenAllOpen] = useState(false);
  const generateAll = useGenerateAllGroups();
  const [allResult, setAllResult] = useState<GenerateAllResult | null>(null);

  // ── Cancel ─────────────────────────────────────────────────────────────
  const [cancelTarget, setCancelTarget] = useState<Training | null>(null);
  const cancel = useCancelTraining();

  // ── Change capacity ────────────────────────────────────────────────────
  const [capacityTarget, setCapacityTarget] = useState<Training | null>(null);
  const changeCapacity = useChangeCapacity();

  // ── Add person (Feature 5 — admin/trainer manual booking) ────────────────
  const [addPersonTarget, setAddPersonTarget] = useState<Training | null>(null);

  const columns: Column<Training>[] = [
    { key: "date", header: t("admin.trainings.colDate"), render: (row) => row.date },
    {
      key: "time",
      header: t("admin.trainings.colTime"),
      render: (row) => `${row.startTime}–${row.endTime}`
    },
    { key: "group", header: t("admin.trainings.colGroup"), render: (row) => groupName(row.groupId) },
    { key: "trainer", header: t("admin.trainings.colTrainer"), render: (row) => trainerName(row.trainerId) },
    {
      key: "occupancy",
      header: t("admin.trainings.colOccupancy"),
      numeric: true,
      render: (row) => `${row.bookedCount} / ${row.capacity}`
    },
    {
      key: "status",
      header: t("admin.trainings.colStatus"),
      render: (row) => statusLabel(row.status, t)
    },
    {
      key: "actions",
      header: t("admin.trainings.colActions"),
      render: (row) => (
        <div style={{ display: "flex", gap: 8 }}>
          <Button
            variant="ghost"
            onClick={() => setAddPersonTarget(row)}
            disabled={
              row.status === "full" ||
              row.status === "cancelled" ||
              row.status === "completed"
            }
          >
            {t("admin.trainings.actionAddPerson")}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              changeCapacity.reset();
              setCapacityTarget(row);
            }}
            disabled={row.status === "cancelled"}
          >
            {t("admin.trainings.actionCapacity")}
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              cancel.reset();
              setCancelTarget(row);
            }}
            disabled={row.status === "cancelled" || row.status === "completed"}
          >
            {t("admin.trainings.actionCancel")}
          </Button>
        </div>
      )
    }
  ];

  return (
    <AppShell>
      <header className="page-head">
        <div>
          <h1>{t("admin.trainings.title")}</h1>
          <p>{t("admin.trainings.lead")}</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <div className="view-toggle" role="group" aria-label={t("admin.trainings.viewLabel")}>
            <button
              type="button"
              className="view-toggle__btn"
              aria-pressed={view === "table"}
              onClick={() => setView("table")}
            >
              {t("admin.trainings.viewTable")}
            </button>
            <button
              type="button"
              className="view-toggle__btn"
              aria-pressed={view === "calendar"}
              onClick={() => setView("calendar")}
            >
              {t("admin.trainings.viewCalendar")}
            </button>
          </div>
          <Button variant="ghost" onClick={() => setGenAllOpen(true)}>
            {t("admin.trainings.generateAll")}
          </Button>
          <Button onClick={() => setGenOpen(true)}>{t("admin.trainings.generate")}</Button>
        </div>
      </header>

      {view === "calendar" ? (
        <TrainingsCalendar />
      ) : (
        <>
          <form
            aria-label={t("admin.trainings.filterLabel")}
            onSubmit={(e) => e.preventDefault()}
            style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}
          >
            <TextField
              label={t("admin.field.fromDate")}
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
            <TextField
              label={t("admin.field.toDate")}
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
            <SelectField
              label={t("admin.field.group")}
              options={groupOptions}
              value={filterGroupId}
              onChange={(e) => setFilterGroupId(e.target.value)}
            />
          </form>

          {query === null ? (
            <p className="state">{t("admin.trainings.pickRange")}</p>
          ) : trainings.isPending ? (
            <p className="state">{t("admin.trainings.loading")}</p>
          ) : trainings.isError ? (
            <p className="state state--error" role="alert">
              {errorText(trainings.error, t)}
            </p>
          ) : (
            <DataTable
              caption={t("admin.trainings.caption")}
              columns={columns}
              rows={trainings.data}
              rowKey={(row) => row.id}
              emptyLabel={t("admin.trainings.empty")}
            />
          )}
        </>
      )}

      <GenerateMonthModal
        open={genOpen}
        groups={groups.data ?? []}
        courts={courts.data ?? []}
        pending={generate.isPending}
        error={generate.isError ? errorText(generate.error, t) : undefined}
        onClose={() => {
          generate.reset();
          setGenOpen(false);
        }}
        onSubmit={(input) => {
          generate.mutate(input, {
            onSuccess: (rows) => {
              setGenOpen(false);
              // Move the table to the generated month so the new rows are visible.
              const range = monthRange(input.year, input.month);
              setFrom(range.from);
              setTo(range.to);
              notify(t("admin.trainings.generated", { count: rows.length }), "success");
            }
          });
        }}
      />

      <GenerateAllModal
        open={genAllOpen}
        pending={generateAll.isPending}
        error={generateAll.isError ? errorText(generateAll.error, t) : undefined}
        onClose={() => {
          generateAll.reset();
          setGenAllOpen(false);
        }}
        onSubmit={(input) => {
          generateAll.mutate(input, {
            onSuccess: (result) => {
              setGenAllOpen(false);
              // Move the table to the generated month so the new rows are visible.
              const range = monthRange(input.year, input.month);
              setFrom(range.from);
              setTo(range.to);
              setAllResult(result);
            }
          });
        }}
      />

      <GenerateAllResultModal result={allResult} onClose={() => setAllResult(null)} />

      <Modal
        open={cancelTarget !== null}
        title={t("admin.trainings.cancelTitle")}
        onClose={() => setCancelTarget(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCancelTarget(null)}>
              {t("admin.trainings.cancelKeep")}
            </Button>
            <Button
              variant="danger"
              disabled={cancel.isPending}
              onClick={() => {
                if (!cancelTarget) return;
                cancel.mutate(cancelTarget.id, {
                  onSuccess: (updated) => {
                    setCancelTarget(null);
                    notify(
                      t("admin.trainings.cancelled", { count: updated.bookedCount }),
                      "success"
                    );
                  }
                });
              }}
            >
              {cancel.isPending ? t("admin.trainings.cancelling") : t("admin.trainings.cancelConfirm")}
            </Button>
          </>
        }
      >
        {cancelTarget ? (
          <p>
            {t("admin.trainings.cancelPrompt", {
              date: cancelTarget.date,
              start: cancelTarget.startTime,
              end: cancelTarget.endTime,
              count: cancelTarget.bookedCount
            })}
          </p>
        ) : null}
        {cancel.isError ? (
          <p className="state state--error" role="alert">
            {errorText(cancel.error, t)}
          </p>
        ) : null}
      </Modal>

      <ChangeCapacityModal
        target={capacityTarget}
        pending={changeCapacity.isPending}
        error={changeCapacity.isError ? errorText(changeCapacity.error, t) : undefined}
        onClose={() => setCapacityTarget(null)}
        onSubmit={(capacity) => {
          if (!capacityTarget) return;
          const input: ChangeCapacityInput = { capacity };
          changeCapacity.mutate(
            { id: capacityTarget.id, input },
            {
              onSuccess: (updated) => {
                setCapacityTarget(null);
                notify(
                  t("admin.trainings.capacityUpdated", {
                    capacity: updated.capacity,
                    status: statusLabel(updated.status, t)
                  }),
                  "success"
                );
              }
            }
          );
        }}
      />

      <AddPersonModal
        target={addPersonTarget}
        onClose={() => setAddPersonTarget(null)}
        onBooked={(name) => {
          setAddPersonTarget(null);
          notify(t("admin.trainings.addPersonBooked", { name }), "success");
        }}
      />
    </AppShell>
  );
}

// ── Generate month modal ───────────────────────────────────────────────────

interface GenerateMonthModalProps {
  open: boolean;
  groups: Group[];
  courts: Court[];
  pending: boolean;
  error?: string;
  onClose: () => void;
  onSubmit: (input: GenerateMonthInput) => void;
}

function GenerateMonthModal({
  open,
  groups,
  courts,
  pending,
  error,
  onClose,
  onSubmit
}: GenerateMonthModalProps): JSX.Element {
  const t = useT();
  const now = new Date();
  const [groupId, setGroupId] = useState("");
  const [year, setYear] = useState<number | null>(now.getFullYear());
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  // Empty = auto-pick: the server chooses the lowest-numbered free court per date.
  const [courtId, setCourtId] = useState("");

  // Per-group coverage for the chosen year/month: already fully-generated groups are
  // marked "(готово)" and disabled. The query is gated on year (month is always set);
  // a failed/loading status simply falls back to listing all groups normally.
  const monthNumber = Number.parseInt(month, 10);
  const status = useGenerationStatus(open ? year : null, open ? monthNumber : null);
  const fullyGeneratedById = useMemo(() => {
    const set = new Set<string>();
    for (const item of status.data ?? []) {
      if (item.fullyGenerated) set.add(item.groupId);
    }
    return set;
  }, [status.data]);

  const groupOptions: SelectOption[] = [
    { value: "", label: t("admin.trainings.pickGroup") },
    ...groups.map((g) =>
      fullyGeneratedById.has(g.id)
        ? { value: g.id, label: t("admin.trainings.groupDone", { name: g.name }), disabled: true }
        : { value: g.id, label: g.name }
    )
  ];

  // Derive (don't mutate state during render): a selection that has since become
  // fully-generated is treated as no selection, without resetting the stored id.
  const effectiveGroupId = groupId !== "" && fullyGeneratedById.has(groupId) ? "" : groupId;

  const courtOptions: SelectOption[] = [
    { value: "", label: t("admin.trainings.courtAuto") },
    ...courts.map((c) => ({ value: c.id, label: t("admin.trainings.courtOption", { number: c.number }) }))
  ];

  const canSubmit = effectiveGroupId !== "" && year !== null && !pending;

  return (
    <Modal
      open={open}
      title={t("admin.trainings.genMonthTitle")}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("admin.action.cancel")}
          </Button>
          <Button
            disabled={!canSubmit}
            onClick={() => {
              if (effectiveGroupId === "" || year === null) return;
              onSubmit({
                groupId: effectiveGroupId,
                year,
                month: Number.parseInt(month, 10),
                // Send courtId only when an explicit court is chosen.
                ...(courtId ? { courtId } : {})
              });
            }}
          >
            {pending ? t("admin.trainings.generating") : t("admin.trainings.genSubmit")}
          </Button>
        </>
      }
    >
      <p className="state">{t("admin.trainings.genHint")}</p>
      <SelectField
        label={t("admin.field.group")}
        options={groupOptions}
        value={effectiveGroupId}
        onChange={(e) => setGroupId(e.target.value)}
        hint={fullyGeneratedById.size > 0 ? t("admin.trainings.groupDoneHint") : undefined}
      />
      <NumberField label={t("admin.trainings.fieldYear")} value={year} onValueChange={setYear} />
      <SelectField
        label={t("admin.trainings.fieldMonth")}
        options={monthOptions(t)}
        value={month}
        onChange={(e) => setMonth(e.target.value)}
      />
      <SelectField
        label={t("admin.trainings.fieldCourt")}
        options={courtOptions}
        value={courtId}
        onChange={(e) => setCourtId(e.target.value)}
        hint={t("admin.trainings.courtHint")}
      />
      {error ? (
        <p className="state state--error" role="alert">
          {error}
        </p>
      ) : null}
    </Modal>
  );
}

// ── Generate all groups modal (Feature 3) ───────────────────────────────────

interface GenerateAllModalProps {
  open: boolean;
  pending: boolean;
  error?: string;
  onClose: () => void;
  onSubmit: (input: { year: number; month: number }) => void;
}

function GenerateAllModal({
  open,
  pending,
  error,
  onClose,
  onSubmit
}: GenerateAllModalProps): JSX.Element {
  const t = useT();
  const now = new Date();
  const [year, setYear] = useState<number | null>(now.getFullYear());
  const [month, setMonth] = useState(String(now.getMonth() + 1));

  const canSubmit = year !== null && !pending;

  return (
    <Modal
      open={open}
      title={t("admin.trainings.genAllTitle")}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("admin.action.cancel")}
          </Button>
          <Button
            disabled={!canSubmit}
            onClick={() => {
              if (year === null) return;
              onSubmit({ year, month: Number.parseInt(month, 10) });
            }}
          >
            {pending ? t("admin.trainings.generating") : t("admin.trainings.genSubmit")}
          </Button>
        </>
      }
    >
      <p className="state">{t("admin.trainings.genAllHint")}</p>
      <NumberField label={t("admin.trainings.fieldYear")} value={year} onValueChange={setYear} />
      <SelectField
        label={t("admin.trainings.fieldMonth")}
        options={monthOptions(t)}
        value={month}
        onChange={(e) => setMonth(e.target.value)}
      />
      {error ? (
        <p className="state state--error" role="alert">
          {error}
        </p>
      ) : null}
    </Modal>
  );
}

// ── Generate all groups result panel ─────────────────────────────────────────

/**
 * Server-decided per-group outcome of "generate all". Pure render — every count
 * (created / blocked / skipped) comes from the API; the client computes nothing.
 * A group with skipped > 0 is flagged: some trainings could not reserve a court.
 */
function GenerateAllResultModal({
  result,
  onClose
}: {
  result: GenerateAllResult | null;
  onClose: () => void;
}): JSX.Element {
  const t = useT();
  const rows = result?.perGroup ?? [];

  const columns: Column<GenerateAllResult["perGroup"][number]>[] = [
    { key: "group", header: t("admin.trainings.colGroup"), render: (r) => r.groupName },
    {
      key: "created",
      header: t("admin.trainings.genResCreated"),
      numeric: true,
      render: (r) => String(r.created)
    },
    {
      key: "blocked",
      header: t("admin.trainings.genResBlocked"),
      numeric: true,
      render: (r) => String(r.blocked)
    },
    {
      key: "skipped",
      header: t("admin.trainings.genResSkipped"),
      numeric: true,
      render: (r) =>
        r.skipped > 0 ? (
          <span className="tag tag--warn">{r.skipped}</span>
        ) : (
          String(r.skipped)
        )
    }
  ];

  const anySkipped = rows.some((r) => r.skipped > 0);

  return (
    <Modal open={result !== null} title={t("admin.trainings.genAllResultTitle")} onClose={onClose}>
      <DataTable
        caption={t("admin.trainings.genAllResultCaption")}
        columns={columns}
        rows={rows}
        rowKey={(r) => r.groupId}
        emptyLabel={t("admin.trainings.genAllNoGroups")}
      />
      {anySkipped ? (
        <p className="state state--error" role="alert">
          {t("admin.trainings.genAllSkippedNote")}
        </p>
      ) : null}
    </Modal>
  );
}

// ── Change capacity modal ──────────────────────────────────────────────────

interface ChangeCapacityModalProps {
  target: Training | null;
  pending: boolean;
  error?: string;
  onClose: () => void;
  onSubmit: (capacity: number) => void;
}

function ChangeCapacityModal({
  target,
  pending,
  error,
  onClose,
  onSubmit
}: ChangeCapacityModalProps): JSX.Element {
  const t = useT();
  const [capacity, setCapacity] = useState<number | null>(target?.capacity ?? null);

  // Reset the field to the target's capacity whenever a new row is opened.
  const [seededFor, setSeededFor] = useState<string | null>(null);
  if (target && seededFor !== target.id) {
    setSeededFor(target.id);
    setCapacity(target.capacity);
  }

  return (
    <Modal
      open={target !== null}
      title={t("admin.trainings.capacityTitle")}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("admin.action.cancel")}
          </Button>
          <Button
            disabled={capacity === null || pending}
            onClick={() => {
              if (capacity === null) return;
              onSubmit(capacity);
            }}
          >
            {pending ? t("admin.action.saving") : t("admin.action.save")}
          </Button>
        </>
      }
    >
      {target ? (
        <NumberField
          label={t("admin.field.capacity")}
          value={capacity}
          onValueChange={setCapacity}
          min={1}
          hint={t("admin.trainings.capacityHint", { booked: target.bookedCount })}
          error={error}
        />
      ) : null}
    </Modal>
  );
}

// ── Add person modal (Feature 5 — admin/trainer manual booking) ──────────────

type AddPersonMode = "existing" | "new";

interface AddPersonModalProps {
  target: Training | null;
  onClose: () => void;
  onBooked: (name: string) => void;
}

/**
 * Feature 5 — book a person onto a training without a Telegram account. Two
 * modes: pick an existing client (server-searched), or create a walk-in by name
 * (+optional phone/note) and book the returned client. All capacity / status /
 * duplicate decisions and authorization are the server's; the console renders
 * its verbatim error (e.g. a full or duplicate booking → 409) and computes
 * nothing.
 */
function AddPersonModal({ target, onClose, onBooked }: AddPersonModalProps): JSX.Element {
  const t = useT();
  const open = target !== null;

  const [mode, setMode] = useState<AddPersonMode>("existing");
  const [search, setSearch] = useState("");
  const [pickedClientId, setPickedClientId] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");

  const createWalkIn = useCreateWalkIn();
  const bookManual = useBookManual();
  const clients = useClientsList(
    { search: search.trim() || undefined },
    { enabled: open && mode === "existing" }
  );

  // Reset the form whenever a different training opens the modal.
  const [seededFor, setSeededFor] = useState<string | null>(null);
  if (target && seededFor !== target.id) {
    setSeededFor(target.id);
    setMode("existing");
    setSearch("");
    setPickedClientId("");
    setName("");
    setPhone("");
    setNote("");
    createWalkIn.reset();
    bookManual.reset();
  }

  const pending = createWalkIn.isPending || bookManual.isPending;
  const errorMessage = bookManual.isError
    ? errorText(bookManual.error, t)
    : createWalkIn.isError
      ? errorText(createWalkIn.error, t)
      : undefined;

  const clientOptions: SelectOption[] = [
    { value: "", label: t("admin.trainings.addPersonPick") },
    ...(clients.data ?? []).map((c: Client) => ({
      value: c.id,
      label: c.phone ? `${c.name} · ${c.phone}` : c.name
    }))
  ];

  const canSubmit = !pending && (mode === "existing" ? pickedClientId !== "" : name.trim() !== "");

  /** Book a resolved client onto the target training; toast + close on success. */
  function bookClient(client: Client): void {
    if (!target) return;
    bookManual.mutate(
      { clientId: client.id, trainingId: target.id },
      { onSuccess: () => onBooked(client.name) }
    );
  }

  function handleSubmit(): void {
    if (!target || pending) return;
    if (mode === "existing") {
      const picked = (clients.data ?? []).find((c) => c.id === pickedClientId);
      if (!picked) return;
      bookClient(picked);
      return;
    }
    const trimmedName = name.trim();
    if (trimmedName === "") return;
    createWalkIn.mutate(
      {
        name: trimmedName,
        ...(phone.trim() ? { phone: phone.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {})
      },
      { onSuccess: (client) => bookClient(client) }
    );
  }

  const modeOptions: SelectOption[] = [
    { value: "existing", label: t("admin.trainings.addPersonModeExisting") },
    { value: "new", label: t("admin.trainings.addPersonModeNew") }
  ];

  return (
    <Modal
      open={open}
      title={t("admin.trainings.addPersonTitle")}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("admin.action.cancel")}
          </Button>
          <Button disabled={!canSubmit} onClick={handleSubmit}>
            {pending ? t("admin.trainings.addPersonBooking") : t("admin.trainings.addPersonSubmit")}
          </Button>
        </>
      }
    >
      <SelectField
        label={t("admin.trainings.addPersonTitle")}
        options={modeOptions}
        value={mode}
        onChange={(e) => setMode(e.target.value as AddPersonMode)}
      />

      {mode === "existing" ? (
        <>
          <TextField
            label={t("admin.trainings.addPersonSearchLabel")}
            placeholder={t("admin.trainings.addPersonSearchPlaceholder")}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPickedClientId("");
            }}
          />
          {clients.isError ? (
            <p className="state state--error" role="alert">
              {errorText(clients.error, t)}
            </p>
          ) : clients.isFetching ? (
            <p className="state">{t("admin.trainings.addPersonSearching")}</p>
          ) : (clients.data ?? []).length === 0 ? (
            <p className="state">{t("admin.trainings.addPersonNoClients")}</p>
          ) : (
            <SelectField
              label={t("admin.trainings.addPersonPick")}
              options={clientOptions}
              value={pickedClientId}
              onChange={(e) => setPickedClientId(e.target.value)}
            />
          )}
        </>
      ) : (
        <>
          <TextField
            label={t("admin.trainings.addPersonFieldName")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            hint={t("admin.trainings.addPersonNewHint")}
          />
          <TextField
            label={t("admin.trainings.addPersonFieldPhone")}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <TextField
            label={t("admin.trainings.addPersonFieldNote")}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </>
      )}

      {errorMessage ? (
        <p className="state state--error" role="alert">
          {errorMessage}
        </p>
      ) : null}
    </Modal>
  );
}
