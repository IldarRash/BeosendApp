import type { MonthlyScheduleDiagnostic, MonthlyScheduleEntry } from "@beosand/types";
import type {
  MonthlyScheduleConflictContext,
  PlannerOccupancyRow
} from "./monthly-schedule-conflict.repository";

export interface PlannerSpan {
  startTime: string;
  endTime: string;
}

export interface MonthlyScheduleEvaluation {
  entries: MonthlyScheduleEntry[];
  diagnostics: MonthlyScheduleDiagnostic[];
}

export type PlannerWorkingHoursByDate = ReadonlyMap<
  string,
  { openTime: string; closeTime: string }
>;

/**
 * Evaluates one complete month against a single current-truth snapshot. Court
 * assignment is transient: callers render it or persist it later inside the
 * generation/propagation transaction, while GET remains read-only.
 */
export function evaluateMonthlyScheduleEntries(
  inputEntries: readonly MonthlyScheduleEntry[],
  context: MonthlyScheduleConflictContext,
  workingHoursByDate: PlannerWorkingHoursByDate
): MonthlyScheduleEvaluation {
  const entries = [...inputEntries].sort(compareEntries);
  const planEntryIds = new Set(entries.map((entry) => entry.id));
  const planTrainingIds = new Set(
    entries.flatMap((entry) => (entry.trainingId === null ? [] : [entry.trainingId]))
  );
  const plannedCourtSpans: Array<{
    entryId: string;
    courtId: string;
    date: string;
    startTime: string;
    endTime: string;
  }> = [];

  const evaluated = entries.map((entry) => {
    const diagnostics: MonthlyScheduleDiagnostic[] = [];
    const resource = context.resources.find((row) => row.groupId === entry.groupId);
    const add = diagnosticAdder(entry, diagnostics);
    const cancelled = entry.trainingStatus === "cancelled";

    if (!resource || resource.groupStatus !== "active") {
      add("inactive-group", "blocking", "Группа неактивна и не может быть сгенерирована.");
    }
    if (!resource || resource.levelStatus !== "active") {
      add("inactive-level", "blocking", "Уровень группы неактивен.");
    }
    if (!resource || resource.trainerStatus !== "active") {
      add("inactive-trainer", "blocking", "Назначенный тренер неактивен.");
    }
    if (entry.preferredCourtId && resource?.preferredCourtStatus !== "active") {
      add(
        "inactive-court",
        "blocking",
        "Предпочтительный корт неактивен.",
        { courtId: entry.preferredCourtId }
      );
    }

    const hours = workingHoursByDate.get(entry.date);
    if (!cancelled && hours && (entry.startTime < hours.openTime || entry.endTime > hours.closeTime)) {
      add(
        "outside-working-hours",
        "blocking",
        `Время ${entry.startTime}–${entry.endTime} выходит за рабочие часы ${hours.openTime}–${hours.closeTime}.`
      );
    }

    for (const sibling of entries) {
      if (
        !cancelled &&
        sibling.trainingStatus !== "cancelled" &&
        sibling.id !== entry.id &&
        sibling.date === entry.date &&
        sibling.trainerId === entry.trainerId &&
        overlaps(entry, sibling)
      ) {
        add(
          "trainer-overlap",
          "blocking",
          `Тренер уже назначен на группу «${sibling.groupName}» в ${sibling.startTime}–${sibling.endTime}.`
        );
      }
    }

    const externalTrainings = context.trainings.filter(
      (training) =>
        training.status !== "cancelled" &&
        training.date === entry.date &&
        (training.monthlyScheduleEntryId === null || !planEntryIds.has(training.monthlyScheduleEntryId))
    );
    for (const training of cancelled ? [] : externalTrainings) {
      if (training.trainerId === entry.trainerId && overlaps(entry, training)) {
        add(
          "trainer-overlap",
          "blocking",
          `Тренер уже занят существующей тренировкой ${training.startTime}–${training.endTime}.`,
          { trainingId: training.id }
        );
      }
      if (training.groupId === entry.groupId) {
        add(
          "existing-training-collision",
          "blocking",
          "Для этой группы на дату уже существует тренировка вне текущего плана.",
          { trainingId: training.id }
        );
      }
    }

    const activeCourts = context.courts
      .filter((court) => court.status === "active")
      .sort((left, right) => left.number - right.number);
    if (activeCourts.length === 0) {
      add("no-active-court", "blocking", "Нет ни одного активного корта.");
      return { ...entry, assignedCourtId: null, assignedCourtNumber: null, diagnostics };
    }

    // Cancelled rows keep their stable historical mapping but deliberately own
    // no court block and therefore cannot reserve a trainer or court slot.
    if (cancelled) {
      const assigned =
        activeCourts.find((court) => court.id === entry.preferredCourtId) ?? activeCourts[0];
      return {
        ...entry,
        assignedCourtId: assigned.id,
        assignedCourtNumber: assigned.number,
        diagnostics
      };
    }

    const occupancyFor = (courtId: string): PlannerOccupancyRow[] =>
      context.occupancy.filter(
        (span) =>
          span.courtId === courtId &&
          span.date === entry.date &&
          (span.groupTrainingId === null || !planTrainingIds.has(span.groupTrainingId)) &&
          overlaps(entry, span)
      );
    const plannedOverlapFor = (courtId: string) =>
      plannedCourtSpans.filter(
        (span) => span.courtId === courtId && span.date === entry.date && overlaps(entry, span)
      );
    const freeCourts = activeCourts.filter(
      (court) => occupancyFor(court.id).length === 0 && plannedOverlapFor(court.id).length === 0
    );
    const preferred = entry.preferredCourtId
      ? activeCourts.find((court) => court.id === entry.preferredCourtId)
      : undefined;
    const preferredOccupied = preferred ? occupancyFor(preferred.id) : [];
    const assigned =
      preferred && preferredOccupied.length === 0 && plannedOverlapFor(preferred.id).length === 0
        ? preferred
        : freeCourts[0];

    if (entry.assignedCourtId && occupancyFor(entry.assignedCourtId).length > 0) {
      add(
        "assigned-court-occupied",
        assigned ? "warning" : "blocking",
        "Ранее назначенный корт теперь занят.",
        { courtId: entry.assignedCourtId }
      );
    }
    if (preferred && assigned?.id !== preferred.id) {
      add(
        "preferred-court-unavailable",
        assigned ? "warning" : "blocking",
        assigned
          ? `Предпочтительный корт ${preferred.number} недоступен; назначен корт ${assigned.number}.`
          : `Предпочтительный корт ${preferred.number} недоступен, свободного корта нет.`,
        { courtId: preferred.id }
      );
      for (const span of preferredOccupied) {
        addOccupancyDiagnostic(add, span, assigned ? "warning" : "blocking");
      }
    }
    if (!assigned) {
      const everyOccupancy = activeCourts.flatMap((court) => occupancyFor(court.id));
      for (const span of uniqueOccupancy(everyOccupancy)) {
        addOccupancyDiagnostic(add, span, "blocking");
      }
      add("court-unassigned", "blocking", "На это время нет свободного активного корта.");
      return { ...entry, assignedCourtId: null, assignedCourtNumber: null, diagnostics };
    }

    plannedCourtSpans.push({
      entryId: entry.id,
      courtId: assigned.id,
      date: entry.date,
      startTime: entry.startTime,
      endTime: entry.endTime
    });
    return {
      ...entry,
      assignedCourtId: assigned.id,
      assignedCourtNumber: assigned.number,
      diagnostics
    };
  });

  const diagnostics = evaluated.flatMap((entry) => entry.diagnostics).sort(compareDiagnostics);
  return { entries: evaluated, diagnostics };
}

