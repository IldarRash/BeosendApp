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
import { useGroups } from "../hooks/useGroups";
import { useTrainers } from "../hooks/useTrainers";
import {
  useCancelTraining,
  useChangeCapacity,
  useGenerateMonth,
  useTrainings
} from "../hooks/useTrainings";

/** RU labels for the training status the API returns (never recomputed here). */
const STATUS_LABEL: Record<TrainingStatus, string> = {
  open: "Открыта",
  full: "Заполнена",
  cancelled: "Отменена",
  completed: "Завершена"
};

const MONTH_OPTIONS: SelectOption[] = [
  { value: "1", label: "Январь" },
  { value: "2", label: "Февраль" },
  { value: "3", label: "Март" },
  { value: "4", label: "Апрель" },
  { value: "5", label: "Май" },
  { value: "6", label: "Июнь" },
  { value: "7", label: "Июль" },
  { value: "8", label: "Август" },
  { value: "9", label: "Сентябрь" },
  { value: "10", label: "Октябрь" },
  { value: "11", label: "Ноябрь" },
  { value: "12", label: "Декабрь" }
];

/** Human-readable error from a failed mutation (the API decides the message). */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Не удалось выполнить операцию.";
}

/**
 * M1 — Trainings management. A from/to (optionally group-scoped) range feeds
 * listTrainings into a DataTable showing the API's own booked/capacity and
 * status — no client recompute. Admin can generate a month for a group, cancel a
 * training (behind a confirm), and change a training's capacity (the server
 * rejects a value below bookedCount; that error is rendered, never the floor).
 */
