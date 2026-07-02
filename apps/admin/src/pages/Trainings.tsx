import { useMemo, useState } from "react";
import {
  isoDate,
  type ChangeCapacityInput,
  type Client,
  type Court,
  type DayOfWeek,
  type GenerateAllResult,
  type GenerateIndividualMonthInput,
  type GenerateMonthInput,
  type Group,
  type ListTrainingsQuery,
  type RescheduleTrainingInput,
  type Trainer,
  type Training,
  type TrainingStatus,
  type UpdateTrainingScheduleCourtInput,
  type UpdateIndividualPriceInput
} from "@beosand/types";
import { AppShell } from "../ui/AppShell";
import { Button } from "../ui/Button";
import { DataTable, type Column } from "../ui/DataTable";
import { Modal } from "../ui/Modal";
import { DayOfWeekPicker } from "../ui/DayOfWeekPicker";
import { TrainingRosterModal } from "../ui/TrainingRosterModal";
import { NumberField, SelectField, TextField, TimeField, type SelectOption } from "../ui/Field";
import { useToast } from "../ui/Toast";
import { useT } from "../i18n/LanguageProvider";
import { formatRsd } from "../lib/format";
import { useCourts } from "../hooks/useCourts";
import { useGroups } from "../hooks/useGroups";
import { useTrainers } from "../hooks/useTrainers";
import { useBookManual, useClientsList, useCreateWalkIn } from "../hooks/useClients";
import { useGenerationStatus } from "../hooks/useGenerationStatus";
import { useTrainingDetail } from "../hooks/useTrainingDetail";
import {
  useChangeCapacity,
  useDeleteTraining,
  useDeleteTrainingSeries,
  useGenerateAllGroups,
  useGenerateIndividualMonth,
  useGenerateMonth,
  useRescheduleTraining,
  useUpdateTrainingSchedule,
  useUpdateIndividualPrice,
  useTrainings
} from "../hooks/useTrainings";
import { TrainingsCalendar } from "./TrainingsCalendar";

type TrainingsView = "table" | "calendar";
type DeleteScope = "single" | "series";
type EditScope = "single" | "series";
type TrainingEditTarget = Training & { courtId?: string | null; courtNumber?: number | null };

type Translate = (key: string, params?: Record<string, string | number>) => string;

const TRAINING_GROUP_FILTER_INDIVIDUAL = "__individual";
const TRAINING_GROUP_FILTER_ONE_OFF = "__one_off";

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

/** UI hint only; the API still enforces which rows support individual actions. */
function isIndividualTraining(row: Training): boolean {
  return row.groupId === null && row.clientId !== null;
}

/** Display-only client option label; search/matching still happens on the server. */
function clientLabel(client: Client): string {
  return [client.name, client.telegramUsername ? `@${client.telegramUsername}` : null, client.phone]
    .filter(Boolean)
    .join(" · ");
}

function trainingPriceLabel(row: Training, t: Translate): string {
  if (!isIndividualTraining(row)) return "—";
  return row.priceSingleRsd === null
    ? t("admin.trainings.priceUnset")
    : formatRsd(row.priceSingleRsd);
}

function trainingTimeRangeLabel(row: Training): string {
  return `${row.startTime}–${row.endTime}`;
}

function trainingGroupFilterValue(row: Training): string {
  if (row.groupId) return row.groupId;
  return row.clientId ? TRAINING_GROUP_FILTER_INDIVIDUAL : TRAINING_GROUP_FILTER_ONE_OFF;
}

