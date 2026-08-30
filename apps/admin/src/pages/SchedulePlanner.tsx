import { useMemo, useState } from "react";
import {
  dayOfMonth,
  enumerateInclusiveDates,
  isoWeekdayOf,
  operationalPeriodSchema,
  shiftInclusiveDateRange,
  type MonthlyScheduleDiagnostic,
  type MonthlyScheduleEntry,
  type MonthlySchedulePlanView,
  type MonthlyScheduleTemplate,
  type SchedulePlanOverlapEntry
} from "@beosand/types";
import { ConflictError, MonthlyScheduleConflictError } from "../api/client";
import {
  useCreateMonthlySchedulePlan,
  useMonthlyScheduleActions,
  useMonthlySchedulePlan
} from "../hooks/useMonthlySchedulePlan";
import { useGroups } from "../hooks/useGroups";
import { useTrainers } from "../hooks/useTrainers";
import { useCourts } from "../hooks/useCourts";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import { SelectField, TextField } from "../ui/Field";

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
type Action = "approve" | "generate" | "publish" | null;
type Range = { startDate: string; endDate: string };
function belgradeToday(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Belgrade",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((x) => x.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
function initialRange(): Range {
  const startDate = belgradeToday();
  return { startDate, endDate: addDays(startDate, 27) };
}
function rangeWeeks(range: Range): (string | null)[][] {
  const dates = enumerateInclusiveDates(range.startDate, range.endDate);
  const cells: (string | null)[] = [...Array(isoWeekdayOf(dates[0]) - 1).fill(null), ...dates];
  while (cells.length % 7) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));
}
function periodError(range: Range): string | null {
  const parsed = operationalPeriodSchema.safeParse(range);
  return parsed.success ? null : (parsed.error.issues[0]?.message ?? "Проверьте границы периода");
}
function court(entry: MonthlyScheduleEntry) {
  return entry.assignedCourtNumber === null
    ? "корт не назначен"
    : `корт ${entry.assignedCourtNumber}`;
}