export function overlaps(left: PlannerSpan, right: PlannerSpan): boolean {
  return left.startTime < right.endTime && right.startTime < left.endTime;
}

type Related = Partial<
  Pick<MonthlyScheduleDiagnostic, "trainingId" | "courtId" | "requestId" | "blockId">
>;

function diagnosticAdder(entry: MonthlyScheduleEntry, target: MonthlyScheduleDiagnostic[]) {
  return (
    code: MonthlyScheduleDiagnostic["code"],
    severity: MonthlyScheduleDiagnostic["severity"],
    message: string,
    related: Related = {}
  ): void => {
    target.push({
      code,
      severity,
      message,
      date: entry.date,
      startTime: entry.startTime,
      endTime: entry.endTime,
      entryId: entry.id,
      trainingId: related.trainingId ?? null,
      courtId: related.courtId ?? null,
      requestId: related.requestId ?? null,
      blockId: related.blockId ?? null
    });
  };
}

function addOccupancyDiagnostic(
  add: ReturnType<typeof diagnosticAdder>,
  span: PlannerOccupancyRow,
  severity: MonthlyScheduleDiagnostic["severity"]
): void {
  if (span.source === "request-pending") {
    add("court-request-pending-hold", severity, "Корт удерживается ожидающей заявкой на аренду.", {
      courtId: span.courtId,
      requestId: span.id
    });
  } else if (span.source === "request-confirmed") {
    add("court-request-confirmed", severity, "Корт занят подтверждённой арендой.", {
      courtId: span.courtId,
      requestId: span.id
    });
  } else if (span.source === "manual-block") {
    add("manual-court-block", severity, "На корте установлен ручной блок.", {
      courtId: span.courtId,
      blockId: span.id
    });
  } else {
    add("training-court-block", severity, "Корт занят существующей тренировкой.", {
      courtId: span.courtId,
      trainingId: span.groupTrainingId,
      blockId: span.id
    });
  }
}

function uniqueOccupancy(rows: PlannerOccupancyRow[]): PlannerOccupancyRow[] {
  return [...new Map(rows.map((row) => [`${row.source}:${row.id}:${row.courtId}`, row])).values()];
}

function compareEntries(left: MonthlyScheduleEntry, right: MonthlyScheduleEntry): number {
  return (
    left.date.localeCompare(right.date) ||
    left.startTime.localeCompare(right.startTime) ||
    left.groupName.localeCompare(right.groupName) ||
    left.id.localeCompare(right.id)
  );
}

function compareDiagnostics(left: MonthlyScheduleDiagnostic, right: MonthlyScheduleDiagnostic): number {
  return (
    left.date.localeCompare(right.date) ||
    left.startTime.localeCompare(right.startTime) ||
    (left.entryId ?? "").localeCompare(right.entryId ?? "") ||
    left.code.localeCompare(right.code)
  );
}
