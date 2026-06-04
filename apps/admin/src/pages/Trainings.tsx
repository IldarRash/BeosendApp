import { useMemo, useState } from "react";
import type {
  ChangeCapacityInput,
  GenerateMonthInput,
  Group,
  ListTrainingsQuery,
  Training,
  TrainingStatus
} from "@beosand/types";
import { AppShell } from "../ui/AppShell";
import { Button } from "../ui/Button";
import { DataTable, type Column } from "../ui/DataTable";
import { Modal } from "../ui/Modal";
import { NumberField, SelectField, TextField, type SelectOption } from "../ui/Field";
import { useToast } from "../ui/Toast";
import { useT } from "../i18n/LanguageProvider";
import { useGroups } from "../hooks/useGroups";
import { useTrainers } from "../hooks/useTrainers";
import {
  useCancelTraining,
  useChangeCapacity,
  useGenerateMonth,
  useTrainings
} from "../hooks/useTrainings";

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** Catalog key for a training status the API returns (never recomputed here). */
function statusLabel(status: TrainingStatus, t: Translate): string {
  return t(`admin.trainings.status${status.charAt(0).toUpperCase()}${status.slice(1)}`);
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

  // ── Range / group filter ───────────────────────────────────────────────
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [filterGroupId, setFilterGroupId] = useState("");

  const groups = useGroups();
  const trainers = useTrainers();

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

  // ── Cancel ─────────────────────────────────────────────────────────────
  const [cancelTarget, setCancelTarget] = useState<Training | null>(null);
  const cancel = useCancelTraining();

  // ── Change capacity ────────────────────────────────────────────────────
  const [capacityTarget, setCapacityTarget] = useState<Training | null>(null);
  const changeCapacity = useChangeCapacity();

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
        <Button onClick={() => setGenOpen(true)}>{t("admin.trainings.generate")}</Button>
      </header>

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

      <GenerateMonthModal
        open={genOpen}
        groups={groups.data ?? []}
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
              notify(t("admin.trainings.generated", { count: rows.length }), "success");
            }
          });
        }}
      />

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
    </AppShell>
  );
}

// ── Generate month modal ───────────────────────────────────────────────────

interface GenerateMonthModalProps {
  open: boolean;
  groups: Group[];
  pending: boolean;
  error?: string;
  onClose: () => void;
  onSubmit: (input: GenerateMonthInput) => void;
}

function GenerateMonthModal({
  open,
  groups,
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

  const groupOptions: SelectOption[] = [
    { value: "", label: t("admin.trainings.pickGroup") },
    ...groups.map((g) => ({ value: g.id, label: g.name }))
  ];

  const canSubmit = groupId !== "" && year !== null && !pending;

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
              if (groupId === "" || year === null) return;
              onSubmit({ groupId, year, month: Number.parseInt(month, 10) });
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
        value={groupId}
        onChange={(e) => setGroupId(e.target.value)}
      />
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
