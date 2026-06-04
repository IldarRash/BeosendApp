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
import { useT } from "../i18n/LanguageProvider";
import { useGroups, useCreateGroup, useUpdateGroup } from "../hooks/useGroups";
import { useLevels } from "../hooks/useLevels";
import { useTrainers } from "../hooks/useTrainers";
import { formatRsd } from "../lib/format";

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** Render the selected weekdays as short labels in ISO order. Display only. */
function formatDays(days: readonly DayOfWeek[], t: Translate): string {
  return days.map((day) => t(`admin.day.short.${day}`)).join(", ");
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
  const t = useT();
  const levelOptions: SelectOption[] = [
    { value: "", label: t("admin.groups.pickLevel") },
    ...levels.map((level) => ({ value: level.id, label: level.name }))
  ];
  const trainerOptions: SelectOption[] = [
    { value: "", label: t("admin.groups.pickTrainer") },
    ...trainers.map((trainer) => ({ value: trainer.id, label: trainer.name }))
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <TextField
        label={t("admin.field.name")}
        value={form.name}
        onChange={(event) => onChange({ ...form, name: event.target.value })}
        required
      />
      <SelectField
        label={t("admin.field.level")}
        options={levelOptions}
        value={form.levelId}
        onChange={(event) => onChange({ ...form, levelId: event.target.value })}
      />
      <SelectField
        label={t("admin.field.trainer")}
        options={trainerOptions}
        value={form.trainerId}
        onChange={(event) => onChange({ ...form, trainerId: event.target.value })}
      />
      <DayOfWeekPicker
        label={t("admin.groups.fieldDays")}
        value={form.daysOfWeek}
        onChange={(days) => onChange({ ...form, daysOfWeek: days })}
      />
      <div className="grid">
        <TimeField
          label={t("admin.field.startTime")}
          value={form.startTime}
          onChange={(event) => onChange({ ...form, startTime: event.target.value })}
        />
        <TimeField
          label={t("admin.field.endTime")}
          value={form.endTime}
          onChange={(event) => onChange({ ...form, endTime: event.target.value })}
        />
      </div>
      <NumberField
        label={t("admin.field.capacity")}
        value={form.capacity}
        onValueChange={(value) => onChange({ ...form, capacity: value })}
        min={1}
      />
      <div className="grid">
        <NumberField
          label={t("admin.groups.fieldPriceSingle")}
          value={form.priceSingleRsd}
          onValueChange={(value) => onChange({ ...form, priceSingleRsd: value })}
          min={0}
        />
        <NumberField
          label={t("admin.groups.fieldPriceMonth")}
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
  const t = useT();
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
          notify(t("admin.groups.created"), "success");
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
            notify(t("admin.groups.updated"), "success");
            closeModal();
          },
          onError: (mutationError) => notify(mutationError.message, "error")
        }
      );
    }
  };

  const columns: Column<Group>[] = [
    { key: "name", header: t("admin.groups.colName"), render: (group) => group.name },
    { key: "days", header: t("admin.groups.colDays"), render: (group) => formatDays(group.daysOfWeek, t) },
    {
      key: "time",
      header: t("admin.groups.colTime"),
      render: (group) => `${group.startTime}–${group.endTime}`
    },
    { key: "capacity", header: t("admin.groups.colCapacity"), numeric: true, render: (group) => group.capacity },
    {
      key: "trainer",
      header: t("admin.groups.colTrainer"),
      render: (group) => nameFor(group.trainerId, trainerOptions)
    },
    {
      key: "level",
      header: t("admin.groups.colLevel"),
      render: (group) => nameFor(group.levelId, levelOptions)
    },
    {
      key: "priceSingle",
      header: t("admin.groups.colPriceSingle"),
      numeric: true,
      render: (group) => formatRsd(group.priceSingleRsd)
    },
    {
      key: "priceMonth",
      header: t("admin.groups.colPriceMonth"),
      numeric: true,
      render: (group) => formatRsd(group.priceMonthRsd)
    },
    {
      key: "status",
      header: t("admin.groups.colStatus"),
      render: (group) =>
        group.status === "active" ? t("admin.groups.statusActive") : t("admin.groups.statusInactive")
    },
    {
      key: "actions",
      header: "",
      render: (group) => (
        <Button
          variant="ghost"
          onClick={() => openEdit(group)}
          aria-label={t("admin.groups.editAria", { name: group.name })}
        >
          {t("admin.action.edit")}
        </Button>
      )
    }
  ];

  const referenceLoading = levels.isLoading || trainers.isLoading;

  return (
    <AppShell>
      <header className="page-head">
        <div>
          <h1>{t("admin.groups.title")}</h1>
          <p>{t("admin.groups.lead")}</p>
        </div>
        <Button onClick={openCreate} disabled={referenceLoading}>
          {t("admin.groups.create")}
        </Button>
      </header>

      {groups.isLoading ? (
        <p className="state state--loading">{t("admin.groups.loading")}</p>
      ) : groups.isError ? (
        <p className="state state--error" role="alert">
          {t("admin.groups.error")}
        </p>
      ) : (
        <DataTable
          caption={t("admin.groups.caption")}
          columns={columns}
          rows={groups.data ?? []}
          rowKey={(group) => group.id}
          emptyLabel={t("admin.groups.empty")}
        />
      )}

      <Modal
        open={target !== null}
        onClose={closeModal}
        title={target?.mode === "edit" ? t("admin.groups.editTitle") : t("admin.groups.createTitle")}
        footer={
          <>
            <Button variant="ghost" onClick={closeModal} disabled={activeMutation.isPending}>
              {t("admin.action.cancel")}
            </Button>
            <Button type="submit" form="group-form" disabled={activeMutation.isPending}>
              {activeMutation.isPending ? t("admin.action.saving") : t("admin.action.save")}
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