/**
 * M1 — Trainings management. A from/to (optionally group-scoped) range feeds
 * listTrainings into a DataTable showing the API's own booked/capacity and
 * status — no client recompute. Admin can generate a month for a group, delete a
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
  const [showTerminal, setShowTerminal] = useState(false);

  const groups = useGroups();
  const trainers = useTrainers();
  const courts = useCourts();

  const query: ListTrainingsQuery | null =
    from && to
      ? { from, to, ...(filterGroupId ? { groupId: filterGroupId } : {}), ...(showTerminal ? { includeTerminal: true } : {}) }
      : null;
  const trainings = useTrainings(query);

  const groupOptions = useMemo<SelectOption[]>(
    () => [
      { value: "", label: t("admin.trainings.allGroups") },
      ...(groups.data ?? []).map((g) => ({ value: g.id, label: g.name }))
    ],
    [groups.data, t]
  );

  // Group cell label: a group's name, or — for a group-less training — whether it is
  // an individual (1-on-1, clientId set) session or a plain one-off. The API decides
  // both fields; the console only renders the right label, never the court/identity.
  const groupCell = useMemo(() => {
    const map = new Map<string, string>();
    for (const g of groups.data ?? []) map.set(g.id, g.name);
    return (row: Training): string => {
      if (row.groupId) return map.get(row.groupId) ?? "—";
      return row.clientId ? t("admin.trainings.individual") : t("admin.trainings.oneOff");
    };
  }, [groups.data, t]);

  const trainerName = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of trainers.data ?? []) map.set(t.id, t.name);
    return (id: string): string => map.get(id) ?? "—";
  }, [trainers.data]);

  const tableGroupOptions = useMemo(
    () => [
      { value: TRAINING_GROUP_FILTER_INDIVIDUAL, label: t("admin.trainings.individual") },
      { value: TRAINING_GROUP_FILTER_ONE_OFF, label: t("admin.trainings.oneOff") },
      ...(groups.data ?? []).map((g) => ({ value: g.id, label: g.name }))
    ],
    [groups.data, t]
  );

  const tableTrainerOptions = useMemo(
    () => (trainers.data ?? []).map((tr) => ({ value: tr.id, label: tr.name })),
    [trainers.data]
  );

  const tableStatusOptions = useMemo(
    () =>
      (["open", "full", "cancelled", "completed"] as TrainingStatus[]).map((status) => ({
        value: status,
        label: statusLabel(status, t)
      })),
    [t]
  );

  // ── Generate month ─────────────────────────────────────────────────────
  const [genOpen, setGenOpen] = useState(false);
  const generate = useGenerateMonth();

  // ── Generate all groups (Feature 3) ─────────────────────────────────────
  const [genAllOpen, setGenAllOpen] = useState(false);
  const generateAll = useGenerateAllGroups();
  const [allResult, setAllResult] = useState<GenerateAllResult | null>(null);

  // ── Generate individual (1-on-1) trainings ──────────────────────────────
  const [genIndividualOpen, setGenIndividualOpen] = useState(false);
  const generateIndividual = useGenerateIndividualMonth();

  // ── Reschedule a training's time (single or whole individual series) ──────
  const [editTarget, setEditTarget] = useState<TrainingEditTarget | null>(null);
  const reschedule = useRescheduleTraining();
  const updatePrice = useUpdateIndividualPrice();
  const updateSchedule = useUpdateTrainingSchedule();
  const editDetail = useTrainingDetail(editTarget?.id ?? null);
  const hydratedEditTarget =
    editTarget && editDetail.data?.id === editTarget.id
      ? {
          ...editTarget,
          courtId: editDetail.data.courtId,
          courtNumber: editDetail.data.courtNumber
        }
      : editTarget;

  // ── Delete ─────────────────────────────────────────────────────────────
  const [deleteTarget, setDeleteTarget] = useState<Training | null>(null);
  const [deleteScope, setDeleteScope] = useState<DeleteScope>("single");
  const del = useDeleteTraining();
  const deleteSeries = useDeleteTrainingSeries();

  // ── Change capacity ────────────────────────────────────────────────────
  const changeCapacity = useChangeCapacity();

  // ── Add person (Feature 5 — admin/trainer manual booking) ────────────────
  const [addPersonTarget, setAddPersonTarget] = useState<Training | null>(null);

  // ── Roster (who signed up for this date — incl. one-time drop-ins) ────────
  const [rosterTarget, setRosterTarget] = useState<Training | null>(null);

  const columns: Column<Training>[] = [
    {
      key: "date",
      header: t("admin.trainings.colDate"),
      render: (row) => row.date,
      sortValue: (row) => row.date,
      filter: { kind: "date", value: (row) => row.date }
    },
    {
      key: "time",
      header: t("admin.trainings.colTime"),
      render: (row) => trainingTimeRangeLabel(row),
      sortValue: (row) => row.startTime,
      filter: { kind: "text", value: (row) => trainingTimeRangeLabel(row) }
    },
    {
      key: "group",
      header: t("admin.trainings.colGroup"),
      render: (row) => groupCell(row),
      sortValue: (row) => groupCell(row),
      filter: { kind: "select", value: (row) => trainingGroupFilterValue(row), options: tableGroupOptions }
    },
    {
      key: "trainer",
      header: t("admin.trainings.colTrainer"),
      render: (row) => trainerName(row.trainerId),
      sortValue: (row) => trainerName(row.trainerId),
      filter: { kind: "select", value: (row) => row.trainerId, options: tableTrainerOptions }
    },
    {
      key: "price",
      header: t("admin.trainings.colPrice"),
      numeric: true,
      render: (row) => trainingPriceLabel(row, t),
      sortValue: (row) => row.priceSingleRsd,
      filter: { kind: "number", value: (row) => row.priceSingleRsd }
    },
    {
      key: "occupancy",
      header: t("admin.trainings.colOccupancy"),
      numeric: true,
      render: (row) => `${row.bookedCount} / ${row.capacity}`,
      sortValue: (row) => row.bookedCount,
      filter: { kind: "number", value: (row) => row.bookedCount }
    },
    {
      key: "status",
      header: t("admin.trainings.colStatus"),
      render: (row) => statusLabel(row.status, t),
      sortValue: (row) => statusLabel(row.status, t),
      filter: { kind: "select", value: (row) => row.status, options: tableStatusOptions }
    },
    {
      key: "actions",
      header: t("admin.trainings.colActions"),
      render: (row) => {
        const individual = isIndividualTraining(row);
        return (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button variant="ghost" onClick={() => setRosterTarget(row)}>
              {t("admin.roster.open")}
            </Button>
            <Button
              variant="ghost"
              onClick={() => setAddPersonTarget(row)}
              disabled={
                (row.status === "full" && !individual) ||
                row.status === "cancelled" ||
                row.status === "completed"
              }
            >
              {t("admin.trainings.actionAddPerson")}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                reschedule.reset();
                updatePrice.reset();
                changeCapacity.reset();
                updateSchedule.reset();
                setEditTarget(row);
              }}
              disabled={row.status === "cancelled" || row.status === "completed"}
            >
              {t("admin.action.edit")}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                del.reset();
                deleteSeries.reset();
                setDeleteScope("single");
                setDeleteTarget(row);
              }}
              disabled={row.status === "completed"}
            >
              {t("admin.trainings.actionDelete")}
            </Button>
          </div>
        );
      }
    }
  ];

  const deleteAsSeries =
    deleteTarget !== null && isIndividualTraining(deleteTarget) && deleteScope === "series";
  const deletePending = deleteAsSeries ? deleteSeries.isPending : del.isPending;
  const deleteError = deleteAsSeries
    ? deleteSeries.isError
      ? errorText(deleteSeries.error, t)
      : undefined
    : del.isError
      ? errorText(del.error, t)
      : undefined;

  const editError = reschedule.isError
    ? errorText(reschedule.error, t)
    : updatePrice.isError
        ? errorText(updatePrice.error, t)
        : changeCapacity.isError
          ? errorText(changeCapacity.error, t)
        : updateSchedule.isError
          ? errorText(updateSchedule.error, t)
          : undefined;
  const editPending =
    reschedule.isPending ||
    updatePrice.isPending ||
    changeCapacity.isPending ||
    updateSchedule.isPending;

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
          <Button variant="ghost" onClick={() => setGenIndividualOpen(true)}>
            {t("admin.trainings.generateIndividual")}
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
            <label className="cluster">
              <input
                type="checkbox"
                checked={showTerminal}
                onChange={(event) => setShowTerminal(event.target.checked)}
              />
              {t("admin.trainings.showTerminal")}
            </label>
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

      <GenerateIndividualModal
        open={genIndividualOpen}
        trainers={trainers.data ?? []}
        pending={generateIndividual.isPending}
        error={generateIndividual.isError ? errorText(generateIndividual.error, t) : undefined}
        onClose={() => {
          generateIndividual.reset();
          setGenIndividualOpen(false);
        }}
        onSubmit={(input) => {
          generateIndividual.mutate(input, {
            onSuccess: (result) => {
              setGenIndividualOpen(false);
              // Move the table to the generated month so the new rows are visible.
              const range = monthRange(input.year, input.month);
              setFrom(range.from);
              setTo(range.to);
              notify(
                t("admin.trainings.individualGenerated", { count: result.created.length }),
                "success"
              );
            }
          });
        }}
      />

      <TrainingEditModal
        target={hydratedEditTarget}
        courts={courts.data ?? []}
        pending={editPending}
        error={editError}
        onClose={() => {
          reschedule.reset();
          updatePrice.reset();
          changeCapacity.reset();
          updateSchedule.reset();
          setEditTarget(null);
        }}
        onSubmit={(changes) => {
          if (!editTarget) return;
          let pendingOperations = 0;
          const finishOrClose = () => {
            pendingOperations -= 1;
            if (pendingOperations === 0) {
              setEditTarget(null);
            }
          };

          const scheduleInput: UpdateTrainingScheduleCourtInput = {
            ...(changes.time && !changes.time.series ? changes.time.input : {}),
            ...(changes.courtId && !changes.time?.series ? { courtId: changes.courtId } : {})
          };
          const hasScheduleUpdate = Object.keys(scheduleInput).length > 0;

          if (hasScheduleUpdate) {
            pendingOperations += 1;
            updateSchedule.mutate(
              { id: editTarget.id, input: scheduleInput },
              {
                onSuccess: () => {
                  const message =
                    changes.time && changes.courtId
                      ? t("admin.trainings.rescheduledSingle")
                      : changes.time
                        ? t("admin.trainings.rescheduledSingle")
                        : t("admin.trainings.courtUpdated");
                  notify(message, "success");
                  finishOrClose();
                }
              }
            );
          }

          if (changes.time?.series) {
            pendingOperations += 1;
            reschedule.mutate(
              { id: editTarget.id, input: changes.time.input, series: changes.time.series },
              {
                onSuccess: () => {
                  notify(t("admin.trainings.rescheduledSeries"), "success");
                  finishOrClose();
                }
              }
            );
          }

          if (changes.price) {
            pendingOperations += 1;
            updatePrice.mutate(
              { id: editTarget.id, input: changes.price.input, series: changes.price.series },
            {
                onSuccess: () => {
                  const message = changes.price?.series
                    ? t("admin.trainings.priceUpdatedSeries")
                    : t("admin.trainings.priceUpdatedSingle");
                  notify(message, "success");
                  finishOrClose();
                }
              }
            );
          }

          if (changes.capacity !== undefined) {
            pendingOperations += 1;
            const input: ChangeCapacityInput = { capacity: changes.capacity };
            changeCapacity.mutate(
              { id: editTarget.id, input },
              {
                onSuccess: (updated) => {
                  notify(
                    t("admin.trainings.capacityUpdated", {
                      capacity: updated.capacity,
                      status: statusLabel(updated.status, t)
                    }),
                    "success"
                  );
                  finishOrClose();
                }
              }
            );
          }

          if (pendingOperations === 0) {
            setEditTarget(null);
          }
        }}
      />

      <Modal
        open={deleteTarget !== null}
        title={t("admin.trainings.deleteTitle")}
        onClose={() => {
          del.reset();
          deleteSeries.reset();
          setDeleteTarget(null);
        }}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                del.reset();
                deleteSeries.reset();
                setDeleteTarget(null);
              }}
            >
              {t("admin.trainings.deleteKeep")}
            </Button>
            <Button
              variant="danger"
              disabled={deletePending}
              onClick={() => {
                if (!deleteTarget) return;
                if (deleteAsSeries) {
                  deleteSeries.mutate(deleteTarget.id, {
                    onSuccess: (result) => {
                      setDeleteTarget(null);
                      notify(
                        t("admin.trainings.deletedSeries", { count: result.ids.length }),
                        "success"
                      );
                    }
                  });
                  return;
                }
                del.mutate(deleteTarget.id, {
                  onSuccess: () => {
                    setDeleteTarget(null);
                    notify(t("admin.trainings.deleted"), "success");
                  }
                });
              }}
            >
              {deletePending ? t("admin.trainings.deleting") : t("admin.trainings.deleteConfirm")}
            </Button>
          </>
        }
      >
        {deleteTarget ? (
          <p>
            {t("admin.trainings.deletePrompt", {
              date: deleteTarget.date,
              start: deleteTarget.startTime,
              end: deleteTarget.endTime,
              count: deleteTarget.bookedCount
            })}
          </p>
        ) : null}
        {deleteTarget && isIndividualTraining(deleteTarget) ? (
          <SelectField
            label={t("admin.trainings.deleteScope")}
            options={[
              { value: "single", label: t("admin.trainings.deleteScopeSingle") },
              { value: "series", label: t("admin.trainings.deleteScopeSeries") }
            ]}
            value={deleteScope}
            onChange={(e) => setDeleteScope(e.target.value as DeleteScope)}
            hint={t("admin.trainings.deleteScopeHint")}
          />
        ) : null}
        {deleteError ? (
          <p className="state state--error" role="alert">
            {deleteError}
          </p>
        ) : null}
      </Modal>

      <AddPersonModal
        target={addPersonTarget}
        onClose={() => setAddPersonTarget(null)}
        onBooked={(name) => {
          setAddPersonTarget(null);
          notify(t("admin.trainings.addPersonBooked", { name }), "success");
        }}
      />

      <TrainingRosterModal
        trainingId={rosterTarget?.id ?? null}
        onClose={() => setRosterTarget(null)}
        t={t}
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

type TrainingEditChanges = {
  time?: {
    input: RescheduleTrainingInput;
    series: boolean;
  };
  price?: {
    input: UpdateIndividualPriceInput;
    series: boolean;
  };
  capacity?: number;
  courtId?: string;
};

interface TrainingEditModalProps {
  target: TrainingEditTarget | null;
  courts: Court[];
  pending: boolean;
  error?: string;
  onClose: () => void;
  onSubmit: (changes: TrainingEditChanges) => void;
}
/**
 * Consolidated edit modal for time/price/capacity/court updates.
 *
 * Time and price are only exposed for individual trainings and support the
 * existing "single/series" scope semantics. Capacity and court are shown for
 * mutable rows, but court changes are single-training only; only changed fields
 * are submitted.
 */
