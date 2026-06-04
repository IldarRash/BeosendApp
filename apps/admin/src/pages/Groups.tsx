import { useMemo, useState, type FormEvent } from "react";
import type {
  CreateGroupInput,
  DayOfWeek,
  Group,
  Level,
  Trainer,
  UpdateGroupInput
} from "@beosand/types";
import { AppShell } from "../ui/AppShell";
import { Button } from "../ui/Button";
import { DataTable, type Column } from "../ui/DataTable";
import { DayOfWeekPicker } from "../ui/DayOfWeekPicker";
import { Modal } from "../ui/Modal";
import { NumberField, SelectField, TextField, TimeField, type SelectOption } from "../ui/Field";
import { useToast } from "../ui/Toast";
import { useGroups, useCreateGroup, useUpdateGroup } from "../hooks/useGroups";
import { useLevels } from "../hooks/useLevels";
import { useTrainers } from "../hooks/useTrainers";
import { formatRsd } from "../lib/format";

const DAY_LABELS: Record<DayOfWeek, string> = {
  1: "Пн",
  2: "Вт",
  3: "Ср",
  4: "Чт",
  5: "Пт",
  6: "Сб",
  7: "Вс"
};

/** Render the selected weekdays as short RU labels in ISO order. Display only. */
function formatDays(days: readonly DayOfWeek[]): string {
  return days.map((day) => DAY_LABELS[day]).join(", ");
}

/** Editable group fields held in the form before submit. Prices/capacity stay nullable while typing. */
interface GroupFormState {
  name: string;
  levelId: string;
  trainerId: string;
  daysOfWeek: DayOfWeek[];
  startTime: string;
  endTime: string;
  capacity: number | null;
  priceSingleRsd: number | null;
  priceMonthRsd: number | null;
}

function emptyForm(): GroupFormState {
  return {
    name: "",
    levelId: "",
    trainerId: "",
    daysOfWeek: [],
    startTime: "",
    endTime: "",
    capacity: null,
    priceSingleRsd: null,
    priceMonthRsd: null
  };
}

function formFromGroup(group: Group): GroupFormState {
  return {
    name: group.name,
    levelId: group.levelId,
    trainerId: group.trainerId,
    daysOfWeek: [...group.daysOfWeek],
    startTime: group.startTime,
    endTime: group.endTime,
    capacity: group.capacity,
    priceSingleRsd: group.priceSingleRsd,
    priceMonthRsd: group.priceMonthRsd
  };
}

/**
 * Map the form state to the create contract. No domain validation here — the API
 * rejects bad time order / capacity / prices and we surface that error. We only
 * coerce empty numeric inputs to a sentinel the server will reject (0).
 */
function toCreateInput(form: GroupFormState): CreateGroupInput {
  return {
    name: form.name.trim(),
    levelId: form.levelId,
    trainerId: form.trainerId,
    daysOfWeek: form.daysOfWeek,
    startTime: form.startTime,
    endTime: form.endTime,
    capacity: form.capacity ?? 0,
    priceSingleRsd: form.priceSingleRsd ?? 0,
    priceMonthRsd: form.priceMonthRsd ?? 0
  };
}

function nameFor(id: string, options: SelectOption[]): string {
  return options.find((opt) => opt.value === id)?.label ?? "—";
}

interface GroupFormProps {
  form: GroupFormState;
  onChange: (next: GroupFormState) => void;
  levels: Level[];
  trainers: Trainer[];
  error?: string;
}