export function SchedulePlanner(): JSX.Element {
  const [committedRange, setCommittedRange] = useState<Range>(initialRange);
  const [draftRange, setDraftRange] = useState<Range>(committedRange);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Action>(null);
  const [acknowledged, setAcknowledged] = useState<string[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const validation = periodError(draftRange);
  const query = useMonthlySchedulePlan(committedRange.startDate, committedRange.endDate);
  const create = useCreateMonthlySchedulePlan();
  const actions = useMonthlyScheduleActions();
  const view = query.data ?? null;
  const plan = view?.plan ?? null;
  const entries = useMemo(() => {
    const map = new Map<string, MonthlyScheduleEntry[]>();
    for (const entry of plan?.entries ?? [])
      map.set(entry.date, [...(map.get(entry.date) ?? []), entry]);
    return map;
  }, [plan]);
  const overlapEntries = useMemo(() => {
    const map = new Map<string, SchedulePlanOverlapEntry[]>();
    for (const entry of view?.overlapEntries ?? [])
      map.set(entry.date, [...(map.get(entry.date) ?? []), entry]);
    return map;
  }, [view]);
  const offDates = new Set(view?.daysOff.map((item) => item.date) ?? []);
  const apply = () => {
    if (validation) return;
    setActionError(null);
    setCommittedRange(draftRange);
    if (plan && (plan.startDate !== draftRange.startDate || plan.endDate !== draftRange.endDate))
      actions.updatePeriod.mutate({ planId: plan.id, input: draftRange });
  };
  const shift = (direction: 1 | -1) => {
    const [startDate, endDate] = shiftInclusiveDateRange(
      committedRange.startDate,
      committedRange.endDate,
      direction
    );
    const next = { startDate, endDate };
    setDraftRange(next);
    setCommittedRange(next);
    setSelectedDate(null);
  };
  const run = async (action: Exclude<Action, null>) => {
    if (!plan) return;
    setActionError(null);
    try {
      if (action === "approve") await actions.approve.mutateAsync(plan.id);
      if (action === "publish") await actions.publish.mutateAsync(plan.id);
      if (action === "generate")
        await actions.generate.mutateAsync({
          planId: plan.id,
          input: {
            acknowledgedOverlapPlanIds: acknowledged,
            overlapFingerprint: view?.overlapFingerprint ?? null
          }
        });
      setConfirm(null);
    } catch (error) {
      if (error instanceof MonthlyScheduleConflictError)
        setActionError(
          error.result.conflicts
            .concat(error.result.warnings)
            .map((x) => x.message)
            .join(" ")
        );
      else if (error instanceof ConflictError) {
        setAcknowledged([]);
        setActionError(
          "Данные пересекшихся планов устарели. Обновите план и подтвердите их снова."
        );
        query.refetch();
      } else
        setActionError(error instanceof Error ? error.message : "Не удалось выполнить действие");
    }
  };
  const busy =
    create.isPending ||
    actions.approve.isPending ||
    actions.generate.isPending ||
    actions.publish.isPending ||
    actions.updatePeriod.isPending;
  return (
    <section className="stack schedule-planner">
      <header className="page-head">
        <div>
          <h1>Планировщик периода</h1>
          <p>Единый план школы · Европа/Белград · сервер определяет ресурсы и публикацию.</p>
        </div>
        {plan ? (
          <div className="planner-head-state">
            <span className={`tag tag--${plan.status}`}>
              {plan.status === "draft"
                ? "Черновик"
                : plan.status === "approved"
                  ? "Одобрено"
                  : "Опубликовано"}
            </span>
            <span className="mono">рев. {plan.revision}</span>
          </div>
        ) : null}
      </header>
      <div className="workspace">
        <div className="workspace__bar planner-bar">
          <form
            className="planner-period"
            onSubmit={(e) => {
              e.preventDefault();
              apply();
            }}
          >
            <Button variant="ghost" aria-label="Предыдущий период" onClick={() => shift(-1)}>
              ‹
            </Button>
            <TextField
              label="Начало периода"
              type="date"
              value={draftRange.startDate}
              error={validation ?? undefined}
              onChange={(e) => setDraftRange({ ...draftRange, startDate: e.target.value })}
            />
            <TextField
              label="Конец периода"
              type="date"
              value={draftRange.endDate}
              error={validation ?? undefined}
              onChange={(e) => setDraftRange({ ...draftRange, endDate: e.target.value })}
            />
            <span className="planner-length">
              {validation
                ? "Период не применён"
                : `${enumerateInclusiveDates(committedRange.startDate, committedRange.endDate).length} дней включительно`}
            </span>
            <Button variant="primary" type="submit" disabled={Boolean(validation) || busy}>
              Применить
            </Button>
            <Button variant="ghost" aria-label="Следующий период" onClick={() => shift(1)}>
              ›
            </Button>
          </form>
          {plan ? (
            <div className="row-actions">
              <Button
                variant="ghost"
                disabled={!view?.actions.canApprove || busy}
                onClick={() => setConfirm("approve")}
              >
                Одобрить план
              </Button>
              <Button
                variant="ghost"
                disabled={!view?.actions.canGenerate || busy}
                onClick={() => setConfirm("generate")}
              >
                Сгенерировать скрытые
              </Button>
              <Button
                variant="primary"
                disabled={!view?.actions.canPublish || busy}
                onClick={() => setConfirm("publish")}
              >
                Опубликовать доступные
              </Button>
            </div>
          ) : null}
        </div>
        <div className="workspace__body">
          {validation ? (
            <p className="state state--error" role="alert">
              {validation}. Последний корректный период остаётся открытым.
            </p>
          ) : null}
          {query.isPending ? (
            <p className="state">Загружаем план периода…</p>
          ) : query.isError ? (
            <p className="state state--error" role="alert">
              {query.error.message}
            </p>
          ) : !plan ? (
            <div className="planner-empty">
              <h2>Плана на выбранный период нет</h2>
              <p>Создайте общий черновик, затем добавьте повторяющиеся расписания групп.</p>
              <Button
                variant="primary"
                disabled={create.isPending}
                onClick={() => create.mutate(committedRange)}
              >
                {create.isPending ? "Создаём…" : "Создать план периода"}
              </Button>
            </div>
          ) : (
            <>
              <TemplateLedger plan={plan} actions={actions} busy={busy} />
              {view!.hasOverlap ? <OverlapBanner overlaps={view!.overlaps} /> : null}
              <Calendar
                range={committedRange}
                entries={entries}
                overlapEntries={overlapEntries}
                daysOff={offDates}
                pendingDate={
                  actions.markDayOff.variables?.date ?? actions.unmarkDayOff.variables?.date ?? null
                }
                selectedDate={selectedDate}
                onSelect={setSelectedDate}
                onToggle={(date) =>
                  offDates.has(date)
                    ? actions.unmarkDayOff.mutate({ planId: plan.id, date })
                    : actions.markDayOff.mutate({ planId: plan.id, date })
                }
              />
              <Inspector
                date={selectedDate}
                entries={entries.get(selectedDate ?? "") ?? []}
                prior={overlapEntries.get(selectedDate ?? "") ?? []}
                diagnostics={view!.diagnostics}
              />
            </>
          )}
        </div>
      </div>
      <ConfirmModal
        action={confirm}
        view={view}
        acknowledged={acknowledged}
        setAcknowledged={setAcknowledged}
        error={actionError}
        busy={busy}
        onClose={() => setConfirm(null)}
        onConfirm={() => confirm && run(confirm)}
      />
    </section>
  );
}
function Calendar({
  range,
  entries,
  overlapEntries,
  daysOff,
  pendingDate,
  selectedDate,
  onSelect,
  onToggle
}: {
  range: Range;
  entries: Map<string, MonthlyScheduleEntry[]>;
  overlapEntries: Map<string, SchedulePlanOverlapEntry[]>;
  daysOff: Set<string>;
  pendingDate: string | null;
  selectedDate: string | null;
  onSelect: (date: string) => void;
  onToggle: (date: string) => void;
}) {
  return (
    <div
      className="planner-calendar planner-calendar--period"
      role="grid"
      aria-label={`Период ${range.startDate} — ${range.endDate}`}
    >
      <div className="calendar__head" role="row">
        {WEEKDAYS.map((day) => (
          <div className="calendar__weekday" role="columnheader" key={day}>
            {day}
          </div>
        ))}
      </div>
      {rangeWeeks(range).map((week, index) => (
        <div className="calendar__week" role="row" key={index}>
          {week.map((date, day) => (
            <div className="calendar__cell" role="gridcell" key={date ?? `pad-${day}`}>
              {date ? (
                <div
                  className={
                    selectedDate === date ? "planner-day planner-day--selected" : "planner-day"
                  }
                >
                  <button
                    type="button"
                    className="planner-day__select"
                    onClick={() => onSelect(date)}
                    aria-label={`${date}, занятий: ${(entries.get(date) ?? []).length}`}
                  >
                    <span className="calendar__date">{dayOfMonth(date)}</span>
                  </button>
                  <Button
                    className="planner-dayoff"
                    variant="ghost"
                    disabled={pendingDate === date}
                    aria-pressed={daysOff.has(date)}
                    aria-label={
                      daysOff.has(date) ? `Убрать выходной ${date}` : `Сделать выходным ${date}`
                    }
                    onClick={() => onToggle(date)}
                  >
                    {daysOff.has(date) ? "✓ Выходной" : "Выходной"}
                  </Button>
                  {overlapEntries.has(date) ? (
                    <span className="planner-overlap-badge">⚠ Пересечение</span>
                  ) : null}
                  <div className="planner-events">
                    {(entries.get(date) ?? []).map((entry) => (
                      <span className="planner-occurrence" key={entry.id}>
                        <b className="mono">{entry.startTime}</b> {entry.groupName}
                        <small>
                          {entry.trainerName} · {court(entry)}
                        </small>
                      </span>
                    ))}
                    {(overlapEntries.get(date) ?? []).map((entry) => (
                      <span className="planner-occurrence planner-occurrence--prior" key={entry.id}>
                        <b className="mono">{entry.startTime}</b> {entry.groupName}
                        <small>Предыдущий план · {entry.sourcePlanId}</small>
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
function TemplateLedger({
  plan,
  actions,
  busy
}: {
  plan: MonthlySchedulePlanView["plan"];
  actions: ReturnType<typeof useMonthlyScheduleActions>;
  busy: boolean;
}): JSX.Element {
  const [editing, setEditing] = useState<MonthlyScheduleTemplate | null>(null);
  const generated = plan.generatedAt !== null;
  const blankTemplate: MonthlyScheduleTemplate = {
    id: "",
    planId: plan.id,
    groupId: "",
    groupName: "",
    levelName: "",
    daysOfWeek: [1],
    startTime: "18:00",
    endTime: "19:30",
    trainerId: "",
    trainerName: "",
    preferredCourtId: null,
    preferredCourtNumber: null
  };
  return (
    <div className="datatable__surface planner-ledger">
      <div className="datatable__controlbar">
        <span>Повторяющиеся расписания групп</span>
        <Button
          variant="ghost"
          disabled={generated || busy}
          onClick={() => setEditing(blankTemplate)}
        >
          Добавить группу
        </Button>
      </div>
      <div className="datatable__scroll">
        <table className="datatable">
          <thead>
            <tr>
              <th>Группа</th>
              <th>Дни</th>
              <th>Время</th>
              <th>Тренер</th>
              <th>Корт</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {plan.templates.length ? (
              plan.templates.map((template) => (
                <tr key={template.id}>
                  <td>{template.groupName}</td>
                  <td>{template.daysOfWeek.map((day) => WEEKDAYS[day - 1]).join(", ")}</td>
                  <td className="mono">
                    {template.startTime}–{template.endTime}
                  </td>
                  <td>{template.trainerName}</td>
                  <td>
                    {template.preferredCourtNumber
                      ? `корт ${template.preferredCourtNumber}`
                      : "без предпочтения"}
                  </td>
                  <td>
                    <Button
                      variant="ghost"
                      className="btn--sm"
                      disabled={busy}
                      onClick={() => setEditing(template)}
                    >
                      Изменить
                    </Button>
                    {!generated ? (
                      <Button
                        variant="ghost"
                        className="btn--sm"
                        disabled={busy}
                        onClick={() =>
                          actions.deleteTemplate.mutate({
                            planId: plan.id,
                            templateId: template.id
                          })
                        }
                      >
                        Удалить
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6}>Нет повторяющихся расписаний для этого периода.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {generated ? (
        <p className="planner-ledger-note">
          После генерации нельзя добавлять или удалять группы. Сервер атомарно сохранит разрешённые
          изменения либо вернёт причины.
        </p>
      ) : null}
      {editing ? (
        <TemplateModal
          planId={plan.id}
          template={editing}
          actions={actions}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

function TemplateModal({
  planId,
  template,
  actions,
  onClose
}: {
  planId: string;
  template: MonthlyScheduleTemplate;
  actions: ReturnType<typeof useMonthlyScheduleActions>;
  onClose: () => void;
}): JSX.Element {
  const groups = useGroups();
  const trainers = useTrainers();
  const courts = useCourts();
  const [form, setForm] = useState(template);
  const save = async () => {
    if (template.id)
      await actions.updateTemplate.mutateAsync({
        planId,
        templateId: template.id,
        input: {
          daysOfWeek: form.daysOfWeek,
          startTime: form.startTime,
          endTime: form.endTime,
          trainerId: form.trainerId,
          preferredCourtId: form.preferredCourtId
        }
      });
    else
      await actions.createTemplate.mutateAsync({
        planId,
        input: {
          groupId: form.groupId,
          daysOfWeek: form.daysOfWeek,
          startTime: form.startTime,
          endTime: form.endTime,
          trainerId: form.trainerId,
          preferredCourtId: form.preferredCourtId
        }
      });
    onClose();
  };
  const toggleDay = (day: number) =>
    setForm((current) => ({
      ...current,
      daysOfWeek: current.daysOfWeek.includes(day)
        ? current.daysOfWeek.filter((value) => value !== day)
        : [...current.daysOfWeek, day]
    }));
  return (
    <Modal
      open
      onClose={onClose}
      title={template.id ? "Изменить расписание" : "Добавить группу"}
      footer={
        <Button
          variant="primary"
          disabled={actions.updateTemplate.isPending || actions.createTemplate.isPending}
          onClick={save}
        >
          Сохранить
        </Button>
      }
    >
      <div className="stack">
        <SelectField
          label="Группа"
          disabled={Boolean(template.id)}
          value={form.groupId}
          onChange={(event) => setForm({ ...form, groupId: event.target.value })}
          options={[
            { value: "", label: "Выберите группу" },
            ...(groups.data ?? []).map((group) => ({ value: group.id, label: group.name }))
          ]}
        />
        <fieldset>
          <legend>Дни недели</legend>
          <div className="weekday-checks">
            {WEEKDAYS.map((day, index) => (
              <label key={day}>
                <input
                  type="checkbox"
                  checked={form.daysOfWeek.includes(index + 1)}
                  onChange={() => toggleDay(index + 1)}
                />
                {day}
              </label>
            ))}
          </div>
        </fieldset>
        <label>
          Время{" "}
          <div className="cluster">
            <input
              className="input"
              aria-label="Начало времени"
              type="time"
              step="1800"
              value={form.startTime}
              onChange={(event) => setForm({ ...form, startTime: event.target.value })}
            />
            <input
              className="input"
              aria-label="Конец времени"
              type="time"
              step="1800"
              value={form.endTime}
              onChange={(event) => setForm({ ...form, endTime: event.target.value })}
            />
          </div>
        </label>
        <SelectField
          label="Тренер"
          value={form.trainerId}
          onChange={(event) => setForm({ ...form, trainerId: event.target.value })}
          options={[
            { value: "", label: "Выберите тренера" },
            ...(trainers.data ?? []).map((trainer) => ({ value: trainer.id, label: trainer.name }))
          ]}
        />
        <SelectField
          label="Предпочтительный корт"
          value={form.preferredCourtId ?? ""}
          onChange={(event) => setForm({ ...form, preferredCourtId: event.target.value || null })}
          options={[
            { value: "", label: "Без предпочтения" },
            ...(courts.data ?? []).map((item) => ({ value: item.id, label: `Корт ${item.number}` }))
          ]}
        />
      </div>
    </Modal>
  );
}
function OverlapBanner({ overlaps }: { overlaps: MonthlySchedulePlanView["overlaps"] }) {
  return (
    <div className="planner-overlap-banner" role="status">
      <strong>⚠ Есть пересечение с ранее созданными планами</strong>
      <span>Существующие записи показаны отдельно и доступны только для просмотра.</span>
      <ul>
        {overlaps.map((item) => (
          <li key={item.planId}>
            {item.startDate}–{item.endDate}: пересечение {item.intersectionStartDate}–
            {item.intersectionEndDate}
          </li>
        ))}
      </ul>
    </div>
  );
}
function Inspector({
  date,
  entries,
  prior,
  diagnostics
}: {
  date: string | null;
  entries: MonthlyScheduleEntry[];
  prior: SchedulePlanOverlapEntry[];
  diagnostics: MonthlyScheduleDiagnostic[];
}) {
  return (
    <aside className="workspace__inspector planner-inspector" aria-live="polite">
      <h2>{date ? `Проверка: ${date}` : "Выберите день"}</h2>
      {date ? (
        <>
          <p>
            {entries.length
              ? `${entries.length} записей текущего плана.`
              : "В текущем плане нет записей."}
          </p>
          {prior.length ? (
            <>
              <h3>Ранее запланировано</h3>
              <ul>
                {prior.map((entry) => (
                  <li key={entry.id}>
                    {entry.groupName} · {entry.startTime} · план {entry.sourcePlanId}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          <h3>Диагностика сервера</h3>
          <ul className="planner-diagnostics">
            {diagnostics
              .filter((item) => item.date === date)
              .map((item, index) => (
                <li
                  key={index}
                  className={`planner-diagnostic planner-diagnostic--${item.severity}`}
                >
                  <strong>{item.severity === "blocking" ? "Блокирует" : "Предупреждение"}</strong>
                  <p>{item.message}</p>
                </li>
              ))}
          </ul>
        </>
      ) : (
        <p className="state">Выберите дату, чтобы проверить записи и пересечения.</p>
      )}
    </aside>
  );
}
function ConfirmModal({
  action,
  view,
  acknowledged,
  setAcknowledged,
  error,
  busy,
  onClose,
  onConfirm
}: {
  action: Action;
  view: MonthlySchedulePlanView | null;
  acknowledged: string[];
  setAcknowledged: (ids: string[]) => void;
  error: string | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (!action || !view) return null;
  const overlaps = view.overlaps;
  const generate = action === "generate";
  const ready = !generate || overlaps.every((item) => acknowledged.includes(item.planId));
  return (
    <Modal
      open
      onClose={onClose}
      title={
        generate
          ? "Сгенерировать скрытые тренировки"
          : action === "approve"
            ? "Одобрить план"
            : "Опубликовать доступные"
      }
      footer={
        <div className="cluster">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Отмена
          </Button>
          <Button variant="primary" onClick={onConfirm} disabled={busy || !ready}>
            {busy ? "Выполняем…" : "Подтвердить"}
          </Button>
        </div>
      }
    >
      {generate ? (
        <>
          <p>
            Новые тренировки будут скрыты. Пересечение не отменяет существующие тренировки;
            конфликты ресурсов всё равно блокируют генерацию.
          </p>
          {overlaps.map((item) => (
            <label className="planner-ack" key={item.planId}>
              <input
                type="checkbox"
                checked={acknowledged.includes(item.planId)}
                onChange={(e) =>
                  setAcknowledged(
                    e.target.checked
                      ? [...acknowledged, item.planId]
                      : acknowledged.filter((id) => id !== item.planId)
                  )
                }
              />
              Подтверждаю пересечение {item.intersectionStartDate}–{item.intersectionEndDate} (план{" "}
              {item.startDate}–{item.endDate})
            </label>
          ))}
        </>
      ) : (
        <p>
          {action === "approve"
            ? "Одобрение фиксирует структуру. Ресурсы сервер проверит перед генерацией."
            : "Будут опубликованы доступные тренировки."}
        </p>
      )}
      {error ? (
        <p className="state state--error" role="alert">
          {error}
        </p>
      ) : null}
    </Modal>
  );
}