function TrainingEditModal({
  target,
  courts,
  pending,
  error,
  onClose,
  onSubmit
}: TrainingEditModalProps): JSX.Element {
  const t = useT();
  const open = target !== null;
  const isIndividual = target !== null && isIndividualTraining(target);

  const [seededFor, setSeededFor] = useState<string | null>(null);
  const [timeScope, setTimeScope] = useState<EditScope>("single");
  const [priceScope, setPriceScope] = useState<EditScope>("single");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [price, setPrice] = useState<number | null>(null);
  const [capacity, setCapacity] = useState<number | null>(null);
  const [courtId, setCourtId] = useState("");

  const seedKey = target ? `${target.id}:${target.courtId ?? ""}` : null;
  if (target && seededFor !== seedKey) {
    setSeededFor(seedKey);
    setTimeScope("single");
    setPriceScope("single");
    setStartTime(target.startTime);
    setEndTime(target.endTime);
    setPrice(target.priceSingleRsd);
    setCapacity(target.capacity);
    setCourtId(target.courtId ?? "");
  }

  const currentCourtId = target?.courtId ?? "";
  const timeHasChanges =
    isIndividual &&
    target !== null &&
    (startTime !== target.startTime || endTime !== target.endTime);
  const priceHasChanges = isIndividual && target !== null && price !== target.priceSingleRsd;
  const capacityHasChanges = target !== null && capacity !== null && capacity !== target.capacity;
  const timeSeriesSelected = isIndividual && timeScope === "series";
  const courtHasChanges = !timeSeriesSelected && courtId !== currentCourtId;
  const hasChanges = timeHasChanges || priceHasChanges || capacityHasChanges || courtHasChanges;
  const canSubmit = open && !pending && capacity !== null && hasChanges;

  const currentCourtMissing =
    currentCourtId !== "" && courts.every((court) => court.id !== currentCourtId);
  const currentCourtOption: SelectOption[] =
    currentCourtMissing && target?.courtNumber
      ? [{ value: currentCourtId, label: t("admin.trainings.courtOption", { number: target.courtNumber }) }]
      : [];
  const courtOptions: SelectOption[] = [
    ...(currentCourtId === "" ? [{ value: "", label: t("admin.trainings.courtNoChange") }] : []),
    ...currentCourtOption,
    ...courts.map((court) => ({
      value: court.id,
      label: t("admin.trainings.courtOption", { number: court.number })
    }))
  ];

  const scopeOptions: SelectOption[] = [
    { value: "single", label: t("admin.trainings.rescheduleScopeSingle") },
    { value: "series", label: t("admin.trainings.rescheduleScopeSeries") }
  ];

  function handleSubmit(): void {
    if (!canSubmit || !target) return;

    const changes: TrainingEditChanges = {};

    if (timeHasChanges) {
      changes.time = {
        input: { startTime, endTime },
        series: timeScope === "series"
      };
    }

    if (priceHasChanges) {
      changes.price = {
        input: { priceSingleRsd: price },
        series: priceScope === "series"
      };
    }

    if (capacityHasChanges) {
      changes.capacity = capacity;
    }

    if (courtHasChanges && courtId !== "") {
      changes.courtId = courtId;
    }

    onSubmit(changes);
  }

  return (
    <Modal
      open={open}
      title={t("admin.action.edit")}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("admin.action.cancel")}
          </Button>
          <Button disabled={!canSubmit} onClick={handleSubmit}>
            {pending ? t("admin.action.saving") : t("admin.action.save")}
          </Button>
        </>
      }
    >
      {target ? (
        <>
          <p className="state">
            {t("admin.trainings.reschedulePrompt", {
              date: target.date,
              start: target.startTime,
              end: target.endTime
            })}
          </p>
          {isIndividual ? (
            <>
              <SelectField
                label={t("admin.trainings.rescheduleScope")}
                options={scopeOptions}
                value={timeScope}
                onChange={(e) => {
                  const nextScope = e.target.value as EditScope;
                  setTimeScope(nextScope);
                  if (nextScope === "series") {
                    setCourtId(currentCourtId);
                  }
                }}
                hint={t("admin.trainings.rescheduleScopeHint")}
              />
              <TimeField
                label={t("admin.trainings.individualStart")}
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
              <TimeField
                label={t("admin.trainings.individualEnd")}
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </>
          ) : null}
          {isIndividual ? (
            <>
              <SelectField
                label={t("admin.trainings.priceScope")}
                options={scopeOptions}
                value={priceScope}
                onChange={(e) => setPriceScope(e.target.value as EditScope)}
                hint={t("admin.trainings.priceScopeHint")}
              />
              <NumberField
                label={t("admin.trainings.individualPrice")}
                value={price}
                onValueChange={setPrice}
                min={0}
                hint={t("admin.trainings.individualPriceHint")}
              />
            </>
          ) : null}
          <NumberField
            label={t("admin.field.capacity")}
            value={capacity}
            onValueChange={setCapacity}
            min={1}
            max={isIndividual ? 2 : undefined}
            hint={t("admin.trainings.capacityHint", { booked: target.bookedCount })}
          />
          <SelectField
            label={t("admin.field.court")}
            options={courtOptions}
            value={courtId}
            onChange={(e) => setCourtId(e.target.value)}
            disabled={timeSeriesSelected}
          />
        </>
      ) : null}
      {error ? (
        <p className="state state--error" role="alert">
          {error}
        </p>
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
  const [useBonus, setUseBonus] = useState(false);
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
    setUseBonus(false);
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
      label: clientLabel(c)
    }))
  ];

  const canSubmit = !pending && (mode === "existing" ? pickedClientId !== "" : name.trim() !== "");

  // The picked existing client, used to gate the "use bonus" checkbox to a client
  // that actually has a bonus balance (the server is the authority; this only hides
  // an option that would always be rejected).
  const pickedClient = (clients.data ?? []).find((c) => c.id === pickedClientId) ?? null;
  const canUseBonus = mode === "existing" && (pickedClient?.bonusTrainingCredits ?? 0) > 0;
  // Never send the flag when no balance is available (or a walk-in is being created).
  const redeemBonus = canUseBonus && useBonus;

  /** Book a resolved client onto the target training; toast + close on success. */
  function bookClient(client: Client, useBonusCredit: boolean): void {
    if (!target) return;
    bookManual.mutate(
      { clientId: client.id, trainingId: target.id, useBonusCredit },
      { onSuccess: () => onBooked(client.name) }
    );
  }

  function handleSubmit(): void {
    if (!target || pending) return;
    if (mode === "existing") {
      const picked = (clients.data ?? []).find((c) => c.id === pickedClientId);
      if (!picked) return;
      bookClient(picked, redeemBonus);
      return;
    }
    const trimmedName = name.trim();
    if (trimmedName === "") return;
    // A walk-in has no Telegram account and no bonus balance — never redeem here.
    createWalkIn.mutate(
      {
        name: trimmedName,
        ...(phone.trim() ? { phone: phone.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {})
      },
      { onSuccess: (client) => bookClient(client, false) }
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
              onChange={(e) => {
                setPickedClientId(e.target.value);
                setUseBonus(false);
              }}
            />
          )}
          {canUseBonus ? (
            <label className="cluster">
              <input
                type="checkbox"
                name="use-bonus"
                checked={useBonus}
                onChange={(e) => setUseBonus(e.target.checked)}
              />
              {t("admin.trainings.addPersonUseBonus", {
                balance: pickedClient?.bonusTrainingCredits ?? 0
              })}
            </label>
          ) : null}
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

// ── Generate individual (1-on-1) trainings modal ─────────────────────────────

interface GenerateIndividualModalProps {
  open: boolean;
  trainers: Trainer[];
  pending: boolean;
  error?: string;
  onClose: () => void;
  onSubmit: (input: GenerateIndividualMonthInput) => void;
}

/**
 * Generate a month of individual (1-on-1) trainings for one client with one
 * trainer (POST /trainings/generate-individual). The client is picked from the
 * server-searched list (mirroring AddPersonModal); the weekday set, time window,
 * year/month and per-session RSD price feed the strict contract. All schedule and
 * money decisions are the server's — the console only collects the inputs and
 * renders its verbatim error.
 */
function GenerateIndividualModal({
  open,
  trainers,
  pending,
  error,
  onClose,
  onSubmit
}: GenerateIndividualModalProps): JSX.Element {
  const t = useT();
  const now = new Date();

  const [search, setSearch] = useState("");
  const [clientId, setClientId] = useState("");
  const [trainerId, setTrainerId] = useState("");
  const [days, setDays] = useState<DayOfWeek[]>([]);
  const [startTime, setStartTime] = useState("18:00");
  const [endTime, setEndTime] = useState("19:00");
  const [year, setYear] = useState<number | null>(now.getFullYear());
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [price, setPrice] = useState<number | null>(null);

  const clients = useClientsList(
    { search: search.trim() || undefined },
    { enabled: open }
  );

  // Reset the form whenever the modal (re)opens, so a prior draft never leaks.
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setSearch("");
      setClientId("");
      setTrainerId("");
      setDays([]);
      setStartTime("18:00");
      setEndTime("19:00");
      setYear(now.getFullYear());
      setMonth(String(now.getMonth() + 1));
      setPrice(null);
    }
  }

  const clientOptions: SelectOption[] = [
    { value: "", label: t("admin.trainings.individualPickClient") },
    ...(clients.data ?? []).map((c: Client) => ({
      value: c.id,
      label: clientLabel(c)
    }))
  ];

  const trainerOptions: SelectOption[] = [
    { value: "", label: t("admin.trainings.individualPickTrainer") },
    ...trainers.map((tr) => ({ value: tr.id, label: tr.name }))
  ];

  const invalidTimeWindow = startTime !== "" && endTime !== "" && endTime <= startTime;
  const timeWindowError = invalidTimeWindow
    ? t("admin.trainings.individualTimeWindowError")
    : undefined;

  const canSubmit =
    !pending &&
    clientId !== "" &&
    trainerId !== "" &&
    days.length > 0 &&
    startTime !== "" &&
    endTime !== "" &&
    !invalidTimeWindow &&
    year !== null &&
    price !== null;

  function handleSubmit(): void {
    if (!canSubmit || year === null || price === null) return;
    onSubmit({
      clientId,
      trainerId,
      daysOfWeek: days,
      startTime,
      endTime,
      year,
      month: Number.parseInt(month, 10),
      priceSingleRsd: price
    });
  }

  return (
    <Modal
      open={open}
      title={t("admin.trainings.individualTitle")}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("admin.action.cancel")}
          </Button>
          <Button disabled={!canSubmit} onClick={handleSubmit}>
            {pending ? t("admin.trainings.generating") : t("admin.trainings.individualSubmit")}
          </Button>
        </>
      }
    >
      <p className="state">{t("admin.trainings.individualHint")}</p>
      <TextField
        label={t("admin.trainings.addPersonSearchLabel")}
        placeholder={t("admin.trainings.addPersonSearchPlaceholder")}
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setClientId("");
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
          label={t("admin.trainings.individualClient")}
          options={clientOptions}
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
        />
      )}
      <SelectField
        label={t("admin.trainings.individualTrainer")}
        options={trainerOptions}
        value={trainerId}
        onChange={(e) => setTrainerId(e.target.value)}
      />
      <DayOfWeekPicker
        label={t("admin.trainings.individualDays")}
        value={days}
        onChange={setDays}
      />
      <TimeField
        label={t("admin.trainings.individualStart")}
        value={startTime}
        onChange={(e) => setStartTime(e.target.value)}
      />
      <TimeField
        label={t("admin.trainings.individualEnd")}
        value={endTime}
        onChange={(e) => setEndTime(e.target.value)}
        error={timeWindowError}
      />
      <NumberField label={t("admin.trainings.fieldYear")} value={year} onValueChange={setYear} />
      <SelectField
        label={t("admin.trainings.fieldMonth")}
        options={monthOptions(t)}
        value={month}
        onChange={(e) => setMonth(e.target.value)}
      />
      <NumberField
        label={t("admin.trainings.individualPrice")}
        value={price}
        onValueChange={setPrice}
        min={0}
        hint={t("admin.trainings.individualPriceHint")}
      />
      {error ? (
        <p className="state state--error" role="alert">
          {error}
        </p>
      ) : null}
    </Modal>
  );
}