export function Trainings(): JSX.Element {
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
      { value: "", label: "Все группы" },
      ...(groups.data ?? []).map((g) => ({ value: g.id, label: g.name }))
    ],
    [groups.data]
  );

  const groupName = useMemo(() => {
    const map = new Map<string, string>();
    for (const g of groups.data ?? []) map.set(g.id, g.name);
    return (id: string | null): string => (id ? (map.get(id) ?? "—") : "Разовая");
  }, [groups.data]);

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
    { key: "date", header: "Дата", render: (t) => t.date },
    {
      key: "time",
      header: "Время",
      render: (t) => `${t.startTime}–${t.endTime}`
    },
    { key: "group", header: "Группа", render: (t) => groupName(t.groupId) },
    { key: "trainer", header: "Тренер", render: (t) => trainerName(t.trainerId) },
    {
      key: "occupancy",
      header: "Занятость",
      numeric: true,
      render: (t) => `${t.bookedCount} / ${t.capacity}`
    },
    {
      key: "status",
      header: "Статус",
      render: (t) => STATUS_LABEL[t.status]
    },
    {
      key: "actions",
      header: "Действия",
      render: (t) => (
        <div style={{ display: "flex", gap: 8 }}>
          <Button
            variant="ghost"
            onClick={() => {
              changeCapacity.reset();
              setCapacityTarget(t);
            }}
            disabled={t.status === "cancelled"}
          >
            Вместимость
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              cancel.reset();
              setCancelTarget(t);
            }}
            disabled={t.status === "cancelled" || t.status === "completed"}
          >
            Отменить
          </Button>
        </div>
      )
    }
  ];

  return (
    <AppShell>
      <header className="page-head">
        <div>
          <h1>Тренировки</h1>
          <p>Список по периоду и группе: статус, занятость, отмена и изменение вместимости.</p>
        </div>
        <Button onClick={() => setGenOpen(true)}>Сгенерировать месяц</Button>
      </header>

      <form
        aria-label="Фильтр тренировок"
        onSubmit={(e) => e.preventDefault()}
        style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}
      >
        <TextField
          label="С даты"
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <TextField label="По дату" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <SelectField
          label="Группа"
          options={groupOptions}
          value={filterGroupId}
          onChange={(e) => setFilterGroupId(e.target.value)}
        />
      </form>

      {query === null ? (
        <p className="state">Укажите период (с даты и по дату), чтобы увидеть тренировки.</p>
      ) : trainings.isPending ? (
        <p className="state">Загрузка тренировок…</p>
      ) : trainings.isError ? (
        <p className="state state--error" role="alert">
          {errorText(trainings.error)}
        </p>
      ) : (
        <DataTable
          caption="Тренировки за выбранный период"
          columns={columns}
          rows={trainings.data}
          rowKey={(t) => t.id}
          emptyLabel="За выбранный период тренировок нет."
        />
      )}

      <GenerateMonthModal
        open={genOpen}
        groups={groups.data ?? []}
        pending={generate.isPending}
        error={generate.isError ? errorText(generate.error) : undefined}
        onClose={() => {
          generate.reset();
          setGenOpen(false);
        }}
        onSubmit={(input) => {
          generate.mutate(input, {
            onSuccess: (rows) => {
              setGenOpen(false);
              notify(
                `Месяц сгенерирован: тренировок в группе — ${rows.length}.`,
                "success"
              );
            }
          });
        }}
      />

      <Modal
        open={cancelTarget !== null}
        title="Отменить тренировку"
        onClose={() => setCancelTarget(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCancelTarget(null)}>
              Не отменять
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
                      `Тренировка отменена. Уведомлено записанных: ${updated.bookedCount}.`,
                      "success"
                    );
                  }
                });
              }}
            >
              {cancel.isPending ? "Отмена…" : "Отменить тренировку"}
            </Button>
          </>
        }
      >
        {cancelTarget ? (
          <p>
            Отменить тренировку {cancelTarget.date} {cancelTarget.startTime}–
            {cancelTarget.endTime}? Записанные клиенты ({cancelTarget.bookedCount}) получат
            уведомление.
          </p>
        ) : null}
        {cancel.isError ? (
          <p className="state state--error" role="alert">
            {errorText(cancel.error)}
          </p>
        ) : null}
      </Modal>

      <ChangeCapacityModal
        target={capacityTarget}
        pending={changeCapacity.isPending}
        error={changeCapacity.isError ? errorText(changeCapacity.error) : undefined}
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
                  `Вместимость обновлена: ${updated.capacity}, статус — ${STATUS_LABEL[updated.status]}.`,
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
  const now = new Date();
  const [groupId, setGroupId] = useState("");
  const [year, setYear] = useState<number | null>(now.getFullYear());
  const [month, setMonth] = useState(String(now.getMonth() + 1));

  const groupOptions: SelectOption[] = [
    { value: "", label: "Выберите группу" },
    ...groups.map((g) => ({ value: g.id, label: g.name }))
  ];

  const canSubmit = groupId !== "" && year !== null && !pending;

  return (
    <Modal
      open={open}
      title="Сгенерировать месяц"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button
            disabled={!canSubmit}
            onClick={() => {
              if (groupId === "" || year === null) return;
              onSubmit({ groupId, year, month: Number.parseInt(month, 10) });
            }}
          >
            {pending ? "Генерация…" : "Сгенерировать"}
          </Button>
        </>
      }
    >
      <p className="state">
        Создаёт тренировки на каждый день недели группы за месяц. Операция идемпотентна —
        существующие тренировки не дублируются.
      </p>
      <SelectField
        label="Группа"
        options={groupOptions}
        value={groupId}
        onChange={(e) => setGroupId(e.target.value)}
      />
      <NumberField label="Год" value={year} onValueChange={setYear} />
      <SelectField
        label="Месяц"
        options={MONTH_OPTIONS}
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
      title="Изменить вместимость"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button
            disabled={capacity === null || pending}
            onClick={() => {
              if (capacity === null) return;
              onSubmit(capacity);
            }}
          >
            {pending ? "Сохранение…" : "Сохранить"}
          </Button>
        </>
      }
    >
      {target ? (
        <NumberField
          label="Вместимость"
          value={capacity}
          onValueChange={setCapacity}
          min={1}
          hint={`Сейчас записано: ${target.bookedCount}. Сервер отклонит значение ниже записанных.`}
          error={error}
        />
      ) : null}
    </Modal>
  );
}