function GroupForm({ form, onChange, levels, trainers, error }: GroupFormProps): JSX.Element {
  const levelOptions: SelectOption[] = [
    { value: "", label: "Выберите уровень" },
    ...levels.map((level) => ({ value: level.id, label: level.name }))
  ];
  const trainerOptions: SelectOption[] = [
    { value: "", label: "Выберите тренера" },
    ...trainers.map((trainer) => ({ value: trainer.id, label: trainer.name }))
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <TextField
        label="Название"
        value={form.name}
        onChange={(event) => onChange({ ...form, name: event.target.value })}
        required
      />
      <SelectField
        label="Уровень"
        options={levelOptions}
        value={form.levelId}
        onChange={(event) => onChange({ ...form, levelId: event.target.value })}
      />
      <SelectField
        label="Тренер"
        options={trainerOptions}
        value={form.trainerId}
        onChange={(event) => onChange({ ...form, trainerId: event.target.value })}
      />
      <DayOfWeekPicker
        label="Дни недели"
        value={form.daysOfWeek}
        onChange={(days) => onChange({ ...form, daysOfWeek: days })}
      />
      <div className="grid">
        <TimeField
          label="Начало"
          value={form.startTime}
          onChange={(event) => onChange({ ...form, startTime: event.target.value })}
        />
        <TimeField
          label="Конец"
          value={form.endTime}
          onChange={(event) => onChange({ ...form, endTime: event.target.value })}
        />
      </div>
      <NumberField
        label="Вместимость"
        value={form.capacity}
        onValueChange={(value) => onChange({ ...form, capacity: value })}
        min={1}
      />
      <div className="grid">
        <NumberField
          label="Цена за занятие (RSD)"
          value={form.priceSingleRsd}
          onValueChange={(value) => onChange({ ...form, priceSingleRsd: value })}
          min={0}
        />
        <NumberField
          label="Цена за месяц (RSD)"
          value={form.priceMonthRsd}
          onValueChange={(value) => onChange({ ...form, priceMonthRsd: value })}
          min={0}
        />
      </div>
      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

type EditTarget = { mode: "create" } | { mode: "edit"; group: Group };

/** M1 — Groups: data-dense table + create/edit modal form. The API owns all domain rules. */
export function Groups(): JSX.Element {
  const groups = useGroups();
  const levels = useLevels();
  const trainers = useTrainers();
  const createGroup = useCreateGroup();
  const updateGroup = useUpdateGroup();
  const { notify } = useToast();

  const [target, setTarget] = useState<EditTarget | null>(null);
  const [form, setForm] = useState<GroupFormState>(emptyForm);

  const levelOptions: SelectOption[] = useMemo(
    () => (levels.data ?? []).map((level) => ({ value: level.id, label: level.name })),
    [levels.data]
  );
  const trainerOptions: SelectOption[] = useMemo(
    () => (trainers.data ?? []).map((trainer) => ({ value: trainer.id, label: trainer.name })),
    [trainers.data]
  );

  const activeMutation = target?.mode === "edit" ? updateGroup : createGroup;
  const submitError = activeMutation.isError ? activeMutation.error.message : undefined;

  const openCreate = (): void => {
    createGroup.reset();
    updateGroup.reset();
    setForm(emptyForm());
    setTarget({ mode: "create" });
  };

  const openEdit = (group: Group): void => {
    createGroup.reset();
    updateGroup.reset();
    setForm(formFromGroup(group));
    setTarget({ mode: "edit", group });
  };

  const closeModal = (): void => {
    setTarget(null);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!target) return;
    const input = toCreateInput(form);
    if (target.mode === "create") {
      createGroup.mutate(input, {
        onSuccess: () => {
          notify("Группа создана", "success");
          closeModal();
        },
        onError: (mutationError) => notify(mutationError.message, "error")
      });
    } else {
      const update: UpdateGroupInput = input;
      updateGroup.mutate(
        { id: target.group.id, input: update },
        {
          onSuccess: () => {
            notify("Группа обновлена", "success");
            closeModal();
          },
          onError: (mutationError) => notify(mutationError.message, "error")
        }
      );
    }
  };

  const columns: Column<Group>[] = [
    { key: "name", header: "Название", render: (group) => group.name },
    { key: "days", header: "Дни", render: (group) => formatDays(group.daysOfWeek) },
    {
      key: "time",
      header: "Время",
      render: (group) => `${group.startTime}–${group.endTime}`
    },
    { key: "capacity", header: "Мест", numeric: true, render: (group) => group.capacity },
    {
      key: "trainer",
      header: "Тренер",
      render: (group) => nameFor(group.trainerId, trainerOptions)
    },
    {
      key: "level",
      header: "Уровень",
      render: (group) => nameFor(group.levelId, levelOptions)
    },
    {
      key: "priceSingle",
      header: "За занятие",
      numeric: true,
      render: (group) => formatRsd(group.priceSingleRsd)
    },
    {
      key: "priceMonth",
      header: "За месяц",
      numeric: true,
      render: (group) => formatRsd(group.priceMonthRsd)
    },
    {
      key: "status",
      header: "Статус",
      render: (group) => (group.status === "active" ? "Активна" : "Неактивна")
    },
    {
      key: "actions",
      header: "",
      render: (group) => (
        <Button variant="ghost" onClick={() => openEdit(group)} aria-label={`Изменить группу ${group.name}`}>
          Изменить
        </Button>
      )
    }
  ];

  const referenceLoading = levels.isLoading || trainers.isLoading;

  return (
    <AppShell>
      <header className="page-head">
        <div>
          <h1>Группы</h1>
          <p>Регулярные слоты тренировок: расписание, тренер, цены. Все правила проверяет сервер.</p>
        </div>
        <Button onClick={openCreate} disabled={referenceLoading}>
          Создать группу
        </Button>
      </header>

      {groups.isLoading ? (
        <p className="state state--loading">Загрузка групп…</p>
      ) : groups.isError ? (
        <p className="state state--error" role="alert">
          Не удалось загрузить группы.
        </p>
      ) : (
        <DataTable
          caption="Группы тренировок"
          columns={columns}
          rows={groups.data ?? []}
          rowKey={(group) => group.id}
          emptyLabel="Групп пока нет. Создайте первую."
        />
      )}

      <Modal
        open={target !== null}
        onClose={closeModal}
        title={target?.mode === "edit" ? "Изменить группу" : "Создать группу"}
        footer={
          <>
            <Button variant="ghost" onClick={closeModal} disabled={activeMutation.isPending}>
              Отмена
            </Button>
            <Button type="submit" form="group-form" disabled={activeMutation.isPending}>
              {activeMutation.isPending ? "Сохранение…" : "Сохранить"}
            </Button>
          </>
        }
      >
        <form id="group-form" onSubmit={handleSubmit} noValidate>
          <GroupForm
            form={form}
            onChange={setForm}
            levels={levels.data ?? []}
            trainers={trainers.data ?? []}
            error={submitError}
          />
        </form>
      </Modal>
    </AppShell>
  );
}
