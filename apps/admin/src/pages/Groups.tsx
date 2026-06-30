import { useMemo, useState, type FormEvent } from "react";
import type {
  Court,
  CreateGroupInput,
  DayOfWeek,
  Group,
  GroupMember,
  Level,
  Trainer,
  TransferGroupResult,
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
import { useGroups, useCreateGroup, useDeleteGroup, useUpdateGroup } from "../hooks/useGroups";
import { useGroupMembers, useTransferGroupMember } from "../hooks/useGroupMembers";
import { useCourts } from "../hooks/useCourts";
import { useLevels } from "../hooks/useLevels";
import { useTrainers } from "../hooks/useTrainers";
import { formatRsd } from "../lib/format";

/** The current calendar year/month — which month's roster to view/transfer. */
function currentYearMonth(): { year: number; month: number } {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

/** A member with a known clientId — the only ones the admin can transfer. */
function transferableName(member: GroupMember): string {
  return member.fullName ?? member.firstName;
}

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
  courtId: string;
  daysOfWeek: DayOfWeek[];
  startTime: string;
  endTime: string;
  capacity: number | null;
  priceSingleRsd: number | null;
  priceMonthRsd: number | null;
  /** true = hidden from clients; false = visible. New groups default to visible. */
  hidden: boolean;
}

function emptyForm(): GroupFormState {
  return {
    name: "",
    levelId: "",
    trainerId: "",
    courtId: "",
    daysOfWeek: [],
    startTime: "",
    endTime: "",
    capacity: null,
    priceSingleRsd: null,
    priceMonthRsd: null,
    hidden: false
  };
}

function formFromGroup(group: Group): GroupFormState {
  return {
    name: group.name,
    levelId: group.levelId,
    trainerId: group.trainerId,
    courtId: group.courtId ?? "",
    daysOfWeek: [...group.daysOfWeek],
    startTime: group.startTime,
    endTime: group.endTime,
    capacity: group.capacity,
    priceSingleRsd: group.priceSingleRsd,
    priceMonthRsd: group.priceMonthRsd,
    hidden: group.hidden
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
    courtId: form.courtId,
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
  courts: Court[];
  /** Visibility is only editable on an existing group; creation defaults to visible. */
  isEdit: boolean;
  error?: string;
}

function GroupForm({
  form,
  onChange,
  levels,
  trainers,
  courts,
  isEdit,
  error
}: GroupFormProps): JSX.Element {
  const t = useT();
  const levelOptions: SelectOption[] = [
    { value: "", label: t("admin.groups.pickLevel") },
    ...levels.map((level) => ({ value: level.id, label: level.name }))
  ];
  const trainerOptions: SelectOption[] = [
    { value: "", label: t("admin.groups.pickTrainer") },
    ...trainers.map((trainer) => ({ value: trainer.id, label: trainer.name }))
  ];
  const courtOptions: SelectOption[] = [
    { value: "", label: t("admin.groups.pickCourt") },
    ...courts.map((court) => ({
      value: court.id,
      label: t("admin.groups.courtLabel", { number: court.number })
    }))
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
      <SelectField
        label={t("admin.field.court")}
        options={courtOptions}
        value={form.courtId}
        onChange={(event) => onChange({ ...form, courtId: event.target.value })}
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
          step={1800}
        />
        <TimeField
          label={t("admin.field.endTime")}
          value={form.endTime}
          onChange={(event) => onChange({ ...form, endTime: event.target.value })}
          step={1800}
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
      {isEdit ? (
        <SelectField
          label={t("admin.groups.fieldVisibility")}
          value={form.hidden ? "hidden" : "visible"}
          onChange={(event) => onChange({ ...form, hidden: event.target.value === "hidden" })}
          options={[
            { value: "visible", label: t("admin.groups.visShown") },
            { value: "hidden", label: t("admin.groups.visHidden") }
          ]}
          hint={t("admin.groups.visibilityHint")}
        />
      ) : null}
      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** A pending transfer: which member, out of which group, to which (chosen) group. */
interface TransferTarget {
  member: GroupMember;
  fromGroup: Group;
}

interface TransferMemberModalProps {
  target: TransferTarget;
  groups: Group[];
  year: number;
  month: number;
  onClose: () => void;
}

/**
 * Move one member from `fromGroup` to a chosen other group for the current month.
 * The target select excludes the source group; the API owns all booking/capacity
 * math — this modal only collects the target and renders the server's result.
 */
function TransferMemberModal({
  target,
  groups,
  year,
  month,
  onClose
}: TransferMemberModalProps): JSX.Element {
  const t = useT();
  const { notify } = useToast();
  const transfer = useTransferGroupMember();
  const [toGroupId, setToGroupId] = useState("");

  const targetOptions: SelectOption[] = [
    { value: "", label: t("admin.groups.transferPickGroup") },
    ...groups
      .filter((group) => group.id !== target.fromGroup.id)
      .map((group) => ({ value: group.id, label: group.name }))
  ];

  const clientId = target.member.clientId;
  const memberName = transferableName(target.member);

  const handleConfirm = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!clientId || toGroupId === "") return;
    transfer.mutate(
      { clientId, fromGroupId: target.fromGroup.id, toGroupId, year, month },
      {
        onSuccess: (result: TransferGroupResult) => {
          notify(
            t("admin.groups.transferred", {
              moved: result.movedDates.length,
              cancelled: result.cancelledDates.length,
              skipped: result.skippedDates.length
            }),
            "success"
          );
          onClose();
        },
        onError: (mutationError) => notify(mutationError.message, "error")
      }
    );
  };

  const submitError = transfer.isError ? transfer.error.message : undefined;
  const canConfirm = Boolean(clientId) && toGroupId !== "" && !transfer.isPending;

  return (
    <Modal
      open
      onClose={onClose}
      title={t("admin.groups.transferTitle", { name: memberName })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={transfer.isPending}>
            {t("admin.action.cancel")}
          </Button>
          <Button type="submit" form="transfer-form" disabled={!canConfirm}>
            {transfer.isPending ? t("admin.groups.transferring") : t("admin.groups.transfer")}
          </Button>
        </>
      }
    >
      <form
        id="transfer-form"
        onSubmit={handleConfirm}
        noValidate
        style={{ display: "flex", flexDirection: "column", gap: "16px" }}
      >
        <p>
          {t("admin.groups.transferFrom")} <strong>{target.fromGroup.name}</strong>
        </p>
        <SelectField
          label={t("admin.groups.transferTarget")}
          options={targetOptions}
          value={toGroupId}
          onChange={(event) => setToGroupId(event.target.value)}
        />
        {submitError ? (
          <p className="field__error" role="alert">
            {submitError}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}

interface MembersDrawerProps {
  group: Group;
  groups: Group[];
  year: number;
  month: number;
  onClose: () => void;
}

/**
 * Per-group panel listing this month's members by full name, each with a Transfer
 * action. The API decides membership and returns full names only to admins; the
 * panel renders the validated result and never filters domain data itself.
 */
function MembersDrawer({ group, groups, year, month, onClose }: MembersDrawerProps): JSX.Element {
  const t = useT();
  const members = useGroupMembers(group.id, year, month);
  const [transferTarget, setTransferTarget] = useState<TransferTarget | null>(null);

  const columns: Column<GroupMember>[] = [
    {
      key: "name",
      header: t("admin.groups.colMember"),
      render: (member) => transferableName(member)
    },
    {
      key: "actions",
      header: "",
      render: (member) =>
        member.clientId ? (
          <Button
            variant="ghost"
            onClick={() => setTransferTarget({ member, fromGroup: group })}
            aria-label={t("admin.groups.transferAria", { name: transferableName(member) })}
          >
            {t("admin.groups.transfer")}
          </Button>
        ) : (
          "—"
        )
    }
  ];

  return (
    <Modal open onClose={onClose} title={t("admin.groups.membersTitle", { name: group.name })}>
      {members.isLoading ? (
        <p className="state state--loading">{t("admin.groups.membersLoading")}</p>
      ) : members.isError ? (
        <p className="state state--error" role="alert">
          {t("admin.groups.membersError")}
        </p>
      ) : (
        <DataTable
          caption={t("admin.groups.membersCaption", { name: group.name })}
          columns={columns}
          rows={members.data?.members ?? []}
          rowKey={(member) => member.clientId ?? `${member.firstName}-${member.avatarInitial}`}
          emptyLabel={t("admin.groups.membersEmpty")}
        />
      )}

      {transferTarget ? (
        <TransferMemberModal
          target={transferTarget}
          groups={groups}
          year={year}
          month={month}
          onClose={() => setTransferTarget(null)}
        />
      ) : null}
    </Modal>
  );
}

type EditTarget = { mode: "create" } | { mode: "edit"; group: Group };

/** M1 — Groups: data-dense table + create/edit modal form. The API owns all domain rules. */
export function Groups(): JSX.Element {
  const t = useT();
  const groups = useGroups();
  const levels = useLevels();
  const trainers = useTrainers();
  const courts = useCourts();
  const createGroup = useCreateGroup();
  const updateGroup = useUpdateGroup();
  const deleteGroup = useDeleteGroup();
  const { notify } = useToast();

  const [target, setTarget] = useState<EditTarget | null>(null);
  const [form, setForm] = useState<GroupFormState>(emptyForm);
  const [membersGroup, setMembersGroup] = useState<Group | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Group | null>(null);
  const { year, month } = useMemo(() => currentYearMonth(), []);

  // Presentation-only ordering: first weekday (Mon→Sun = ascending ISO 1..7),
  // then start time. Sort a copy so the query cache array stays untouched.
  const sortedGroups = useMemo(
    () =>
      [...(groups.data ?? [])].sort((a, b) => {
        const dayDelta = Math.min(...a.daysOfWeek) - Math.min(...b.daysOfWeek);
        if (dayDelta !== 0) return dayDelta;
        return a.startTime.localeCompare(b.startTime);
      }),
    [groups.data]
  );

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
      const update: UpdateGroupInput = { ...input, hidden: form.hidden };
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
      key: "court",
      header: t("admin.groups.colCourt"),
      render: (group) =>
        group.courtNumber !== null
          ? t("admin.groups.courtLabel", { number: group.courtNumber })
          : t("admin.groups.courtNone")
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
      key: "visibility",
      header: t("admin.groups.colVisibility"),
      render: (group) =>
        group.hidden ? t("admin.groups.visHidden") : t("admin.groups.visShown")
    },
    {
      key: "actions",
      header: "",
      render: (group) => (
        <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
          <Button
            variant="ghost"
            onClick={() => setMembersGroup(group)}
            aria-label={t("admin.groups.membersAria", { name: group.name })}
          >
            {t("admin.groups.membersAction")}
          </Button>
          <Button
            variant="ghost"
            onClick={() => openEdit(group)}
            aria-label={t("admin.groups.editAria", { name: group.name })}
          >
            {t("admin.action.edit")}
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              deleteGroup.reset();
              setDeleteTarget(group);
            }}
            aria-label={t("admin.groups.deleteAria", { name: group.name })}
          >
            {t("admin.action.delete")}
          </Button>
        </div>
      )
    }
  ];

  const referenceLoading = levels.isLoading || trainers.isLoading || courts.isLoading;

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
          rows={sortedGroups}
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
            courts={courts.data ?? []}
            isEdit={target?.mode === "edit"}
            error={submitError}
          />
        </form>
      </Modal>

      {membersGroup ? (
        <MembersDrawer
          group={membersGroup}
          groups={groups.data ?? []}
          year={year}
          month={month}
          onClose={() => setMembersGroup(null)}
        />
      ) : null}

      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title={t("admin.groups.deleteTitle")}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => setDeleteTarget(null)}
              disabled={deleteGroup.isPending}
            >
              {t("admin.groups.deleteKeep")}
            </Button>
            <Button
              variant="danger"
              disabled={deleteGroup.isPending}
              onClick={() => {
                if (!deleteTarget) return;
                const name = deleteTarget.name;
                deleteGroup.mutate(deleteTarget.id, {
                  onSuccess: () => {
                    notify(t("admin.groups.deleted", { name }), "success");
                    setDeleteTarget(null);
                  },
                  onError: (mutationError) => notify(mutationError.message, "error")
                });
              }}
            >
              {deleteGroup.isPending
                ? t("admin.groups.deleting")
                : t("admin.groups.deleteConfirm")}
            </Button>
          </>
        }
      >
        {deleteTarget ? <p>{t("admin.groups.deletePrompt", { name: deleteTarget.name })}</p> : null}
        {deleteGroup.isError ? (
          <p className="state state--error" role="alert">
            {deleteGroup.error.message}
          </p>
        ) : null}
      </Modal>
    </AppShell>
  );
}
